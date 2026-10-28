package com.glizzygauntlet.api.directory;

import com.glizzygauntlet.api.competitions.CompetitionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class DirectoryService {
  private final JdbcTemplate database;
  private final ImageStore images;
  private final CompetitionService competitions;
  private final long storageLimit;

  public DirectoryService(
      JdbcTemplate database,
      ImageStore images,
      CompetitionService competitions,
      @Value("${app.media.max-bytes:536870912}") long storageLimit) {
    this.database = database;
    this.images = images;
    this.competitions = competitions;
    this.storageLimit = storageLimit;
  }

  public record MenuInput(
      @NotBlank @Size(max = 120) String name, @NotNull @Size(max = 1000) String description) {}

  public record Input(
      UUID venueId,
      UUID baseRevision,
      @NotBlank @Size(max = 120) String name,
      @NotBlank @Size(max = 300) String address,
      @NotNull @Size(max = 2000) String description,
      @NotNull @DecimalMin("-90") @DecimalMax("90") Double latitude,
      @NotNull @DecimalMin("-180") @DecimalMax("180") Double longitude,
      @NotNull @Size(max = 20) List<@NotNull @Valid MenuInput> menuItems) {}

  public record MenuItem(UUID id, String name, String description) {}

  public record Photo(UUID id, UUID menuItemId) {}

  public record Venue(
      UUID id,
      UUID revision,
      String name,
      String address,
      String description,
      double latitude,
      double longitude,
      List<MenuItem> menuItems,
      List<Photo> photos) {}

  public record VenuePage(List<Venue> items, boolean hasMore) {}

  public record Contribution(
      UUID id, String status, String reviewReason, boolean own, Venue venue) {}

  public record ContributionPage(List<Contribution> items, boolean hasMore) {}

  private record Row(
      UUID id,
      UUID venueId,
      UUID contributor,
      UUID baseRevision,
      String status,
      String reviewReason,
      String name,
      String address,
      String description,
      double latitude,
      double longitude) {}

  public VenuePage list(int page, Double south, Double north, Double west, Double east) {
    validatePage(page);
    boolean bounds = south != null || north != null || west != null || east != null;
    if (bounds
        && (south == null
            || north == null
            || west == null
            || east == null
            || !Double.isFinite(south)
            || !Double.isFinite(north)
            || !Double.isFinite(west)
            || !Double.isFinite(east)
            || south < -90
            || north > 90
            || west < -180
            || east > 180
            || south > north
            || west > east)) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    var rows =
        database.query(
            "SELECT c.* FROM directory_venues v JOIN directory_contributions c ON c.id = v.current_revision "
                + "WHERE NOT v.hidden "
                + (bounds ? "AND c.latitude BETWEEN ? AND ? AND c.longitude BETWEEN ? AND ? " : "")
                + "ORDER BY lower(c.name), v.id LIMIT 21 OFFSET ?",
            this::map,
            bounds ? new Object[] {south, north, west, east, page * 20} : new Object[] {page * 20});
    return new VenuePage(rows.stream().limit(20).map(this::venue).toList(), rows.size() > 20);
  }

  public Venue get(UUID id) {
    var rows =
        database.query(
            "SELECT c.* FROM directory_venues v JOIN directory_contributions c ON c.id = v.current_revision WHERE v.id = ? AND NOT v.hidden",
            this::map,
            id);
    if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    return venue(rows.getFirst());
  }

  public ContributionPage contributions(UUID user, String scope, int page) {
    requireUser(user);
    validatePage(page);
    if (!List.of("mine", "pending", "all").contains(scope))
      throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    if (!scope.equals("mine")) requireOwner(user);
    var rows =
        database.query(
            "SELECT * FROM directory_contributions WHERE "
                + (scope.equals("mine")
                    ? "contributor_id = ?"
                    : scope.equals("pending") ? "status = 'PENDING'" : "TRUE")
                + " ORDER BY created_at DESC, id LIMIT 21 OFFSET ?",
            this::map,
            scope.equals("mine") ? new Object[] {user, page * 20} : new Object[] {page * 20});
    return new ContributionPage(
        rows.stream().limit(20).map(row -> contribution(row, user)).toList(), rows.size() > 20);
  }

  public Contribution contribution(UUID id, UUID user) {
    var row = row(id, false);
    requireContributorOrOwner(row, user);
    return contribution(row, user);
  }

  @Transactional
  public Contribution create(UUID user, Input input) {
    requireUser(user);
    database.queryForList("SELECT id FROM app_users WHERE id = ? FOR UPDATE", user);
    if (count(
            "SELECT count(*) FROM directory_contributions WHERE contributor_id = ? AND status IN ('DRAFT', 'PENDING')",
            user)
        >= 20) throw error(HttpStatus.CONFLICT, "CONTRIBUTION_LIMIT");
    if (!Double.isFinite(input.latitude()) || !Double.isFinite(input.longitude()))
      throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    UUID venueId = input.venueId();
    if (venueId == null) {
      if (input.baseRevision() != null) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
      venueId = UUID.randomUUID();
      database.update("INSERT INTO directory_venues (id) VALUES (?)", venueId);
    } else {
      var current = get(venueId);
      if (!current.revision().equals(input.baseRevision()))
        throw error(HttpStatus.CONFLICT, "VERSION_CONFLICT");
    }
    UUID id = UUID.randomUUID();
    database.update(
        """
        INSERT INTO directory_contributions
        (id, venue_id, contributor_id, base_revision, name, address, description, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        id,
        venueId,
        user,
        input.baseRevision(),
        input.name().strip(),
        input.address().strip(),
        input.description().strip(),
        input.latitude(),
        input.longitude());
    int position = 0;
    for (var item : input.menuItems())
      database.update(
          "INSERT INTO directory_menu_items (id, contribution_id, position, name, description) VALUES (?, ?, ?, ?, ?)",
          UUID.randomUUID(),
          id,
          position++,
          item.name().strip(),
          item.description().strip());
    return contribution(row(id, false), user);
  }

  @Transactional
  public Contribution submit(UUID id, UUID user) {
    var row = row(id, true);
    requireContributor(row, user);
    requireDraft(row);
    database.update("UPDATE directory_contributions SET status = 'PENDING' WHERE id = ?", id);
    return contribution(row(id, false), user);
  }

  @Transactional
  public Photo upload(UUID id, UUID user, UUID menuItem, byte[] bytes) {
    var row = row(id, true);
    requireContributor(row, user);
    requireDraft(row);
    if (menuItem != null
        && count(
                "SELECT count(*) FROM directory_menu_items WHERE id = ? AND contribution_id = ?",
                menuItem,
                id)
            == 0) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    // Serialize decoding and quota checks to bound memory and disk use across concurrent uploads.
    database.queryForList("SELECT pg_advisory_xact_lock(67598231)");
    if (count("SELECT count(*) FROM directory_photos WHERE contribution_id = ?", id) >= 10
        || count(
                "SELECT count(*) FROM directory_photos p JOIN directory_contributions c ON c.id = p.contribution_id WHERE c.contributor_id = ?",
                user)
            >= 200) throw error(HttpStatus.CONFLICT, "PHOTO_LIMIT");
    var sanitized = images.sanitize(bytes);
    long size = sanitized.image().length + sanitized.thumbnail().length;
    if (count("SELECT COALESCE(sum(bytes), 0) FROM directory_photos") + size > storageLimit)
      throw error(HttpStatus.CONFLICT, "STORAGE_LIMIT");
    UUID photo = UUID.randomUUID();
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCompletion(int status) {
            if (status != STATUS_COMMITTED) images.delete(photo);
          }
        });
    images.write(photo, sanitized);
    database.update(
        "INSERT INTO directory_photos (id, contribution_id, menu_item_id, bytes) VALUES (?, ?, ?, ?)",
        photo,
        id,
        menuItem,
        size);
    return new Photo(photo, menuItem);
  }

  @Transactional
  public void discard(UUID id, UUID user) {
    var row = row(id, true);
    requireContributor(row, user);
    if (row.status().equals("APPROVED")) throw error(HttpStatus.CONFLICT, "CONTRIBUTION_LOCKED");
    var photos = photos(id);
    database.update("DELETE FROM directory_contributions WHERE id = ?", id);
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            photos.forEach(photo -> images.delete(photo.id()));
          }
        });
  }

  @Transactional
  public Contribution review(UUID id, UUID user, boolean approve, String reason) {
    requireOwner(user);
    var row = row(id, true);
    if (!row.status().equals("PENDING")) throw error(HttpStatus.CONFLICT, "CONTRIBUTION_LOCKED");
    var current =
        database.queryForList(
            "SELECT current_revision FROM directory_venues WHERE id = ? FOR UPDATE",
            UUID.class,
            row.venueId());
    if (approve && !java.util.Objects.equals(current.getFirst(), row.baseRevision()))
      throw error(HttpStatus.CONFLICT, "VERSION_CONFLICT");
    database.update(
        "UPDATE directory_contributions SET status = ?, review_reason = ? WHERE id = ?",
        approve ? "APPROVED" : "REJECTED",
        reason.strip(),
        id);
    if (approve)
      database.update(
          "UPDATE directory_venues SET current_revision = ? WHERE id = ?", id, row.venueId());
    event(row.venueId(), id, user, approve ? "APPROVED" : "REJECTED", reason);
    return contribution(row(id, false), user);
  }

  @Transactional
  public void hide(UUID id, UUID user, boolean hidden, String reason) {
    requireOwner(user);
    if (database.update(
            "UPDATE directory_venues SET hidden = ? WHERE id = ? AND current_revision IS NOT NULL",
            hidden,
            id)
        == 0) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    event(id, null, user, hidden ? "HIDDEN" : "RESTORED", reason);
  }

  public byte[] photo(UUID id, UUID user, boolean thumbnail) {
    var allowed =
        database.queryForList(
            """
        SELECT p.id FROM directory_photos p JOIN directory_contributions c ON c.id = p.contribution_id
        JOIN directory_venues v ON v.id = c.venue_id
        WHERE p.id = ? AND (
          (v.current_revision = c.id AND NOT v.hidden)
          OR c.contributor_id = ? OR EXISTS (SELECT 1 FROM app_users u WHERE u.id = ? AND u.site_owner))
        """,
            UUID.class,
            id,
            user,
            user);
    if (allowed.isEmpty()) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    return images.read(id, thumbnail);
  }

  public List<Venue> featured(UUID id, UUID user) {
    competitions.get(id, user);
    return database
        .query(
            """
        SELECT c.* FROM competition_featured_venues f JOIN directory_venues v ON v.id = f.venue_id
        JOIN directory_contributions c ON c.id = v.current_revision
        WHERE f.competition_id = ? AND NOT v.hidden ORDER BY lower(c.name), v.id
        """,
            this::map,
            id)
        .stream()
        .map(this::venue)
        .toList();
  }

  @Transactional
  public void feature(UUID id, UUID user, UUID venue, boolean add) {
    database.queryForList("SELECT id FROM competitions WHERE id = ? FOR UPDATE", id);
    if (competitions.get(id, user).viewerRole() != CompetitionService.Role.ORGANIZER)
      throw error(HttpStatus.FORBIDDEN, "ORGANIZER_ONLY");
    if (add) {
      database.queryForList("SELECT id FROM directory_venues WHERE id = ? FOR SHARE", venue);
      get(venue);
      if (count("SELECT count(*) FROM competition_featured_venues WHERE competition_id = ?", id)
              >= 20
          && count(
                  "SELECT count(*) FROM competition_featured_venues WHERE competition_id = ? AND venue_id = ?",
                  id,
                  venue)
              == 0) throw error(HttpStatus.CONFLICT, "FEATURED_LIMIT");
      database.update(
          "INSERT INTO competition_featured_venues (competition_id, venue_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
          id,
          venue);
    } else
      database.update(
          "DELETE FROM competition_featured_venues WHERE competition_id = ? AND venue_id = ?",
          id,
          venue);
  }

  private void event(UUID venue, UUID contribution, UUID user, String action, String reason) {
    database.update(
        "INSERT INTO directory_events (id, venue_id, contribution_id, actor_id, action, reason) VALUES (?, ?, ?, ?, ?, ?)",
        UUID.randomUUID(),
        venue,
        contribution,
        user,
        action,
        reason.strip());
  }

  private Venue venue(Row row) {
    var menu =
        database.query(
            "SELECT * FROM directory_menu_items WHERE contribution_id = ? ORDER BY position",
            (rs, i) ->
                new MenuItem(
                    rs.getObject("id", UUID.class),
                    rs.getString("name"),
                    rs.getString("description")),
            row.id());
    return new Venue(
        row.venueId(),
        row.id(),
        row.name(),
        row.address(),
        row.description(),
        row.latitude(),
        row.longitude(),
        menu,
        photos(row.id()));
  }

  private List<Photo> photos(UUID contribution) {
    return database.query(
        "SELECT id, menu_item_id FROM directory_photos WHERE contribution_id = ? ORDER BY id",
        (rs, i) ->
            new Photo(rs.getObject("id", UUID.class), rs.getObject("menu_item_id", UUID.class)),
        contribution);
  }

  private Contribution contribution(Row row, UUID user) {
    return new Contribution(
        row.id(), row.status(), row.reviewReason(), row.contributor().equals(user), venue(row));
  }

  private Row row(UUID id, boolean lock) {
    var rows =
        database.query(
            "SELECT * FROM directory_contributions WHERE id = ?" + (lock ? " FOR UPDATE" : ""),
            this::map,
            id);
    if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    return rows.getFirst();
  }

  private Row map(ResultSet rs, int index) throws SQLException {
    return new Row(
        rs.getObject("id", UUID.class),
        rs.getObject("venue_id", UUID.class),
        rs.getObject("contributor_id", UUID.class),
        rs.getObject("base_revision", UUID.class),
        rs.getString("status"),
        rs.getString("review_reason"),
        rs.getString("name"),
        rs.getString("address"),
        rs.getString("description"),
        rs.getDouble("latitude"),
        rs.getDouble("longitude"));
  }

  private long count(String sql, Object... args) {
    return database.queryForObject(sql, Long.class, args);
  }

  private void validatePage(int page) {
    if (page < 0 || page > 1000) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
  }

  private void requireUser(UUID user) {
    if (user == null) throw error(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
  }

  private void requireOwner(UUID user) {
    requireUser(user);
    if (count("SELECT count(*) FROM app_users WHERE id = ? AND site_owner", user) == 0)
      throw error(HttpStatus.FORBIDDEN, "OWNER_ONLY");
  }

  private void requireContributor(Row row, UUID user) {
    requireUser(user);
    if (!row.contributor().equals(user)) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
  }

  private void requireContributorOrOwner(Row row, UUID user) {
    requireUser(user);
    if (!row.contributor().equals(user)
        && count("SELECT count(*) FROM app_users WHERE id = ? AND site_owner", user) == 0)
      throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
  }

  private void requireDraft(Row row) {
    if (!row.status().equals("DRAFT")) throw error(HttpStatus.CONFLICT, "CONTRIBUTION_LOCKED");
  }

  private DirectoryException error(HttpStatus status, String code) {
    return new DirectoryException(status, code);
  }
}
