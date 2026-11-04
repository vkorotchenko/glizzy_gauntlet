package com.glizzygauntlet.api.auth;

import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.directory.ImageStore;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class AccountService {
  private final JdbcTemplate database;
  private final CompetitionService competitions;
  private final GlobalRoleService roles;
  private final ImageStore images;
  private final long storageLimit;

  public AccountService(
      JdbcTemplate database,
      CompetitionService competitions,
      GlobalRoleService roles,
      ImageStore images,
      @Value("${app.media.max-bytes:536870912}") long storageLimit) {
    this.database = database;
    this.competitions = competitions;
    this.roles = roles;
    this.images = images;
    this.storageLimit = storageLimit;
  }

  public record Profile(
      UUID id,
      String displayName,
      boolean siteOwner,
      List<String> providers,
      List<GlobalRoleService.Role> roles,
      UUID profilePhotoId) {}

  public Profile profile(UUID id) {
    var profiles =
        database.query(
            "SELECT u.id, u.display_name, p.id AS profile_photo_id FROM app_users u LEFT JOIN profile_photos p ON p.user_id = u.id WHERE u.id = ?",
            (row, index) ->
                new Profile(
                    row.getObject("id", UUID.class),
                    row.getString("display_name"),
                    false,
                    List.of(),
                    List.of(),
                    row.getObject("profile_photo_id", UUID.class)),
            id);
    if (profiles.isEmpty()) throw new AuthException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    var profile = profiles.getFirst();
    var assignedRoles = roles.roles(id);
    return new Profile(
        profile.id(),
        profile.displayName(),
        assignedRoles.contains(GlobalRoleService.Role.ADMIN),
        database.queryForList(
            "SELECT provider FROM external_identities WHERE user_id = ? ORDER BY provider",
            String.class,
            id),
        assignedRoles,
        profile.profilePhotoId());
  }

  @Transactional
  public Profile findOrCreate(String provider, String subject, String email) {
    lockIdentity(provider, subject);
    UUID existing = identityOwner(provider, subject);
    if (existing != null) {
      competitions.enrollAllTime(existing);
      return profile(existing);
    }
    UUID id = UUID.randomUUID();
    database.update(
        "INSERT INTO app_users (id, display_name) VALUES (?, ?)",
        id,
        "Hot-dog fan " + id.toString().substring(0, 8));
    insertIdentity(id, provider, subject, email);
    competitions.enrollAllTime(id);
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

  @Transactional
  public Profile uploadProfilePhoto(UUID user, UUID expected, byte[] bytes) {
    profile(user);
    database.queryForList("SELECT pg_advisory_xact_lock(67598231)");
    UUID previous = currentPhoto(user);
    requirePhotoMatch(previous, expected);
    var sanitized = images.sanitize(bytes);
    long size = sanitized.image().length + sanitized.thumbnail().length;
    long stored =
        database.queryForObject(
            """
            SELECT (SELECT COALESCE(sum(bytes), 0) FROM directory_photos)
              + (SELECT COALESCE(sum(bytes), 0) FROM meal_photos)
              + (SELECT COALESCE(sum(cover_photo_bytes), 0) FROM competitions)
              + (SELECT COALESCE(sum(bytes), 0) FROM profile_photos)
            """,
            Long.class);
    if (stored + size > storageLimit) throw new AuthException(HttpStatus.CONFLICT, "STORAGE_LIMIT");
    UUID photo = UUID.randomUUID();
    cleanupPhoto(photo, previous);
    images.write(photo, sanitized);
    database.update(
        """
        INSERT INTO profile_photos (user_id, id, bytes) VALUES (?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET id = EXCLUDED.id, bytes = EXCLUDED.bytes
        """,
        user,
        photo,
        size);
    return profile(user);
  }

  @Transactional
  public Profile removeProfilePhoto(UUID user, UUID expected) {
    profile(user);
    database.queryForList("SELECT pg_advisory_xact_lock(67598231)");
    UUID previous = currentPhoto(user);
    requirePhotoMatch(previous, expected);
    database.update("DELETE FROM profile_photos WHERE user_id = ?", user);
    cleanupPhoto(null, previous);
    return profile(user);
  }

  public byte[] profilePhoto(UUID id, UUID user, boolean thumbnail) {
    if (user == null) throw new AuthException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    long visible =
        database.queryForObject(
            """
            SELECT count(*) FROM profile_photos p WHERE p.id = ? AND (
              p.user_id = ? OR EXISTS (
                SELECT 1 FROM competition_memberships author
                JOIN competitions c ON c.id = author.competition_id
                JOIN competition_memberships viewer ON viewer.competition_id = c.id
                WHERE author.user_id = p.user_id AND viewer.user_id = ?
                  AND author.status = 'ACTIVE' AND viewer.status = 'ACTIVE'
                  AND c.published_at IS NOT NULL))
            """,
            Long.class,
            id,
            user,
            user);
    if (visible == 0) throw new AuthException(HttpStatus.NOT_FOUND, "NOT_FOUND");
    return images.read(id, thumbnail);
  }

  private UUID currentPhoto(UUID user) {
    var photos =
        database.queryForList("SELECT id FROM profile_photos WHERE user_id = ?", UUID.class, user);
    return photos.isEmpty() ? null : photos.getFirst();
  }

  private void requirePhotoMatch(UUID current, UUID expected) {
    if (!Objects.equals(current, expected))
      throw new AuthException(HttpStatus.CONFLICT, "PHOTO_CONFLICT");
  }

  private void cleanupPhoto(UUID created, UUID previous) {
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCompletion(int status) {
            UUID discarded = status == STATUS_COMMITTED ? previous : created;
            if (discarded != null) images.delete(discarded);
          }
        });
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
