package com.glizzygauntlet.api.competitions;

import com.glizzygauntlet.api.auth.AuthProperties;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CompetitionEmailService {
  private static final Logger LOG = LoggerFactory.getLogger(CompetitionEmailService.class);
  private final JdbcTemplate database;
  private final CompetitionService competitions;
  private final AuthProperties auth;
  private final JavaMailSender mail;

  public CompetitionEmailService(
      JdbcTemplate database,
      CompetitionService competitions,
      AuthProperties auth,
      JavaMailSender mail) {
    this.database = database;
    this.competitions = competitions;
    this.auth = auth;
    this.mail = mail;
  }

  public record InvitationEmail(
      UUID id, String email, String status, String lastError, Instant sentAt) {}

  @Transactional
  public CompetitionService.Competition create(
      UUID user, CompetitionService.Settings settings, List<String> addresses) {
    return create(user, settings, addresses, null);
  }

  @Transactional
  public CompetitionService.Competition create(
      UUID user, CompetitionService.Settings settings, List<String> addresses, byte[] cover) {
    if (addresses == null || addresses.size() > 20) throw invalid();
    var recipients = new LinkedHashSet<String>();
    for (String address : addresses) {
      if (address == null) throw invalid();
      String email = address.strip().toLowerCase(Locale.ROOT);
      if (email.length() > 254 || email.contains("\r") || email.contains("\n")) throw invalid();
      try {
        var parsed = new InternetAddress(email, true);
        parsed.validate();
        if (parsed.getPersonal() != null
            || !email.equals(parsed.getAddress())
            || !email.contains("@")) throw invalid();
      } catch (AddressException invalidAddress) {
        throw invalid();
      }
      recipients.add(email);
    }
    if (!recipients.isEmpty() && !auth.emailEnabled())
      throw new CompetitionException(HttpStatus.SERVICE_UNAVAILABLE, "EMAIL_DISABLED");
    var competition = competitions.create(user, settings, cover);
    for (String email : recipients)
      database.update(
          "INSERT INTO competition_invitation_emails (id, competition_id, email) VALUES (?, ?, ?)",
          UUID.randomUUID(),
          competition.id(),
          email);
    return competition;
  }

  public List<InvitationEmail> list(UUID id, UUID user) {
    requireOrganizer(id, user);
    return rows(id);
  }

  @Transactional
  public List<InvitationEmail> prepare(UUID id, UUID user) {
    requireSendable(id, user);
    database.update(
        "UPDATE competition_invitation_emails SET status = 'PENDING', last_error = NULL WHERE competition_id = ? AND status = 'FAILED'",
        id);
    return rows(id);
  }

  @Transactional
  public List<InvitationEmail> send(UUID id, UUID user) {
    database.queryForList("SELECT id FROM competitions WHERE id = ? FOR UPDATE", id);
    var competition = requireSendable(id, user);
    var queued = rows(id).stream().filter(row -> !row.status().equals("SENT")).toList();
    if (queued.isEmpty()) return rows(id);
    database.queryForList("SELECT pg_advisory_xact_lock(738421609218)");
    database.update(
        "DELETE FROM competition_invitation_email_attempts WHERE attempted_at < clock_timestamp() - interval '1 day'");
    for (var recipient : queued) {
      if (!auth.emailEnabled()) {
        failed(recipient.id(), "EMAIL_DISABLED");
        continue;
      }
      var counts =
          database.queryForMap(
              """
              SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE c.organizer_id = ?) AS organizer,
                COUNT(*) FILTER (WHERE e.email = ?) AS mailbox,
                COUNT(*) FILTER (WHERE e.email = ? AND a.attempted_at > clock_timestamp() - interval '1 minute') AS recent
              FROM competition_invitation_email_attempts a
              JOIN competition_invitation_emails e ON e.id = a.email_id
              JOIN competitions c ON c.id = e.competition_id
              WHERE a.attempted_at > clock_timestamp() - interval '1 hour'
              """,
              user,
              recipient.email(),
              recipient.email());
      if (((Number) counts.get("total")).longValue() >= 100
          || ((Number) counts.get("organizer")).longValue() >= 40
          || ((Number) counts.get("mailbox")).longValue() >= 5
          || ((Number) counts.get("recent")).longValue() > 0) {
        failed(recipient.id(), "EMAIL_RATE_LIMIT");
        continue;
      }
      long active =
          database.queryForObject(
              """
              SELECT COUNT(*) FROM competition_invitations
              WHERE competition_id = ? AND revoked_at IS NULL AND expires_at > clock_timestamp()
              """,
              Long.class,
              id);
      if (active >= 20) {
        failed(recipient.id(), "INVITATION_LIMIT");
        continue;
      }
      var invitation = competitions.invite(id, user);
      database.update(
          "INSERT INTO competition_invitation_email_attempts (id, email_id) VALUES (?, ?)",
          UUID.randomUUID(),
          recipient.id());
      var message = new SimpleMailMessage();
      message.setFrom(auth.mailFrom());
      message.setTo(recipient.email());
      message.setSubject("You're invited to a Glizzy Gauntlet competition");
      message.setText(
          """
          You've been invited to join this competition:
          %s

          Open the invitation to review the competition, sign in, and explicitly accept:
          %s

          This link expires at %s or when the organizer revokes it.
          Opening this email does not join the competition. Anyone holding the link can join.
          If you weren't expecting this invitation, you can ignore it.
          """
              .formatted(competition.name(), invitation.inviteUrl(), invitation.expiresAt()));
      try {
        mail.send(message);
        database.update(
            "UPDATE competition_invitation_emails SET status = 'SENT', last_error = NULL, sent_at = clock_timestamp() WHERE id = ?",
            recipient.id());
      } catch (MailException failure) {
        competitions.revoke(id, user, invitation.id());
        failed(recipient.id(), "DELIVERY_FAILED");
        LOG.warn("Competition invitation delivery failed; check SMTP configuration");
      }
    }
    return rows(id);
  }

  private CompetitionService.Competition requireOrganizer(UUID id, UUID user) {
    var competition = competitions.get(id, user);
    if (!competition.canAdminister())
      throw new CompetitionException(HttpStatus.FORBIDDEN, "ORGANIZER_ONLY");
    return competition;
  }

  private CompetitionService.Competition requireSendable(UUID id, UUID user) {
    var competition = requireOrganizer(id, user);
    if (!competition.published())
      throw new CompetitionException(HttpStatus.CONFLICT, "PUBLISH_FIRST");
    if (!List.of(CompetitionService.Phase.SCHEDULED, CompetitionService.Phase.ACTIVE)
        .contains(competition.phase()))
      throw new CompetitionException(HttpStatus.CONFLICT, "JOINING_CLOSED");
    return competition;
  }

  private List<InvitationEmail> rows(UUID id) {
    return database.query(
        "SELECT * FROM competition_invitation_emails WHERE competition_id = ? ORDER BY email",
        (rs, index) -> {
          var sent = rs.getObject("sent_at", OffsetDateTime.class);
          return new InvitationEmail(
              rs.getObject("id", UUID.class),
              rs.getString("email"),
              rs.getString("status"),
              rs.getString("last_error"),
              sent == null ? null : sent.toInstant());
        },
        id);
  }

  private void failed(UUID id, String error) {
    database.update(
        "UPDATE competition_invitation_emails SET status = 'FAILED', last_error = ? WHERE id = ?",
        error,
        id);
  }

  private CompetitionException invalid() {
    return new CompetitionException(HttpStatus.BAD_REQUEST, "INVALID_INVITATION_EMAILS");
  }
}
