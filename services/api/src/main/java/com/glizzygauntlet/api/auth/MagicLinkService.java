package com.glizzygauntlet.api.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MagicLinkService {
  private static final Logger LOG = LoggerFactory.getLogger(MagicLinkService.class);
  private final SecureRandom random = new SecureRandom();
  private final JdbcTemplate database;
  private final AccountService accounts;
  private final JavaMailSender mail;
  private final AuthProperties settings;

  public MagicLinkService(
      JdbcTemplate database,
      AccountService accounts,
      JavaMailSender mail,
      AuthProperties settings) {
    this.database = database;
    this.accounts = accounts;
    this.mail = mail;
    this.settings = settings;
  }

  @Transactional
  public void request(String address, UUID linkUserId) {
    if (!settings.emailEnabled())
      throw new AuthException(HttpStatus.SERVICE_UNAVAILABLE, "EMAIL_DISABLED");
    String email = address.strip().toLowerCase(Locale.ROOT);
    database.queryForList("SELECT pg_advisory_xact_lock(738421609217)");
    var counts =
        database.queryForMap(
            """
        SELECT count(*) AS total,
          count(*) FILTER (WHERE email = ?) AS mailbox,
          count(*) FILTER (WHERE email = ? AND created_at > clock_timestamp() - interval '1 minute') AS recent
        FROM magic_link_tokens WHERE created_at > clock_timestamp() - interval '1 hour'
        """,
            email,
            email);
    if (((Number) counts.get("total")).longValue() >= 100
        || ((Number) counts.get("mailbox")).longValue() >= 5
        || ((Number) counts.get("recent")).longValue() > 0) return;
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    database.update(
        """
        INSERT INTO magic_link_tokens (token_hash, email, link_user_id, expires_at)
        VALUES (?, ?, ?, clock_timestamp() + interval '15 minutes')
        """,
        hash(token),
        email,
        linkUserId);
    var message = new SimpleMailMessage();
    message.setFrom(settings.mailFrom());
    message.setTo(email);
    message.setSubject(
        linkUserId == null ? "Sign in to Glizzy Gauntlet" : "Link your Glizzy Gauntlet email");
    message.setText(
        """
        Only continue if you requested this link.
        Open the page and confirm the email address to continue:
        %s/sign-in/confirm?token=%s

        This single-use link expires in 15 minutes. Do not share it.
        """
            .formatted(settings.origin(), token));
    try {
      mail.send(message);
    } catch (MailException failure) {
      LOG.warn("Magic-link delivery failed; check SMTP configuration");
    }
  }

  public record LinkDetails(String email, String purpose) {}

  private record PendingLink(String email, UUID linkUserId) {}

  public LinkDetails inspect(String token) {
    var links =
        database.query(
            """
        SELECT email, link_user_id FROM magic_link_tokens
        WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > clock_timestamp()
        """,
            (row, index) ->
                new PendingLink(row.getString("email"), row.getObject("link_user_id", UUID.class)),
            hash(token));
    if (links.isEmpty()) throw invalidLink();
    var link = links.getFirst();
    return new LinkDetails(link.email(), link.linkUserId() == null ? "sign-in" : "link");
  }

  @Transactional
  public AccountService.Profile consume(String token, UUID currentUserId) {
    var links =
        database.query(
            """
        UPDATE magic_link_tokens SET consumed_at = clock_timestamp()
        WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > clock_timestamp()
        RETURNING email, link_user_id
        """,
            (row, index) ->
                new PendingLink(row.getString("email"), row.getObject("link_user_id", UUID.class)),
            hash(token));
    if (links.isEmpty()) throw invalidLink();
    var link = links.getFirst();
    if (link.linkUserId() != null) {
      if (!link.linkUserId().equals(currentUserId)) {
        throw new AuthException(HttpStatus.CONFLICT, "LINK_REQUIRES_ORIGINAL_ACCOUNT");
      }
      return accounts.link(currentUserId, "email", link.email(), link.email());
    }
    if (currentUserId != null) throw new AuthException(HttpStatus.CONFLICT, "ALREADY_SIGNED_IN");
    return accounts.findOrCreate("email", link.email(), link.email());
  }

  @Scheduled(fixedDelay = 3_600_000)
  public void cleanExpiredTokens() {
    database.update(
        "DELETE FROM magic_link_tokens WHERE created_at < clock_timestamp() - interval '1 day'");
  }

  private String hash(String token) {
    if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw invalidLink();
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is required", impossible);
    }
  }

  private AuthException invalidLink() {
    return new AuthException(HttpStatus.BAD_REQUEST, "INVALID_LINK");
  }
}
