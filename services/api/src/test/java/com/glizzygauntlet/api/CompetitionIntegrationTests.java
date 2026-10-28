package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.SessionAuthentication.AccountPrincipal;
import com.glizzygauntlet.api.competitions.CompetitionException;
import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.competitions.CompetitionService.*;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class CompetitionIntegrationTests {
  @Autowired CompetitionService competitions;
  @Autowired AccountService accounts;
  @Autowired JdbcTemplate database;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired PlatformTransactionManager transactions;
  UUID owner;
  UUID participant;
  UUID outsider;

  @BeforeEach
  void resetData() {
    database.execute("TRUNCATE app_users, spring_session, magic_link_tokens CASCADE");
    owner = accounts.findOrCreate("email", "owner@example.test", "owner@example.test").id();
    participant =
        accounts.findOrCreate("email", "participant@example.test", "participant@example.test").id();
    outsider =
        accounts.findOrCreate("email", "outsider@example.test", "outsider@example.test").id();
  }

  @Test
  void keepsDraftsAndPrivateCompetitionsOutOfDiscoveryAndOutsiderReads() throws Exception {
    var draft = competitions.create(owner, settings(Visibility.PUBLIC));
    var privateCompetition = published(Visibility.PRIVATE);
    rejected(HttpStatus.NOT_FOUND, "NOT_FOUND", () -> competitions.get(draft.id(), outsider));
    rejected(
        HttpStatus.NOT_FOUND, "NOT_FOUND", () -> competitions.get(privateCompetition.id(), null));
    assertThat(competitions.list(null, "public", 0).items()).isEmpty();
    assertThat(competitions.list(owner, "mine", 0).items()).hasSize(2);
    assertThat(competitions.list(participant, "mine", 0).items()).isEmpty();
    mvc.perform(get("/api/v1/competitions/" + privateCompetition.id()).with(as(outsider)))
        .andExpect(status().isNotFound())
        .andExpect(content().json("{\"error\":\"NOT_FOUND\"}"));
    mvc.perform(get("/api/v1/competitions?scope=mine")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/competitions/" + draft.id())).andExpect(status().isNotFound());
  }

  @Test
  void createsOnlyAuthenticatedCsrfProtectedDraftsAndRejectsClientAssignedRoles() throws Exception {
    String body = json.writeValueAsString(settings(Visibility.PUBLIC));
    mvc.perform(
            post("/api/v1/competitions").with(csrf()).contentType("application/json").content(body))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/v1/competitions")
                .with(as(owner))
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/competitions")
                .with(as(owner))
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.phase").value("DRAFT"))
        .andExpect(jsonPath("$.viewerRole").value("ORGANIZER"))
        .andExpect(jsonPath("$.memberCount").value(1));
    String forged = body.substring(0, body.length() - 1) + ",\"organizerId\":\"" + outsider + "\"}";
    mvc.perform(
            post("/api/v1/competitions")
                .with(as(owner))
                .with(csrf())
                .contentType("application/json")
                .content(forged))
        .andExpect(status().isBadRequest());
  }

  @Test
  void publishesOnlyAsOrganizerUsesVersionsAndFreezesSettingsAtEatingStart() {
    var draft = competitions.create(owner, settings(Visibility.PUBLIC));
    var changed =
        competitions.update(draft.id(), owner, draft.version(), settings(Visibility.PRIVATE));
    rejected(
        HttpStatus.CONFLICT,
        "VERSION_CONFLICT",
        () -> competitions.publish(draft.id(), owner, draft.version()));
    var live = competitions.publish(draft.id(), owner, changed.version());
    var invite = competitions.invite(live.id(), owner);
    competitions.joinInvitation(participant, token(invite));
    rejected(
        HttpStatus.FORBIDDEN,
        "ORGANIZER_ONLY",
        () ->
            competitions.update(
                live.id(), participant, live.version(), settings(Visibility.PUBLIC)));
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '1 minute' WHERE id = ?",
        live.id());
    rejected(
        HttpStatus.CONFLICT,
        "SETTINGS_LOCKED",
        () -> competitions.update(live.id(), owner, live.version(), settings(Visibility.PUBLIC)));
    assertThat(competitions.get(live.id(), owner).visibility()).isEqualTo(Visibility.PRIVATE);
  }

  @Test
  void permitsLateJoiningButNotGracePeriodJoiningAndKeepsMembershipUnique() {
    var competition = published(Visibility.PUBLIC);
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '1 hour' WHERE id = ?",
        competition.id());
    var first =
        CompletableFuture.supplyAsync(() -> competitions.join(competition.id(), participant));
    var second =
        CompletableFuture.supplyAsync(() -> competitions.join(competition.id(), participant));
    assertThat(List.of(first.join().viewerRole(), second.join().viewerRole()))
        .containsOnly(Role.MEMBER);
    assertThat(competitions.members(competition.id(), participant, 0).items()).hasSize(2);
    database.update(
        "UPDATE competitions SET ends_at = clock_timestamp() WHERE id = ?", competition.id());
    assertThat(competitions.get(competition.id(), owner).phase()).isEqualTo(Phase.GRACE);
    rejected(
        HttpStatus.CONFLICT, "JOINING_CLOSED", () -> competitions.join(competition.id(), outsider));
    assertThat(competitions.get(competition.id(), participant).viewerRole()).isEqualTo(Role.MEMBER);
    database.update(
        """
        UPDATE competitions SET starts_at = clock_timestamp() - interval '26 hours',
        ends_at = clock_timestamp() - interval '25 hours' WHERE id = ?
        """,
        competition.id());
    assertThat(competitions.get(competition.id(), owner).phase()).isEqualTo(Phase.CLOSED);
  }

  @Test
  void showsOnlyPublicMetadataToNonmembersAndNeverEmailsOrOtherMemberships() throws Exception {
    var competition = published(Visibility.PUBLIC);
    mvc.perform(get("/api/v1/competitions/" + competition.id()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.viewerRole").value("NONE"))
        .andExpect(jsonPath("$.organizerId").doesNotExist())
        .andExpect(
            content()
                .string(
                    org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("@example.test"))));
    mvc.perform(get("/api/v1/competitions/" + competition.id() + "/members"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/competitions/" + competition.id() + "/members").with(as(outsider)))
        .andExpect(status().isForbidden());
    competitions.join(competition.id(), participant);
    mvc.perform(get("/api/v1/competitions/" + competition.id() + "/members").with(as(participant)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(2))
        .andExpect(jsonPath("$.items[0].email").doesNotExist());
    mvc.perform(
            get("/api/v1/competitions/" + competition.id() + "/invitations").with(as(participant)))
        .andExpect(status().isForbidden());
  }

  @Test
  void storesOnlyInvitationHashesRequiresExplicitJoinAndMakesRevocationEffective()
      throws Exception {
    var competition = published(Visibility.PRIVATE);
    var invite = competitions.invite(competition.id(), owner);
    String token = token(invite);
    assertThat(
            database.queryForObject(
                "SELECT token_hash FROM competition_invitations WHERE id = ?",
                String.class,
                invite.id()))
        .hasSize(64)
        .doesNotContain(token);
    assertThat(invite.expiresAt()).isBeforeOrEqualTo(competition.endsAt());
    assertThat(competitions.inspect(token).competitionId()).isEqualTo(competition.id());
    rejected(
        HttpStatus.NOT_FOUND, "NOT_FOUND", () -> competitions.get(competition.id(), participant));
    competitions.joinInvitation(participant, token);
    assertThat(competitions.get(competition.id(), participant).viewerRole()).isEqualTo(Role.MEMBER);
    String listing =
        mvc.perform(
                get("/api/v1/competitions/" + competition.id() + "/invitations").with(as(owner)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(listing).doesNotContain(token).doesNotContain("token_hash");
    competitions.revoke(competition.id(), owner, invite.id());
    rejected(
        HttpStatus.BAD_REQUEST,
        "INVALID_INVITATION",
        () -> competitions.joinInvitation(outsider, token));
    assertThat(competitions.get(competition.id(), participant).viewerRole()).isEqualTo(Role.MEMBER);
  }

  @Test
  void rejectsExpiredInvitationsAndBoundsActiveInvitationCreation() {
    var competition = published(Visibility.PRIVATE);
    var expired = competitions.invite(competition.id(), owner);
    database.update(
        "UPDATE competition_invitations SET expires_at = clock_timestamp() WHERE id = ?",
        expired.id());
    rejected(
        HttpStatus.BAD_REQUEST, "INVALID_INVITATION", () -> competitions.inspect(token(expired)));
    assertThat(competitions.invitations(competition.id(), owner).getFirst().active()).isFalse();
    for (int i = 0; i < 20; i++) competitions.invite(competition.id(), owner);
    rejected(
        HttpStatus.CONFLICT,
        "INVITATION_LIMIT",
        () -> competitions.invite(competition.id(), owner));
  }

  @Test
  void auditsExclusionAndPreventsPrivateReadsOrRejoiningThroughAnInvitation() {
    var competition = published(Visibility.PRIVATE);
    var invite = competitions.invite(competition.id(), owner);
    competitions.joinInvitation(participant, token(invite));
    rejected(
        HttpStatus.FORBIDDEN,
        "ORGANIZER_ONLY",
        () -> competitions.exclude(competition.id(), participant, owner, "No"));
    competitions.exclude(competition.id(), owner, participant, "Organizer decision");
    rejected(
        HttpStatus.NOT_FOUND, "NOT_FOUND", () -> competitions.get(competition.id(), participant));
    rejected(
        HttpStatus.FORBIDDEN,
        "MEMBERSHIP_EXCLUDED",
        () -> competitions.joinInvitation(participant, token(invite)));
    assertThat(
            database.queryForObject(
                "SELECT reason FROM competition_events WHERE action = 'MEMBER_EXCLUDED'",
                String.class))
        .isEqualTo("Organizer decision");
    rejected(
        HttpStatus.CONFLICT,
        "CANNOT_EXCLUDE_ORGANIZER",
        () -> competitions.exclude(competition.id(), owner, owner, "No"));
  }

  @Test
  void rejectsInvalidZonesAndWindowsAndUsesTwentyFourElapsedHoursAcrossDst() {
    var valid = settings(Visibility.PUBLIC);
    rejected(
        HttpStatus.BAD_REQUEST,
        "INVALID_WINDOW",
        () ->
            competitions.create(
                owner,
                new Settings(
                    valid.name(),
                    valid.rules(),
                    valid.visibility(),
                    valid.timeZone(),
                    valid.startsAt().plusNanos(1000),
                    valid.endsAt(),
                    false)));
    rejected(
        HttpStatus.BAD_REQUEST,
        "INVALID_TIME_ZONE",
        () ->
            competitions.create(
                owner,
                new Settings(
                    valid.name(),
                    valid.rules(),
                    valid.visibility(),
                    "+04:00",
                    valid.startsAt(),
                    valid.endsAt(),
                    false)));
    rejected(
        HttpStatus.BAD_REQUEST,
        "INVALID_WINDOW",
        () ->
            competitions.create(
                owner,
                new Settings(
                    valid.name(),
                    valid.rules(),
                    valid.visibility(),
                    "UTC",
                    valid.endsAt(),
                    valid.startsAt(),
                    false)));
    var competition = published(Visibility.PUBLIC);
    database.update(
        """
        UPDATE competitions SET starts_at = '2026-11-01T04:30:00Z', ends_at = '2026-11-01T05:30:00Z',
        time_zone = 'America/New_York' WHERE id = ?
        """,
        competition.id());
    var result = competitions.get(competition.id(), owner);
    assertThat(result.submissionClosesAt()).isEqualTo(Instant.parse("2026-11-02T05:30:00Z"));
    assertThat(Duration.between(result.endsAt(), result.submissionClosesAt()))
        .isEqualTo(Duration.ofHours(24));
  }

  @Test
  void rechecksTheDatabaseClockAfterWaitingForTheCompetitionLock() throws Exception {
    var competition = published(Visibility.PUBLIC);
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '1 hour' WHERE id = ?",
        competition.id());
    CountDownLatch locked = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    var holder =
        CompletableFuture.runAsync(
            () ->
                new TransactionTemplate(transactions)
                    .executeWithoutResult(
                        status -> {
                          database.queryForList(
                              "SELECT id FROM competitions WHERE id = ? FOR UPDATE",
                              competition.id());
                          locked.countDown();
                          try {
                            if (!release.await(10, TimeUnit.SECONDS))
                              throw new IllegalStateException("Test lock timed out");
                          } catch (InterruptedException interrupted) {
                            Thread.currentThread().interrupt();
                            throw new IllegalStateException(interrupted);
                          }
                          database.update(
                              "UPDATE competitions SET ends_at = clock_timestamp() WHERE id = ?",
                              competition.id());
                        }));
    try {
      assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
      var join =
          CompletableFuture.supplyAsync(
              () -> {
                try {
                  competitions.join(competition.id(), participant);
                  return "JOINED";
                } catch (CompetitionException rejected) {
                  return rejected.getMessage();
                }
              });
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      boolean waiting = false;
      while (System.nanoTime() < deadline && !waiting) {
        waiting =
            database.queryForObject(
                    """
            SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%competitions%'
            """,
                    Long.class)
                > 0;
        if (!waiting) Thread.sleep(10);
      }
      assertThat(waiting).as("The join must actually wait on the row lock").isTrue();
      release.countDown();
      holder.get(5, TimeUnit.SECONDS);
      assertThat(join.get(5, TimeUnit.SECONDS)).isEqualTo("JOINING_CLOSED");
    } finally {
      release.countDown();
      holder.get(5, TimeUnit.SECONDS);
    }
  }

  private Competition published(Visibility visibility) {
    var draft = competitions.create(owner, settings(visibility));
    return competitions.publish(draft.id(), owner, draft.version());
  }

  private Settings settings(Visibility visibility) {
    Instant start =
        Instant.now().plus(Duration.ofHours(1)).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    return new Settings(
        "The neighborhood crew",
        "Actual measurements; eat at your own pace.",
        visibility,
        "America/New_York",
        start,
        start.plus(Duration.ofDays(2)),
        true);
  }

  private String token(CreatedInvitation invitation) {
    return invitation.inviteUrl().substring(invitation.inviteUrl().indexOf("token=") + 6);
  }

  private RequestPostProcessor as(UUID id) {
    return authentication(
        UsernamePasswordAuthenticationToken.authenticated(
            new AccountPrincipal(id), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
  }

  private void rejected(HttpStatus status, String code, Runnable action) {
    assertThatThrownBy(action::run)
        .isInstanceOfSatisfying(
            CompetitionException.class,
            rejected -> {
              assertThat(rejected.status()).isEqualTo(status);
              assertThat(rejected.getMessage()).isEqualTo(code);
            });
  }
}
