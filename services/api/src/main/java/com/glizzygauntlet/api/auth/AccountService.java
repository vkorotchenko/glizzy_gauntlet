package com.glizzygauntlet.api.auth;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {
  private final JdbcTemplate database;

  public AccountService(JdbcTemplate database) {
    this.database = database;
  }

  public record Profile(UUID id, String displayName, boolean siteOwner, List<String> providers) {}

  public Profile profile(UUID id) {
    var profiles =
        database.query(
            "SELECT id, display_name, site_owner FROM app_users WHERE id = ?",
            (row, index) ->
                new Profile(
                    row.getObject("id", UUID.class),
                    row.getString("display_name"),
                    row.getBoolean("site_owner"),
                    List.of()),
            id);
    if (profiles.isEmpty()) throw new AuthException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    var profile = profiles.getFirst();
    return new Profile(
        profile.id(),
        profile.displayName(),
        profile.siteOwner(),
        database.queryForList(
            "SELECT provider FROM external_identities WHERE user_id = ? ORDER BY provider",
            String.class,
            id));
  }

  @Transactional
  public Profile findOrCreate(String provider, String subject, String email) {
    lockIdentity(provider, subject);
    UUID existing = identityOwner(provider, subject);
    if (existing != null) return profile(existing);
    UUID id = UUID.randomUUID();
    database.update(
        "INSERT INTO app_users (id, display_name) VALUES (?, ?)",
        id,
        "Hot-dog fan " + id.toString().substring(0, 8));
    insertIdentity(id, provider, subject, email);
    return profile(id);
  }

  @Transactional
  public Profile link(UUID userId, String provider, String subject, String email) {
    lockIdentity(provider, subject);
    database.queryForList("SELECT id FROM app_users WHERE id = ? FOR UPDATE", userId);
    profile(userId);
    UUID existing = identityOwner(provider, subject);
    if (existing != null) {
      if (!existing.equals(userId)) throw new AuthException(HttpStatus.CONFLICT, "IDENTITY_IN_USE");
      return profile(userId);
    }
    if (database.queryForObject(
            "SELECT count(*) FROM external_identities WHERE user_id = ? AND provider = ?",
            Long.class,
            userId,
            provider)
        > 0) {
      throw new AuthException(HttpStatus.CONFLICT, "PROVIDER_ALREADY_LINKED");
    }
    insertIdentity(userId, provider, subject, email);
    return profile(userId);
  }

  @Transactional
  public Profile rename(UUID userId, String displayName) {
    database.update(
        "UPDATE app_users SET display_name = ? WHERE id = ?", displayName.strip(), userId);
    return profile(userId);
  }

  private void lockIdentity(String provider, String subject) {
    database.queryForList(
        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", provider + ":" + subject);
  }

  private UUID identityOwner(String provider, String subject) {
    var owners =
        database.queryForList(
            "SELECT user_id FROM external_identities WHERE provider = ? AND subject = ?",
            UUID.class,
            provider,
            subject);
    return owners.isEmpty() ? null : owners.getFirst();
  }

  private void insertIdentity(UUID id, String provider, String subject, String email) {
    database.update(
        "INSERT INTO external_identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?)",
        provider,
        subject,
        id,
        email);
  }
}
