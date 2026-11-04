package com.glizzygauntlet.api.competitions;

import com.glizzygauntlet.api.auth.AuthProperties;
import com.glizzygauntlet.api.auth.GlobalRoleService;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CompetitionService {
  public static final UUID ALL_TIME_ID = UUID.fromString("00000000-0000-4000-8000-000000000000");
  private static final SecureRandom RANDOM = new SecureRandom();
  private final JdbcTemplate database;
  private final AuthProperties auth;
  private final GlobalRoleService globalRoles;

  public CompetitionService(
      JdbcTemplate database, AuthProperties auth, GlobalRoleService globalRoles) {
    this.database = database;
    this.auth = auth;
    this.globalRoles = globalRoles;
  }

  public enum Visibility {
    PUBLIC,
    PRIVATE
  }

  public enum TrackingMode {
    COUNT,
    LENGTH,
    BOTH
  }

  public enum Role {
    NONE,
    MEMBER,
    ORGANIZER
  }

  public enum Phase {
    DRAFT,
    SCHEDULED,
    ACTIVE,
    GRACE,
    CLOSED,
    FINALIZED,
    REVISED
  }

  public record Settings(
      @NotBlank @Size(max = 120) String name,
      @NotNull @Size(max = 5000) String rules,
      @NotNull Visibility visibility,
      @NotBlank @Size(max = 80) String timeZone,
      @NotNull Instant startsAt,
      @NotNull Instant endsAt,
      @NotNull Boolean allowSharedMeals,
      TrackingMode trackingMode) {
    public Settings {
      if (trackingMode == null) trackingMode = TrackingMode.BOTH;
    }

    public Settings(
        String name,
        String rules,
        Visibility visibility,
        String timeZone,
        Instant startsAt,
        Instant endsAt,
        Boolean allowSharedMeals) {
      this(
          name, rules, visibility, timeZone, startsAt, endsAt, allowSharedMeals, TrackingMode.BOTH);
    }
  }

  public record Competition(
      UUID id,
      String name,
      String rules,
      Visibility visibility,
      String timeZone,
      Instant startsAt,
      Instant endsAt,
      Instant submissionClosesAt,
      boolean allowSharedMeals,
      TrackingMode trackingMode,
      boolean allTime,
      boolean published,
      long version,
      Phase phase,
      Role viewerRole,
      boolean canAdminister,
      long memberCount) {}

  public record Page(List<Competition> items, boolean hasMore) {}

  public record Member(UUID id, String displayName, Role role, String status) {}

  public record MemberPage(List<Member> items, boolean hasMore) {}

  public record Invitation(
      UUID id, Instant createdAt, Instant expiresAt, Instant revokedAt, boolean active) {}

  public record CreatedInvitation(UUID id, String inviteUrl, Instant expiresAt) {}

  public record InvitationPreview(
      UUID competitionId,
      String name,
      String rules,
      String timeZone,
      Instant startsAt,
      Instant endsAt,
      boolean allowSharedMeals,
      Instant expiresAt) {}

  private record Row(
      UUID id,
      UUID organizerId,
      Settings settings,
      Instant publishedAt,
      long version,
      long resultVersion,
      boolean allTime) {}

  private record InviteRow(UUID id, UUID competitionId, Instant expiresAt, Instant revokedAt) {}

  public Page list(UUID user, String scope, int page) {
    if (!List.of("public", "mine", "joined", "administered", "participating").contains(scope)
        || page < 0
        || page > 1000) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    if (!scope.equals("public")) requireUser(user);
    String filter;
    Object[] args;
    if (scope.equals("public")) {
      filter = "published_at IS NOT NULL AND visibility = 'PUBLIC'";
      args = new Object[] {page * 20};
    } else if (scope.equals("administered")) {
      filter = "((NOT c.all_time AND c.organizer_id = ?) OR (c.all_time AND ?))";
      args = new Object[] {user, globalRoles.isAdmin(user), page * 20};
    } else {
      filter =
          "EXISTS (SELECT 1 FROM competition_memberships m WHERE m.competition_id = c.id AND m.user_id = ? AND m.status = 'ACTIVE')"
              + (scope.equals("joined") ? " AND published_at IS NOT NULL" : "")
              + (scope.equals("participating")
                  ? " AND (c.all_time OR c.organizer_id IS DISTINCT FROM ?) AND NOT (c.all_time AND ?)"
                  : "");
      args =
          scope.equals("participating")
              ? new Object[] {user, user, globalRoles.isAdmin(user), page * 20}
              : new Object[] {user, page * 20};
    }
    var rows =
        database.query(
            "SELECT c.* FROM competitions c WHERE "
                + filter
                + " ORDER BY all_time DESC, created_at DESC, id LIMIT 21 OFFSET ?",
            this::mapRow,
            args);
    Instant now = now();
    return new Page(
        rows.stream().limit(20).map(row -> view(row, user, now)).toList(), rows.size() > 20);
  }

  public Competition get(UUID id, UUID user) {
    var row = row(id, false);
    requireVisible(row, user);
    return view(row, user, now());
  }

  @Transactional
  public void enrollAllTime(UUID user) {
    database.update(
        """
        INSERT INTO competitions (id, name, rules, visibility, time_zone, starts_at,
          allow_shared_meals, tracking_mode, published_at, all_time)
        VALUES (?, 'All-time Glizzy Gauntlet',
          'A permanent, friendly hot dog count leaderboard. Submit meals explicitly to share them with members. Leave at any time to withdraw your submissions; private meal records remain yours.',
          'PUBLIC', 'UTC', '1970-01-01T00:00:00Z', true, 'COUNT', clock_timestamp(), true)
        ON CONFLICT (id) DO NOTHING
        """,
        ALL_TIME_ID);
    database.update(
        "INSERT INTO competition_memberships (competition_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
        ALL_TIME_ID,
        user);
  }

  @Transactional
  public Competition leave(UUID id, UUID user) {
    requireUser(user);
    var row = row(id, true);
    requireVisible(row, user);
    if (!row.allTime()) throw error(HttpStatus.CONFLICT, "LEAVING_NOT_SUPPORTED");
    int changed =
        database.update(
            "UPDATE competition_memberships SET status = 'LEFT' WHERE competition_id = ? AND user_id = ? AND status = 'ACTIVE'",
            id,
            user);
    if (changed > 0) {
      database.update(
          """
          WITH withdrawn AS (
            UPDATE competition_entries e SET withdrawn = true, version = e.version + 1
            FROM meals m WHERE m.id = e.meal_id AND m.owner_id = ? AND e.competition_id = ? AND NOT e.withdrawn
            RETURNING e.id, e.revision_id
          )
          INSERT INTO competition_entry_events
            (id, entry_id, actor_id, action, before_revision, after_revision, was_withdrawn, is_withdrawn, reason)
          SELECT gen_random_uuid(), id, ?, 'WITHDRAWN', revision_id, revision_id, false, true,
            'Left all-time competition' FROM withdrawn
          """,
          user,
          id,
          user);
      event(id, user, "MEMBER_LEFT", user, null);
    }
    return view(row, user, now());
  }

  @Transactional
  public Competition create(UUID user, Settings settings) {
    requireUser(user);
    validate(settings);
    Instant now = now();
    requireFutureStart(settings, now);
    UUID id = UUID.randomUUID();
    database.update(
        """
        INSERT INTO competitions (id, organizer_id, name, rules, visibility, time_zone, starts_at, ends_at, allow_shared_meals, tracking_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        id,
        user,
        settings.name().strip(),
        settings.rules().strip(),
        settings.visibility().name(),
        settings.timeZone(),
        sql(settings.startsAt()),
        sql(settings.endsAt()),
        settings.allowSharedMeals(),
        settings.trackingMode().name());
    database.update(
        "INSERT INTO competition_memberships (competition_id, user_id) VALUES (?, ?)", id, user);
    event(id, user, "CREATED", null, null);
    return view(row(id, false), user, now);
  }

  @Transactional
  public Competition update(UUID id, UUID user, long version, Settings settings) {
    var row = row(id, true);
    requireOrganizer(row, user);
    Instant now = now();
    checkVersion(row, version);
    if (row.allTime()
        || row.resultVersion() > 0
        || (row.publishedAt() != null && !now.isBefore(row.settings().startsAt())))
      throw error(HttpStatus.CONFLICT, "SETTINGS_LOCKED");
    validate(settings);
    requireFutureStart(settings, now);
    database.update(
        """
        UPDATE competitions SET name = ?, rules = ?, visibility = ?, time_zone = ?, starts_at = ?,
        ends_at = ?, allow_shared_meals = ?, tracking_mode = ?, version = version + 1 WHERE id = ?
        """,
        settings.name().strip(),
        settings.rules().strip(),
        settings.visibility().name(),
        settings.timeZone(),
        sql(settings.startsAt()),
        sql(settings.endsAt()),
        settings.allowSharedMeals(),
        settings.trackingMode().name(),
        id);
    event(id, user, "SETTINGS_UPDATED", null, null);
    return view(row(id, false), user, now);
  }

  @Transactional
  public Competition publish(UUID id, UUID user, long version) {
    var row = row(id, true);
    requireOrganizer(row, user);
    checkVersion(row, version);
    Instant now = now();
    if (row.publishedAt() == null) {
      requireFutureStart(row.settings(), now);
      database.update(
          "UPDATE competitions SET published_at = clock_timestamp(), version = version + 1 WHERE id = ?",
          id);
      event(id, user, "PUBLISHED", null, null);
    }
    return view(row(id, false), user, now);
  }

  @Transactional
  public Competition join(UUID id, UUID user) {
    requireUser(user);
    var row = row(id, true);
    requireVisible(row, user);
    return addMember(row, user, now());
  }

  public MemberPage members(UUID id, UUID user, int page) {
    var row = row(id, false);
    if (!canAdminister(row, user)) requireMember(row, user);
    if (page < 0 || page > 1000) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    var members =
        database.query(
            """
        SELECT u.id, u.display_name, m.status, a.user_id IS NOT NULL AS is_admin
        FROM competition_memberships m JOIN app_users u ON u.id = m.user_id
        LEFT JOIN account_roles a ON a.user_id = u.id AND a.role = 'ADMIN'
        WHERE m.competition_id = ?
        AND (NOT ? OR m.status = 'ACTIVE') ORDER BY m.joined_at, u.id LIMIT 51 OFFSET ?
        """,
            (rs, i) ->
                new Member(
                    rs.getObject("id", UUID.class),
                    rs.getString("display_name"),
                    (row.allTime()
                            ? rs.getBoolean("is_admin")
                            : Objects.equals(row.organizerId(), rs.getObject("id", UUID.class)))
                        ? Role.ORGANIZER
                        : Role.MEMBER,
                    rs.getString("status")),
            id,
            row.allTime(),
            page * 50);
    return new MemberPage(members.stream().limit(50).toList(), members.size() > 50);
  }

  @Transactional
  public void exclude(UUID id, UUID user, UUID target, String reason) {
    var row = row(id, true);
    requireOrganizer(row, user);
    if (target.equals(user)
        || (row.allTime()
            ? globalRoles.isAdmin(target)
            : Objects.equals(row.organizerId(), target)))
      throw error(HttpStatus.CONFLICT, "CANNOT_EXCLUDE_ORGANIZER");
    if (reason == null || reason.isBlank() || reason.length() > 500)
      throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    int changed =
        database.update(
            """
        UPDATE competition_memberships SET status = 'EXCLUDED'
        WHERE competition_id = ? AND user_id = ? AND status = 'ACTIVE'
        """,
            id,
            target);
    if (changed == 0) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    event(id, user, "MEMBER_EXCLUDED", target, reason.strip());
  }

  public List<Invitation> invitations(UUID id, UUID user) {
    requireOrganizer(row(id, false), user);
    return database.query(
        """
        SELECT i.*, LEAST(i.expires_at, c.ends_at) AS current_expires_at,
        (i.revoked_at IS NULL AND LEAST(i.expires_at, c.ends_at) > clock_timestamp()) AS active
        FROM competition_invitations i JOIN competitions c ON c.id = i.competition_id
        WHERE i.competition_id = ? ORDER BY active DESC, i.created_at DESC
        LIMIT 50
        """,
        (rs, i) ->
            new Invitation(
                rs.getObject("id", UUID.class),
                instant(rs, "created_at"),
                instant(rs, "current_expires_at"),
                instant(rs, "revoked_at"),
                rs.getBoolean("active")),
        id);
  }

  @Transactional
  public CreatedInvitation invite(UUID id, UUID user) {
    var row = row(id, true);
    requireOrganizer(row, user);
    Instant now = now();
    requireJoiningOpen(row, now);
    long count =
        database.queryForObject(
            """
        SELECT count(*) FROM competition_invitations
        WHERE competition_id = ? AND revoked_at IS NULL AND expires_at > clock_timestamp()
        """,
            Long.class,
            id);
    if (count >= 20) throw error(HttpStatus.CONFLICT, "INVITATION_LIMIT");
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    UUID invitation = UUID.randomUUID();
    Instant expiry = now.plus(Duration.ofDays(7));
    if (row.settings().endsAt() != null && expiry.isAfter(row.settings().endsAt()))
      expiry = row.settings().endsAt();
    database.update(
        "INSERT INTO competition_invitations (id, competition_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
        invitation,
        id,
        hash(token),
        sql(expiry));
    event(id, user, "INVITATION_CREATED", null, null);
    return new CreatedInvitation(invitation, auth.origin() + "/join?token=" + token, expiry);
  }

  @Transactional
  public void revoke(UUID id, UUID user, UUID invitation) {
    requireOrganizer(row(id, true), user);
    int changed =
        database.update(
            """
        UPDATE competition_invitations SET revoked_at = coalesce(revoked_at, clock_timestamp())
        WHERE id = ? AND competition_id = ?
        """,
            invitation,
            id);
    if (changed == 0) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    event(id, user, "INVITATION_REVOKED", null, null);
  }

  @Transactional(readOnly = true)
  public InvitationPreview inspect(String token) {
    var invitation = invitation(token, false);
    var row = row(invitation.competitionId(), false);
    validInvitation(invitation, row, now());
    var s = row.settings();
    return new InvitationPreview(
        row.id(),
        s.name(),
        s.rules(),
        s.timeZone(),
        s.startsAt(),
        s.endsAt(),
        s.allowSharedMeals(),
        invitation.expiresAt());
  }

  @Transactional
  public Competition joinInvitation(UUID user, String token) {
    requireUser(user);
    var initial = invitation(token, false);
    var row = row(initial.competitionId(), true);
    var invitation = invitation(token, true);
    Instant now = now();
    validInvitation(invitation, row, now);
    return addMember(row, user, now);
  }

  private Competition addMember(Row row, UUID user, Instant now) {
    String status = memberStatus(row.id(), user);
    if ("EXCLUDED".equals(status)) throw error(HttpStatus.FORBIDDEN, "MEMBERSHIP_EXCLUDED");
    if (!"ACTIVE".equals(status)) {
      requireJoiningOpen(row, now);
      database.update(
          "INSERT INTO competition_memberships (competition_id, user_id) VALUES (?, ?) ON CONFLICT (competition_id, user_id) DO UPDATE SET status = 'ACTIVE', joined_at = clock_timestamp()",
          row.id(),
          user);
      event(row.id(), user, "MEMBER_JOINED", user, null);
    }
    return view(row, user, now);
  }

  private void validInvitation(InviteRow invite, Row row, Instant now) {
    if (invite.revokedAt() != null
        || row.resultVersion() > 0
        || !now.isBefore(invite.expiresAt())
        || row.publishedAt() == null
        || (row.settings().endsAt() != null && !now.isBefore(row.settings().endsAt())))
      throw error(HttpStatus.BAD_REQUEST, "INVALID_INVITATION");
  }

  private void requireJoiningOpen(Row row, Instant now) {
    if (row.publishedAt() == null) throw error(HttpStatus.CONFLICT, "PUBLISH_FIRST");
    if (row.resultVersion() > 0
        || (row.settings().endsAt() != null && !now.isBefore(row.settings().endsAt())))
      throw error(HttpStatus.CONFLICT, "JOINING_CLOSED");
  }

  private InviteRow invitation(String token, boolean lock) {
    if (token == null || !token.matches("[A-Za-z0-9_-]{43}"))
      throw error(HttpStatus.BAD_REQUEST, "INVALID_INVITATION");
    var matches =
        database.query(
            "SELECT * FROM competition_invitations WHERE token_hash = ?"
                + (lock ? " FOR UPDATE" : ""),
            (rs, i) ->
                new InviteRow(
                    rs.getObject("id", UUID.class),
                    rs.getObject("competition_id", UUID.class),
                    instant(rs, "expires_at"),
                    instant(rs, "revoked_at")),
            hash(token));
    if (matches.isEmpty()) throw error(HttpStatus.BAD_REQUEST, "INVALID_INVITATION");
    return matches.getFirst();
  }

  private void requireVisible(Row row, UUID user) {
    if (role(row, user) == Role.NONE
        && (row.publishedAt() == null || row.settings().visibility() == Visibility.PRIVATE))
      throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
  }

  private void requireMember(Row row, UUID user) {
    requireUser(user);
    requireVisible(row, user);
    if (role(row, user) == Role.NONE) throw error(HttpStatus.FORBIDDEN, "MEMBERS_ONLY");
  }

  private void requireOrganizer(Row row, UUID user) {
    if (canAdminister(row, user)) return;
    requireMember(row, user);
    throw error(HttpStatus.FORBIDDEN, "ORGANIZER_ONLY");
  }

  private boolean canAdminister(Row row, UUID user) {
    return row.allTime() ? globalRoles.isAdmin(user) : role(row, user) == Role.ORGANIZER;
  }

  private void requireUser(UUID user) {
    if (user == null) throw error(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
  }

  private Role role(Row row, UUID user) {
    if (user == null || !"ACTIVE".equals(memberStatus(row.id(), user))) return Role.NONE;
    return (row.allTime() ? globalRoles.isAdmin(user) : Objects.equals(row.organizerId(), user))
        ? Role.ORGANIZER
        : Role.MEMBER;
  }

  private String memberStatus(UUID id, UUID user) {
    if (user == null) return null;
    var statuses =
        database.queryForList(
            "SELECT status FROM competition_memberships WHERE competition_id = ? AND user_id = ?",
            String.class,
            id,
            user);
    return statuses.isEmpty() ? null : statuses.getFirst();
  }

  private Competition view(Row row, UUID user, Instant now) {
    var s = row.settings();
    Instant close = s.endsAt() == null ? null : s.endsAt().plus(Duration.ofHours(24));
    Phase phase =
        row.allTime()
            ? Phase.ACTIVE
            : row.resultVersion() > 0
                ? (row.resultVersion() == 1 ? Phase.FINALIZED : Phase.REVISED)
                : row.publishedAt() == null
                    ? Phase.DRAFT
                    : now.isBefore(s.startsAt())
                        ? Phase.SCHEDULED
                        : now.isBefore(s.endsAt())
                            ? Phase.ACTIVE
                            : now.isBefore(close) ? Phase.GRACE : Phase.CLOSED;
    long count =
        database.queryForObject(
            "SELECT count(*) FROM competition_memberships WHERE competition_id = ? AND status = 'ACTIVE'",
            Long.class,
            row.id());
    return new Competition(
        row.id(),
        s.name(),
        s.rules(),
        s.visibility(),
        s.timeZone(),
        s.startsAt(),
        s.endsAt(),
        close,
        s.allowSharedMeals(),
        s.trackingMode(),
        row.allTime(),
        row.publishedAt() != null,
        row.version(),
        phase,
        role(row, user),
        canAdminister(row, user),
        count);
  }

  private Row row(UUID id, boolean lock) {
    var rows =
        database.query(
            "SELECT * FROM competitions WHERE id = ?" + (lock ? " FOR UPDATE" : ""),
            this::mapRow,
            id);
    if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND");
    return rows.getFirst();
  }

  private Row mapRow(ResultSet rs, int index) throws SQLException {
    return new Row(
        rs.getObject("id", UUID.class),
        rs.getObject("organizer_id", UUID.class),
        new Settings(
            rs.getString("name"),
            rs.getString("rules"),
            Visibility.valueOf(rs.getString("visibility")),
            rs.getString("time_zone"),
            instant(rs, "starts_at"),
            instant(rs, "ends_at"),
            rs.getBoolean("allow_shared_meals"),
            TrackingMode.valueOf(rs.getString("tracking_mode"))),
        instant(rs, "published_at"),
        rs.getLong("version"),
        rs.getLong("current_result_version"),
        rs.getBoolean("all_time"));
  }

  private void validate(Settings s) {
    if (!ZoneId.getAvailableZoneIds().contains(s.timeZone()))
      throw error(HttpStatus.BAD_REQUEST, "INVALID_TIME_ZONE");
    if (!s.endsAt().isAfter(s.startsAt())
        || s.endsAt().isAfter(Instant.parse("9999-12-30T00:00:00Z"))
        || s.startsAt().getNano() % 1_000_000 != 0
        || s.endsAt().getNano() % 1_000_000 != 0)
      throw error(HttpStatus.BAD_REQUEST, "INVALID_WINDOW");
  }

  private void requireFutureStart(Settings s, Instant now) {
    if (!s.startsAt().isAfter(now)) throw error(HttpStatus.CONFLICT, "START_MUST_BE_FUTURE");
  }

  private void checkVersion(Row row, long version) {
    if (row.version() != version) throw error(HttpStatus.CONFLICT, "VERSION_CONFLICT");
  }

  private void event(UUID competition, UUID actor, String action, UUID target, String reason) {
    database.update(
        """
        INSERT INTO competition_events (id, competition_id, actor_id, action, target_user_id, reason)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        UUID.randomUUID(),
        competition,
        actor,
        action,
        target,
        reason);
  }

  private Instant now() {
    return database.queryForObject("SELECT clock_timestamp()", OffsetDateTime.class).toInstant();
  }

  private static Instant instant(ResultSet rs, String column) throws SQLException {
    var value = rs.getObject(column, OffsetDateTime.class);
    return value == null ? null : value.toInstant();
  }

  private static OffsetDateTime sql(Instant value) {
    return value.atOffset(java.time.ZoneOffset.UTC);
  }

  private static String hash(String token) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private static CompetitionException error(HttpStatus status, String code) {
    return new CompetitionException(status, code);
  }
}
