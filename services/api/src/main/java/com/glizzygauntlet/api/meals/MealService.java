package com.glizzygauntlet.api.meals;

import com.glizzygauntlet.api.competitions.CompetitionException;
import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.directory.DirectoryException;
import com.glizzygauntlet.api.directory.DirectoryService;
import com.glizzygauntlet.api.directory.ImageStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

@Service
public class MealService {
  private final JdbcTemplate database;
  private final CompetitionService competitions;
  private final DirectoryService directory;
  private final ImageStore images;
  private final ObjectMapper json;
  private final long storageLimit;

  public MealService(
      JdbcTemplate database,
      CompetitionService competitions,
      DirectoryService directory,
      ImageStore images,
      ObjectMapper json,
      @Value("${app.media.max-bytes:536870912}") long storageLimit) {
    this.database = database;
    this.competitions = competitions;
    this.directory = directory;
    this.images = images;
    this.json = json;
    this.storageLimit = storageLimit;
  }

  public record Item(
      @NotBlank @Size(max = 120) String name,
      @NotNull @Min(0) @Max(100) Integer wholeQuantity,
      @NotNull @Min(1) @Max(10000) Integer unitHundredths,
      @NotNull @Min(0) @Max(9999) Integer partialHundredths) {}

  public record Content(
      @NotNull Instant eatenAt,
      UUID venueId,
      @NotNull @Size(max = 300) String location,
      @NotNull @Size(max = 2000) String notes,
      @NotNull @Size(min = 1, max = 20) List<@NotNull @Valid Item> items,
      @NotNull @Size(max = 5) List<@NotNull UUID> photoIds) {}

  public record Save(
      @NotNull UUID requestId,
      @NotNull @PositiveOrZero Long version,
      @NotNull @Valid Content content,
      @NotNull @Size(max = 20) List<@NotNull UUID> competitionIds) {}

  public record Change(@NotNull UUID requestId, @NotNull @Positive Long version) {}

  public record Revision(
      UUID id,
      long version,
      Instant eatenAt,
      UUID venueId,
      String location,
      String notes,
      List<Item> items,
      List<UUID> photoIds,
      long totalHundredths,
      int wholeHotDogs) {}

  public record Submission(
      UUID competitionId,
      String competitionName,
      UUID revisionId,
      long totalHundredths,
      int wholeHotDogs,
      boolean withdrawn,
      long version,
      boolean acceptsChanges) {}

  public record Meal(
      UUID id, long version, boolean archived, Revision revision, List<Submission> submissions) {}

  public record MealPage(List<Meal> items, boolean hasMore) {}

  public record RevisionPage(List<Revision> items, boolean hasMore) {}

  public record Entry(UUID id, String displayName, Revision revision) {}

  public record EntryPage(List<Entry> items, boolean hasMore) {}

  private record Row(UUID id, UUID owner, long version, boolean archived, UUID revision) {}

  private record EntryRow(
      UUID id, UUID competition, UUID revision, boolean withdrawn, long version) {}

  public MealPage list(UUID user, boolean archived, int page) {
    requireUser(user);
    validatePage(page);
    var rows =
        database.query(
            "SELECT * FROM meals WHERE owner_id = ? AND archived = ? ORDER BY created_at DESC, id LIMIT 21 OFFSET ?",
            this::map,
            user,
            archived,
            page * 20);
    return new MealPage(rows.stream().limit(20).map(this::view).toList(), rows.size() > 20);
  }

  public Meal get(UUID id, UUID user) {
    return view(owned(id, user, false));
  }

  public RevisionPage history(UUID id, UUID user, int page) {
    owned(id, user, false);
    validatePage(page);
    var ids =
        database.queryForList(
            "SELECT id FROM meal_revisions WHERE meal_id = ? ORDER BY version DESC LIMIT 21 OFFSET ?",
            UUID.class,
            id,
            page * 20);
    return new RevisionPage(ids.stream().limit(20).map(this::revision).toList(), ids.size() > 20);
  }

  @Transactional
  public Meal save(UUID id, UUID user, Save save) {
    requireUser(user);
    String fingerprint = fingerprint("SAVE:" + id, save);
    var replay = replay(user, save.requestId(), fingerprint);
    if (replay != null) return get(replay, user);
    Row current = id == null ? null : owned(id, user, true);
    if ((current == null && save.version() != 0)
        || (current != null && current.version() != save.version()))
      throw error("VERSION_CONFLICT");
    if (current != null && current.archived()) throw error("MEAL_ARCHIVED");
    var content = save.content();
    validate(content);
    var targets = new HashSet<>(save.competitionIds());
    if (targets.size() != save.competitionIds().size()) throw invalid();
    UUID meal = current == null ? UUID.randomUUID() : id;
    var affected = new HashSet<>(targets);
    if (!targets.isEmpty() && current != null)
      affected.addAll(
          database.queryForList(
              "SELECT competition_id FROM competition_entries WHERE meal_id = ? AND NOT withdrawn",
              UUID.class,
              meal));
    lockCompetitions(affected);
    Instant now = now();
    if (content.eatenAt().isAfter(now)
        || content.eatenAt().getNano() % 1_000_000 != 0
        || content.eatenAt().isBefore(Instant.EPOCH)) throw bad("INVALID_EATEN_AT");
    var targetCompetitions = new HashMap<UUID, CompetitionService.Competition>();
    for (UUID target : targets) {
      var competition = writable(target, user, now);
      if (content.eatenAt().isBefore(competition.startsAt())
          || !content.eatenAt().isBefore(competition.endsAt()))
        throw new MealException(HttpStatus.BAD_REQUEST, "OUTSIDE_EATING_WINDOW", target);
      targetCompetitions.put(target, competition);
    }
    if (affected.size() > 1)
      for (UUID target : affected) {
        if (!Boolean.TRUE.equals(
            database.queryForObject(
                "SELECT allow_shared_meals FROM competitions WHERE id = ?", Boolean.class, target)))
          throw new MealException(HttpStatus.CONFLICT, "SHARING_NOT_ALLOWED", target);
      }
    String location;
    if (content.venueId() != null) {
      if (!content.location().isBlank()) throw bad("LOCATION_CONFLICT");
      var previous = current == null ? null : revision(current.revision());
      if (previous != null && content.venueId().equals(previous.venueId()))
        location = previous.location();
      else {
        try {
          var venue = directory.get(content.venueId());
          location = venue.name() + " / " + venue.address();
        } catch (DirectoryException unavailable) {
          throw bad("INVALID_VENUE");
        }
      }
    } else {
      if (content.location().isBlank()) throw bad("LOCATION_REQUIRED");
      location = content.location().strip();
    }
    if (current == null)
      database.update("INSERT INTO meals (id, owner_id) VALUES (?, ?)", meal, user);
    attachPhotos(meal, user, content.photoIds());
    long version = current == null ? 1 : current.version() + 1;
    UUID revision = UUID.randomUUID();
    long total = 0;
    int whole = 0;
    for (var item : content.items()) {
      total =
          Math.addExact(
              total,
              Math.addExact(
                  (long) item.wholeQuantity() * item.unitHundredths(), item.partialHundredths()));
      whole = Math.addExact(whole, item.wholeQuantity());
    }
    database.update(
        """
        INSERT INTO meal_revisions (id, meal_id, version, eaten_at, venue_id, location, notes, total_hundredths, whole_hot_dogs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        revision,
        meal,
        version,
        sql(content.eatenAt()),
        content.venueId(),
        location,
        content.notes().strip(),
        total,
        whole);
    int position = 0;
    for (var item : content.items())
      database.update(
          "INSERT INTO meal_items (revision_id, position, name, whole_quantity, unit_hundredths, partial_hundredths) VALUES (?, ?, ?, ?, ?, ?)",
          revision,
          position++,
          item.name().strip(),
          item.wholeQuantity(),
          item.unitHundredths(),
          item.partialHundredths());
    for (UUID photo : content.photoIds())
      database.update(
          "INSERT INTO meal_revision_photos (revision_id, photo_id) VALUES (?, ?)",
          revision,
          photo);
    database.update(
        "UPDATE meals SET current_revision = ?, version = ? WHERE id = ?", revision, version, meal);
    for (var competition : targetCompetitions.values()) submit(meal, user, revision, competition);
    remember(user, save.requestId(), fingerprint, meal);
    return view(owned(meal, user, false));
  }

  @Transactional
  public Meal archive(UUID id, UUID user, Change change) {
    String fingerprint = fingerprint("ARCHIVE:" + id, change);
    var replay = replay(user, change.requestId(), fingerprint);
    if (replay != null) return get(replay, user);
    var row = owned(id, user, true);
    if (row.version() != change.version()) throw error("VERSION_CONFLICT");
    if (!row.archived())
      database.update("UPDATE meals SET archived = TRUE, version = version + 1 WHERE id = ?", id);
    remember(user, change.requestId(), fingerprint, id);
    return view(owned(id, user, false));
  }

  @Transactional
  public Meal withdraw(UUID id, UUID competition, UUID user, Change change) {
    String fingerprint = fingerprint("WITHDRAW:" + id + ":" + competition, change);
    var replay = replay(user, change.requestId(), fingerprint);
    if (replay != null) return get(replay, user);
    owned(id, user, true);
    lockCompetitions(Set.of(competition));
    writable(competition, user, now());
    var entry = entry(id, competition);
    if (entry == null) throw new MealException(HttpStatus.NOT_FOUND, "NOT_FOUND", null);
    if (entry.version() != change.version()) throw error("VERSION_CONFLICT");
    if (!entry.withdrawn()) {
      database.update(
          "UPDATE competition_entries SET withdrawn = TRUE, version = version + 1 WHERE id = ?",
          entry.id());
      event(entry.id(), user, "WITHDRAWN", entry.revision(), entry.revision(), false, true);
    }
    remember(user, change.requestId(), fingerprint, id);
    return view(owned(id, user, false));
  }

  public EntryPage entries(UUID competition, UUID user, int page) {
    requireUser(user);
    validatePage(page);
    var visible = competitions.get(competition, user);
    if (visible.viewerRole() == CompetitionService.Role.NONE)
      throw new MealException(HttpStatus.FORBIDDEN, "MEMBERS_ONLY", competition);
    var rows =
        database.query(
            """
        SELECT e.id, e.revision_id, u.display_name FROM competition_entries e
        JOIN meals m ON m.id = e.meal_id JOIN app_users u ON u.id = m.owner_id
        WHERE e.competition_id = ? AND NOT e.withdrawn ORDER BY e.created_at DESC, e.id LIMIT 21 OFFSET ?
        """,
            (rs, i) ->
                new Entry(
                    rs.getObject("id", UUID.class),
                    rs.getString("display_name"),
                    revision(rs.getObject("revision_id", UUID.class))),
            competition,
            page * 20);
    return new EntryPage(rows.stream().limit(20).toList(), rows.size() > 20);
  }

  @Transactional
  public UUID upload(UUID user, byte[] bytes) {
    requireUser(user);
    database.queryForList("SELECT pg_advisory_xact_lock(67598231)");
    if (count("SELECT count(*) FROM meal_photos WHERE owner_id = ?", user) >= 200)
      throw error("PHOTO_LIMIT");
    var sanitized = images.sanitize(bytes);
    long size = sanitized.image().length + sanitized.thumbnail().length;
    if (storedBytes() + size > storageLimit) throw error("STORAGE_LIMIT");
    UUID id = UUID.randomUUID();
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCompletion(int status) {
            if (status != STATUS_COMMITTED) images.delete(id);
          }
        });
    images.write(id, sanitized);
    database.update(
        "INSERT INTO meal_photos (id, owner_id, bytes) VALUES (?, ?, ?)", id, user, size);
    return id;
  }

  public List<UUID> stagedPhotos(UUID user) {
    requireUser(user);
    return database.queryForList(
        "SELECT id FROM meal_photos WHERE owner_id = ? AND meal_id IS NULL ORDER BY created_at DESC LIMIT 200",
        UUID.class,
        user);
  }

  @Transactional
  public void discardPhoto(UUID id, UUID user) {
    requireUser(user);
    var rows =
        database.queryForList(
            "SELECT meal_id FROM meal_photos WHERE id = ? AND owner_id = ? FOR UPDATE",
            UUID.class,
            id,
            user);
    if (rows.isEmpty()) throw new MealException(HttpStatus.NOT_FOUND, "NOT_FOUND", null);
    if (rows.getFirst() != null) throw error("PHOTO_IN_USE");
    database.update("DELETE FROM meal_photos WHERE id = ?", id);
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            images.delete(id);
          }
        });
  }

  public byte[] photo(UUID id, UUID user, boolean thumbnail) {
    requireUser(user);
    if (count(
            """
        SELECT count(*) FROM meal_photos p WHERE p.id = ? AND (p.owner_id = ? OR EXISTS (
          SELECT 1 FROM meal_revision_photos rp JOIN competition_entries e ON e.revision_id = rp.revision_id
          JOIN competitions c ON c.id = e.competition_id
          JOIN competition_memberships m ON m.competition_id = c.id AND m.user_id = ?
          WHERE rp.photo_id = p.id AND NOT e.withdrawn AND c.published_at IS NOT NULL AND m.status = 'ACTIVE'))
        """,
            id,
            user,
            user)
        == 0) throw new MealException(HttpStatus.NOT_FOUND, "NOT_FOUND", null);
    return images.read(id, thumbnail);
  }

  private void attachPhotos(UUID meal, UUID user, List<UUID> ids) {
    for (UUID id : ids.stream().sorted().toList()) {
      var rows =
          database.queryForList(
              "SELECT meal_id FROM meal_photos WHERE id = ? AND owner_id = ? FOR UPDATE",
              UUID.class,
              id,
              user);
      if (rows.isEmpty() || (rows.getFirst() != null && !rows.getFirst().equals(meal)))
        throw bad("INVALID_PHOTO");
      database.update("UPDATE meal_photos SET meal_id = ? WHERE id = ?", meal, id);
    }
  }

  private long storedBytes() {
    return count(
        "SELECT (SELECT COALESCE(sum(bytes), 0) FROM directory_photos) + (SELECT COALESCE(sum(bytes), 0) FROM meal_photos)");
  }

  private void submit(
      UUID meal, UUID user, UUID revision, CompetitionService.Competition competition) {
    var before = entry(meal, competition.id());
    UUID entry = before == null ? UUID.randomUUID() : before.id();
    if (before == null)
      database.update(
          "INSERT INTO competition_entries (id, meal_id, competition_id, competition_name, revision_id) VALUES (?, ?, ?, ?, ?)",
          entry,
          meal,
          competition.id(),
          competition.name(),
          revision);
    else
      database.update(
          "UPDATE competition_entries SET revision_id = ?, withdrawn = FALSE, version = version + 1 WHERE id = ?",
          revision,
          entry);
    event(
        entry,
        user,
        "SUBMITTED",
        before == null ? null : before.revision(),
        revision,
        before == null ? null : before.withdrawn(),
        false);
  }

  private void event(
      UUID entry,
      UUID user,
      String action,
      UUID before,
      UUID after,
      Boolean wasWithdrawn,
      boolean withdrawn) {
    database.update(
        """
        INSERT INTO competition_entry_events (id, entry_id, actor_id, action, before_revision, after_revision, was_withdrawn, is_withdrawn, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        UUID.randomUUID(),
        entry,
        user,
        action,
        before,
        after,
        wasWithdrawn,
        withdrawn,
        "Participant " + action.toLowerCase(Locale.ROOT));
  }

  private EntryRow entry(UUID meal, UUID competition) {
    var rows =
        database.query(
            "SELECT * FROM competition_entries WHERE meal_id = ? AND competition_id = ?",
            (rs, i) ->
                new EntryRow(
                    rs.getObject("id", UUID.class),
                    competition,
                    rs.getObject("revision_id", UUID.class),
                    rs.getBoolean("withdrawn"),
                    rs.getLong("version")),
            meal,
            competition);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private void lockCompetitions(Set<UUID> ids) {
    // Every submission, withdrawal, and future finalizer shares this ordered competition lock
    // boundary.
    for (UUID id : ids.stream().sorted().toList())
      database.queryForList("SELECT id FROM competitions WHERE id = ? FOR UPDATE", id);
  }

  private CompetitionService.Competition writable(UUID id, UUID user, Instant now) {
    CompetitionService.Competition competition;
    try {
      competition = competitions.get(id, user);
    } catch (CompetitionException unavailable) {
      throw new MealException(HttpStatus.NOT_FOUND, "TARGET_UNAVAILABLE", id);
    }
    if (competition.viewerRole() == CompetitionService.Role.NONE || !competition.published())
      throw new MealException(HttpStatus.FORBIDDEN, "TARGET_UNAVAILABLE", id);
    if (!now.isBefore(competition.submissionClosesAt()))
      throw new MealException(HttpStatus.CONFLICT, "SUBMISSIONS_CLOSED", id);
    return competition;
  }

  private void validate(Content content) {
    if (content.items().isEmpty()
        || content.items().size() > 20
        || content.photoIds().size() > 5
        || new HashSet<>(content.photoIds()).size() != content.photoIds().size()) throw invalid();
    for (var item : content.items()) {
      if (item.name().isBlank()
          || item.wholeQuantity() < 0
          || item.wholeQuantity() > 100
          || item.unitHundredths() <= 0
          || item.unitHundredths() > 10000
          || item.partialHundredths() < 0
          || item.partialHundredths() >= item.unitHundredths()
          || (item.wholeQuantity() == 0 && item.partialHundredths() == 0))
        throw bad("INVALID_MEASUREMENT");
    }
  }

  private Meal view(Row row) {
    var submissions =
        database.query(
            """
        SELECT e.*, r.total_hundredths, r.whole_hot_dogs,
          (m.status = 'ACTIVE' AND c.published_at IS NOT NULL AND clock_timestamp() < c.ends_at + interval '24 hours') AS writable
        FROM competition_entries e JOIN meal_revisions r ON r.id = e.revision_id
        JOIN competitions c ON c.id = e.competition_id
        LEFT JOIN competition_memberships m ON m.competition_id = c.id AND m.user_id = ?
        WHERE e.meal_id = ? ORDER BY e.competition_id
        """,
            (rs, i) ->
                new Submission(
                    rs.getObject("competition_id", UUID.class),
                    rs.getString("competition_name"),
                    rs.getObject("revision_id", UUID.class),
                    rs.getLong("total_hundredths"),
                    rs.getInt("whole_hot_dogs"),
                    rs.getBoolean("withdrawn"),
                    rs.getLong("version"),
                    rs.getBoolean("writable")),
            row.owner(),
            row.id());
    return new Meal(row.id(), row.version(), row.archived(), revision(row.revision()), submissions);
  }

  private Revision revision(UUID id) {
    return database.queryForObject(
        "SELECT * FROM meal_revisions WHERE id = ?",
        (rs, i) ->
            new Revision(
                id,
                rs.getLong("version"),
                rs.getObject("eaten_at", OffsetDateTime.class).toInstant(),
                rs.getObject("venue_id", UUID.class),
                rs.getString("location"),
                rs.getString("notes"),
                database.query(
                    "SELECT * FROM meal_items WHERE revision_id = ? ORDER BY position",
                    (item, j) ->
                        new Item(
                            item.getString("name"),
                            item.getInt("whole_quantity"),
                            item.getInt("unit_hundredths"),
                            item.getInt("partial_hundredths")),
                    id),
                database.queryForList(
                    "SELECT photo_id FROM meal_revision_photos WHERE revision_id = ? ORDER BY photo_id",
                    UUID.class,
                    id),
                rs.getLong("total_hundredths"),
                rs.getInt("whole_hot_dogs")),
        id);
  }

  private Row owned(UUID id, UUID user, boolean lock) {
    requireUser(user);
    var rows =
        database.query(
            "SELECT * FROM meals WHERE id = ? AND owner_id = ?" + (lock ? " FOR UPDATE" : ""),
            this::map,
            id,
            user);
    if (rows.isEmpty()) throw new MealException(HttpStatus.NOT_FOUND, "NOT_FOUND", null);
    return rows.getFirst();
  }

  private Row map(ResultSet rs, int index) throws SQLException {
    return new Row(
        rs.getObject("id", UUID.class),
        rs.getObject("owner_id", UUID.class),
        rs.getLong("version"),
        rs.getBoolean("archived"),
        rs.getObject("current_revision", UUID.class));
  }

  private UUID replay(UUID user, UUID request, String fingerprint) {
    requireUser(user);
    database.queryForList(
        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "meal:" + user + ":" + request);
    var hashes =
        database.queryForList(
            "SELECT fingerprint FROM meal_mutations WHERE owner_id = ? AND request_id = ?",
            String.class,
            user,
            request);
    if (hashes.isEmpty()) return null;
    if (!hashes.getFirst().equals(fingerprint)) throw error("REQUEST_CONFLICT");
    return database.queryForObject(
        "SELECT meal_id FROM meal_mutations WHERE owner_id = ? AND request_id = ?",
        UUID.class,
        user,
        request);
  }

  private void remember(UUID user, UUID request, String fingerprint, UUID meal) {
    database.update(
        "INSERT INTO meal_mutations (owner_id, request_id, fingerprint, meal_id) VALUES (?, ?, ?, ?)",
        user,
        request,
        fingerprint,
        meal);
  }

  private String fingerprint(String operation, Object body) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(
                      (operation + json.writeValueAsString(body))
                          .getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private Instant now() {
    return database.queryForObject("SELECT clock_timestamp()", OffsetDateTime.class).toInstant();
  }

  private static OffsetDateTime sql(Instant instant) {
    return instant.atOffset(java.time.ZoneOffset.UTC);
  }

  private long count(String sql, Object... args) {
    return database.queryForObject(sql, Long.class, args);
  }

  private void requireUser(UUID user) {
    if (user == null) throw new MealException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", null);
  }

  private void validatePage(int page) {
    if (page < 0 || page > 1000) throw invalid();
  }

  private MealException invalid() {
    return bad("INVALID_REQUEST");
  }

  private MealException bad(String code) {
    return new MealException(HttpStatus.BAD_REQUEST, code, null);
  }

  private MealException error(String code) {
    return new MealException(HttpStatus.CONFLICT, code, null);
  }
}
