package com.glizzygauntlet.api.recaps;

import com.glizzygauntlet.api.competitions.CompetitionException;
import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.progress.ProgressService.Standing;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
@Transactional
public class RecapService {
  private final JdbcTemplate database;
  private final CompetitionService competitions;
  private final ObjectMapper json;

  public RecapService(JdbcTemplate database, CompetitionService competitions, ObjectMapper json) {
    this.database = database;
    this.competitions = competitions;
    this.json = json;
  }

  public record Version(long version, String state, Instant createdAt, int calculationVersion) {}

  public record Recap(
      Version result,
      long participantCount,
      long totalHundredths,
      long wholeHotDogs,
      List<Standing> standings,
      boolean hasMore) {}

  public record History(List<Version> items, boolean hasMore) {}

  public record Place(
      String location, boolean directoryVenue, long mealCount, long totalHundredths) {}

  public record Highlights(
      long resultVersion,
      long mealCount,
      long venueCount,
      long privateLocationCount,
      long largestMealHundredths,
      LocalDate busiestDay,
      long busiestDayHundredths,
      String timeZone,
      List<Place> places) {}

  public record Correction(
      @NotNull UUID requestId,
      @NotNull @Positive Long version,
      @NotNull @Min(1) @Max(20199980) Long totalHundredths,
      @NotNull @Min(0) @Max(2000) Integer wholeHotDogs,
      @NotNull Boolean excluded,
      @NotBlank @Size(max = 500) String reason) {}

  public record Receipt(long resultVersion, long entryVersion) {}

  public record Audit(
      UUID entryId,
      String actorDisplayName,
      String reason,
      Instant createdAt,
      long beforeTotalHundredths,
      int beforeWholeHotDogs,
      boolean beforeExcluded,
      long afterTotalHundredths,
      int afterWholeHotDogs,
      boolean afterExcluded,
      long resultVersion) {}

  public record AuditPage(List<Audit> items, boolean hasMore) {}

  private record Result(UUID id, Version version) {}

  private record Entry(
      long version, UUID revision, long total, int whole, boolean excluded, boolean withdrawn) {}

  public Recap get(UUID id, UUID user, Long version, int page) {
    lock(id);
    competitions.get(id, user);
    validatePage(page);
    long latest = ensure(id);
    var result = result(id, version == null ? latest : version);
    var totals =
        database.queryForMap(
            """
        SELECT COUNT(*) AS participants, COALESCE(SUM(total_hundredths), 0) AS total,
          COALESCE(SUM(whole_hot_dogs), 0) AS whole
        FROM competition_result_participants WHERE result_id = ?
        """,
            result.id());
    var standings =
        database.query(
            """
        SELECT * FROM competition_result_participants WHERE result_id = ?
        ORDER BY rank, user_id LIMIT 21 OFFSET ?
        """,
            (rs, i) ->
                new Standing(
                    rs.getLong("rank"),
                    rs.getString("display_name"),
                    rs.getLong("total_hundredths"),
                    rs.getLong("whole_hot_dogs")),
            result.id(),
            page * 20);
    return new Recap(
        result.version(),
        ((Number) totals.get("participants")).longValue(),
        ((Number) totals.get("total")).longValue(),
        ((Number) totals.get("whole")).longValue(),
        standings.stream().limit(20).toList(),
        standings.size() > 20);
  }

  public History history(UUID id, UUID user, int page) {
    lock(id);
    competitions.get(id, user);
    validatePage(page);
    ensure(id);
    var rows =
        database.query(
            """
        SELECT * FROM competition_results WHERE competition_id = ? ORDER BY version DESC LIMIT 21 OFFSET ?
        """,
            (rs, i) ->
                new Version(
                    rs.getLong("version"),
                    rs.getLong("version") == 1 ? "FINAL" : "REVISED",
                    rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                    rs.getInt("calculation_version")),
            id,
            page * 20);
    return new History(rows.stream().limit(20).toList(), rows.size() > 20);
  }

  public Highlights highlights(UUID id, UUID user, Long version) {
    lock(id);
    var competition = member(id, user);
    var result = result(id, version == null ? ensure(id) : checkedVersion(id, version));
    var totals =
        database.queryForMap(
            """
        SELECT COUNT(*) AS meals, COUNT(DISTINCT r.venue_id) AS venues,
          COUNT(DISTINCT r.location) FILTER (WHERE r.venue_id IS NULL) AS private_places,
          COALESCE(MAX(e.total_hundredths), 0) AS largest
        FROM competition_result_entries e JOIN meal_revisions r ON r.id = e.revision_id
        WHERE e.result_id = ? AND NOT e.score_excluded
        """,
            result.id());
    var places =
        database.query(
            """
        SELECT MIN(r.location) AS location, r.venue_id, COUNT(*) AS meals, SUM(e.total_hundredths) AS total
        FROM competition_result_entries e JOIN meal_revisions r ON r.id = e.revision_id
        WHERE e.result_id = ? AND NOT e.score_excluded
        GROUP BY r.venue_id, CASE WHEN r.venue_id IS NULL THEN r.location END
        ORDER BY meals DESC, total DESC, r.venue_id NULLS LAST, MIN(r.location) LIMIT 5
        """,
            (rs, i) ->
                new Place(
                    rs.getString("location"),
                    rs.getObject("venue_id") != null,
                    rs.getLong("meals"),
                    rs.getLong("total")),
            result.id());
    var days = new TreeMap<LocalDate, Long>();
    var zone = ZoneId.of(competition.timeZone());
    database.query(
        connection -> {
          var statement =
              connection.prepareStatement(
                  """
          SELECT r.eaten_at, e.total_hundredths FROM competition_result_entries e
          JOIN meal_revisions r ON r.id = e.revision_id WHERE e.result_id = ? AND NOT e.score_excluded
          """);
          statement.setFetchSize(200);
          statement.setObject(1, result.id());
          return statement;
        },
        (RowCallbackHandler)
            rs ->
                days.merge(
                    rs.getObject("eaten_at", OffsetDateTime.class)
                        .toInstant()
                        .atZone(zone)
                        .toLocalDate(),
                    rs.getLong("total_hundredths"),
                    Math::addExact));
    LocalDate busiest = null;
    long most = 0;
    for (var day : days.entrySet())
      if (day.getValue() > most) {
        busiest = day.getKey();
        most = day.getValue();
      }
    return new Highlights(
        result.version().version(),
        ((Number) totals.get("meals")).longValue(),
        ((Number) totals.get("venues")).longValue(),
        ((Number) totals.get("private_places")).longValue(),
        ((Number) totals.get("largest")).longValue(),
        busiest,
        most,
        competition.timeZone(),
        places);
  }

  public Receipt correct(UUID id, UUID entryId, UUID user, Correction change) {
    if (user == null) throw error(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    database.queryForList(
        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
        "correction:" + user + ":" + change.requestId());
    lock(id);
    var competition = member(id, user);
    if (competition.viewerRole() != CompetitionService.Role.ORGANIZER)
      throw error(HttpStatus.FORBIDDEN, "ORGANIZER_ONLY");
    String fingerprint = fingerprint(id, entryId, change);
    var replay =
        database.queryForList(
            "SELECT * FROM entry_score_corrections WHERE actor_id = ? AND request_id = ?",
            user,
            change.requestId());
    if (!replay.isEmpty()) {
      var row = replay.getFirst();
      if (!fingerprint.equals(row.get("fingerprint")))
        throw error(HttpStatus.CONFLICT, "REQUEST_CONFLICT");
      return new Receipt(
          ((Number) row.get("result_version")).longValue(),
          ((Number) row.get("after_version")).longValue());
    }
    if (change.reason() == null
        || change.reason().isBlank()
        || change.reason().length() > 500
        || change.totalHundredths() == null
        || change.totalHundredths() < 1
        || change.totalHundredths() > 20199980
        || change.wholeHotDogs() == null
        || change.wholeHotDogs() < 0
        || change.wholeHotDogs() > 2000
        || change.excluded() == null) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    long previousResult = ensure(id);
    var rows =
        database.query(
            """
        SELECT e.*, COALESCE(e.adjusted_total_hundredths, r.total_hundredths) AS total,
          COALESCE(e.adjusted_whole_hot_dogs, r.whole_hot_dogs) AS whole
        FROM competition_entries e JOIN meal_revisions r ON r.id = e.revision_id
        WHERE e.competition_id = ? AND e.id = ? FOR UPDATE OF e
        """,
            (rs, i) ->
                new Entry(
                    rs.getLong("version"),
                    rs.getObject("revision_id", UUID.class),
                    rs.getLong("total"),
                    rs.getInt("whole"),
                    rs.getBoolean("score_excluded"),
                    rs.getBoolean("withdrawn")),
            id,
            entryId);
    if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    var before = rows.getFirst();
    if (before.withdrawn()) throw error(HttpStatus.CONFLICT, "ENTRY_WITHDRAWN");
    if (before.version() != change.version()) throw error(HttpStatus.CONFLICT, "VERSION_CONFLICT");
    if (before.total() == change.totalHundredths()
        && before.whole() == change.wholeHotDogs()
        && before.excluded() == change.excluded())
      throw error(HttpStatus.BAD_REQUEST, "NO_SCORE_CHANGE");
    database.update(
        """
        UPDATE competition_entries SET adjusted_total_hundredths = ?, adjusted_whole_hot_dogs = ?,
          score_excluded = ?, version = version + 1 WHERE id = ?
        """,
        change.totalHundredths(),
        change.wholeHotDogs(),
        change.excluded(),
        entryId);
    database.update(
        """
        INSERT INTO competition_entry_events
          (id, entry_id, actor_id, action, before_revision, after_revision, was_withdrawn, is_withdrawn, reason)
        VALUES (?, ?, ?, 'SCORE_CORRECTED', ?, ?, false, false, ?)
        """,
        UUID.randomUUID(),
        entryId,
        user,
        before.revision(),
        before.revision(),
        change.reason().strip());
    long version = previousResult + 1;
    publish(id, version);
    database.update(
        """
        INSERT INTO entry_score_corrections
          (id, competition_id, entry_id, actor_id, actor_display_name, request_id, fingerprint,
          before_version, after_version, before_total_hundredths, before_whole_hot_dogs, before_excluded,
          after_total_hundredths, after_whole_hot_dogs, after_excluded, result_version, reason)
        VALUES (?, ?, ?, ?, (SELECT display_name FROM app_users WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        UUID.randomUUID(),
        id,
        entryId,
        user,
        user,
        change.requestId(),
        fingerprint,
        before.version(),
        before.version() + 1,
        before.total(),
        before.whole(),
        before.excluded(),
        change.totalHundredths(),
        change.wholeHotDogs(),
        change.excluded(),
        version,
        change.reason().strip());
    return new Receipt(version, before.version() + 1);
  }

  public AuditPage audit(UUID id, UUID user, int page) {
    member(id, user);
    validatePage(page);
    var rows =
        database.query(
            """
        SELECT * FROM entry_score_corrections WHERE competition_id = ? ORDER BY created_at DESC, id LIMIT 21 OFFSET ?
        """,
            (rs, i) ->
                new Audit(
                    rs.getObject("entry_id", UUID.class),
                    rs.getString("actor_display_name"),
                    rs.getString("reason"),
                    rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                    rs.getLong("before_total_hundredths"),
                    rs.getInt("before_whole_hot_dogs"),
                    rs.getBoolean("before_excluded"),
                    rs.getLong("after_total_hundredths"),
                    rs.getInt("after_whole_hot_dogs"),
                    rs.getBoolean("after_excluded"),
                    rs.getLong("result_version")),
            id,
            page * 20);
    return new AuditPage(rows.stream().limit(20).toList(), rows.size() > 20);
  }

  public boolean finalizeDue(UUID id) {
    lock(id);
    if (current(id) > 0 || !due(id)) return false;
    publish(id, 1);
    return true;
  }

  private long checkedVersion(UUID id, long version) {
    ensure(id);
    return version;
  }

  private long ensure(UUID id) {
    long current = current(id);
    if (current > 0) return current;
    if (!due(id)) throw error(HttpStatus.CONFLICT, "RECAP_NOT_READY");
    publish(id, 1);
    return 1;
  }

  private boolean due(UUID id) {
    return Boolean.TRUE.equals(
        database.queryForObject(
            """
        SELECT published_at IS NOT NULL AND clock_timestamp() >= ends_at + interval '24 hours'
        FROM competitions WHERE id = ?
        """,
            Boolean.class,
            id));
  }

  private void publish(UUID id, long version) {
    UUID result = UUID.randomUUID();
    database.update(
        "INSERT INTO competition_results (id, competition_id, version) VALUES (?, ?, ?)",
        result,
        id,
        version);
    database.update(
        """
        INSERT INTO competition_result_entries
          (result_id, competition_id, entry_id, owner_id, revision_id, total_hundredths, whole_hot_dogs, score_excluded)
        SELECT ?, e.competition_id, e.id, m.owner_id, e.revision_id,
          COALESCE(e.adjusted_total_hundredths, r.total_hundredths),
          COALESCE(e.adjusted_whole_hot_dogs, r.whole_hot_dogs), e.score_excluded
        FROM competition_entries e JOIN meals m ON m.id = e.meal_id JOIN meal_revisions r ON r.id = e.revision_id
        WHERE e.competition_id = ? AND NOT e.withdrawn
        """,
        result,
        id);
    String scores =
        """
        WITH scores AS (
          SELECT owner_id, SUM(CASE WHEN score_excluded THEN 0 ELSE total_hundredths END) AS total,
            SUM(CASE WHEN score_excluded THEN 0 ELSE whole_hot_dogs END) AS whole
          FROM competition_result_entries WHERE result_id = ? GROUP BY owner_id
        )
        INSERT INTO competition_result_participants (result_id, user_id, display_name, rank, total_hundredths, whole_hot_dogs)
        """;
    if (version == 1)
      database.update(
          scores
              + """
          SELECT ?, u.id, u.display_name, RANK() OVER (ORDER BY COALESCE(s.total, 0) DESC),
            COALESCE(s.total, 0), COALESCE(s.whole, 0)
          FROM competition_memberships m JOIN app_users u ON u.id = m.user_id
          LEFT JOIN scores s ON s.owner_id = u.id
          WHERE m.competition_id = ? AND (m.status = 'ACTIVE' OR s.owner_id IS NOT NULL)
          """,
          result,
          result,
          id);
    else
      database.update(
          scores
              + """
          SELECT ?, p.user_id, p.display_name, RANK() OVER (ORDER BY COALESCE(s.total, 0) DESC),
            COALESCE(s.total, 0), COALESCE(s.whole, 0)
          FROM competition_result_participants p LEFT JOIN scores s ON s.owner_id = p.user_id
          WHERE p.result_id = (SELECT id FROM competition_results WHERE competition_id = ? AND version = 1)
          """,
          result,
          result,
          id);
    database.update("UPDATE competitions SET current_result_version = ? WHERE id = ?", version, id);
  }

  private Result result(UUID id, long version) {
    if (version < 1) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    var rows =
        database.query(
            """
        SELECT * FROM competition_results WHERE competition_id = ? AND version = ?
        """,
            (rs, i) ->
                new Result(
                    rs.getObject("id", UUID.class),
                    new Version(
                        version,
                        version == 1 ? "FINAL" : "REVISED",
                        rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                        rs.getInt("calculation_version"))),
            id,
            version);
    if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    return rows.getFirst();
  }

  private long current(UUID id) {
    return database.queryForObject(
        "SELECT COALESCE(current_result_version, 0) FROM competitions WHERE id = ?",
        Long.class,
        id);
  }

  private void lock(UUID id) {
    if (database.queryForList("SELECT id FROM competitions WHERE id = ? FOR UPDATE", id).isEmpty())
      throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
  }

  private CompetitionService.Competition member(UUID id, UUID user) {
    if (user == null) throw error(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    var competition = competitions.get(id, user);
    if (competition.viewerRole() == CompetitionService.Role.NONE)
      throw error(HttpStatus.FORBIDDEN, "MEMBERS_ONLY");
    return competition;
  }

  private String fingerprint(UUID competition, UUID entry, Correction change) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(
                      (competition + ":" + entry + ":" + json.writeValueAsString(change))
                          .getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private void validatePage(int page) {
    if (page < 0 || page > 1000) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
  }

  private CompetitionException error(HttpStatus status, String code) {
    return new CompetitionException(status, code);
  }
}
