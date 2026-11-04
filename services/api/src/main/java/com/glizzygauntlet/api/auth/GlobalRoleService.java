package com.glizzygauntlet.api.auth;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GlobalRoleService {
  private final JdbcTemplate database;

  public GlobalRoleService(JdbcTemplate database) {
    this.database = database;
  }

  public enum Role {
    ADMIN,
    VENUE_APPROVER
  }

  public record Account(UUID id, String displayName, List<Role> roles) {}

  public record AccountPage(List<Account> items, boolean hasMore) {}

  public List<Role> roles(UUID user) {
    if (user == null) return List.of();
    return database.query(
        "SELECT role FROM account_roles WHERE user_id = ? ORDER BY role",
        (row, i) -> Role.valueOf(row.getString("role")),
        user);
  }

  public boolean isAdmin(UUID user) {
    return roles(user).contains(Role.ADMIN);
  }

  public boolean canReviewVenues(UUID user) {
    var assigned = roles(user);
    return assigned.contains(Role.ADMIN) || assigned.contains(Role.VENUE_APPROVER);
  }

  public AccountPage accounts(UUID actor, String query, int page) {
    requireAdmin(actor);
    if (query == null || query.length() > 80 || page < 0 || page > 1000)
      throw new AuthException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    String search = query.strip();
    var users =
        database.query(
            """
        SELECT id, display_name FROM app_users
        WHERE ? = '' OR position(lower(?) in lower(display_name)) > 0 OR id::text = ?
        ORDER BY lower(display_name), id LIMIT 21 OFFSET ?
        """,
            (row, i) ->
                new Account(
                    row.getObject("id", UUID.class), row.getString("display_name"), List.of()),
            search,
            search,
            search,
            page * 20);
    return new AccountPage(
        users.stream()
            .limit(20)
            .map(user -> new Account(user.id(), user.displayName(), roles(user.id())))
            .toList(),
        users.size() > 20);
  }

  @Transactional
  public Account assign(UUID actor, UUID target, Role role, boolean grant) {
    // Serialize grants and revocations, then recheck the caller so queued requests cannot retain
    // revoked authority.
    database.queryForList(
        "SELECT pg_advisory_xact_lock(hashtextextended('global-role-assignments', 0))");
    requireAdmin(actor);
    var users =
        database.query(
            "SELECT display_name FROM app_users WHERE id = ? FOR UPDATE",
            (row, i) -> row.getString("display_name"),
            target);
    if (users.isEmpty()) throw new AuthException(HttpStatus.NOT_FOUND, "NOT_FOUND");
    if (role == null) throw new AuthException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    if (!grant
        && role == Role.ADMIN
        && isAdmin(target)
        && database.queryForObject(
                "SELECT count(*) FROM account_roles WHERE role = 'ADMIN'", Long.class)
            <= 1) throw new AuthException(HttpStatus.CONFLICT, "LAST_ADMIN");
    int changed =
        grant
            ? database.update(
                "INSERT INTO account_roles (user_id, role, granted_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                target,
                role.name(),
                actor)
            : database.update(
                "DELETE FROM account_roles WHERE user_id = ? AND role = ?", target, role.name());
    if (changed > 0)
      database.update(
          """
        INSERT INTO account_role_events (id, actor_id, target_user_id, role, action, reason)
        VALUES (?, ?, ?, ?, ?, 'Changed through admin role management.')
        """,
          UUID.randomUUID(),
          actor,
          target,
          role.name(),
          grant ? "GRANTED" : "REVOKED");
    return new Account(target, users.getFirst(), roles(target));
  }

  private void requireAdmin(UUID user) {
    if (user == null) throw new AuthException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    if (!isAdmin(user)) throw new AuthException(HttpStatus.FORBIDDEN, "ADMIN_ONLY");
  }
}
