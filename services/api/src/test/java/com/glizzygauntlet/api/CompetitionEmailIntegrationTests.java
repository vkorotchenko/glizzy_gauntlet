package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.AuthProperties;
import com.glizzygauntlet.api.auth.SessionAuthentication.AccountPrincipal;
import com.glizzygauntlet.api.competitions.CompetitionController.Creation;
import com.glizzygauntlet.api.competitions.CompetitionEmailService;
import com.glizzygauntlet.api.competitions.CompetitionService;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(
    properties = {"app.auth.email-enabled=true", "app.auth.mail-from=no-reply@glizzy.test"})
@AutoConfigureMockMvc
class CompetitionEmailIntegrationTests {
  @Autowired CompetitionEmailService emails;
  @Autowired CompetitionService competitions;
  @Autowired AccountService accounts;
  @Autowired AuthProperties auth;
  @Autowired JdbcTemplate database;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @MockitoBean JavaMailSender mail;
  UUID owner;
  UUID member;

  @BeforeEach
  void resetData() {
    database.execute("TRUNCATE app_users, spring_session, magic_link_tokens CASCADE");
    reset(mail);
    owner = accounts.findOrCreate("email", "owner@example.test", "owner@example.test").id();
    member = accounts.findOrCreate("email", "member@example.test", "member@example.test").id();
  }

  @Test
  void queuesPrivatelyAndEmailsSeparateRevocableLinksOnlyWhenPublished() throws Exception {
    var creation =
        creation(List.of("First@example.test", "second@example.test", "first@example.test"));
    var response =
        mvc.perform(
                post("/api/v1/competitions")
                    .with(as(owner))
                    .with(csrf())
                    .contentType("application/json")
                    .content(json.writeValueAsString(creation)))
            .andExpect(status().isCreated())
            .andReturn();
    var draft =
        json.readValue(
            response.getResponse().getContentAsString(), CompetitionService.Competition.class);
    assertThat(emails.list(draft.id(), owner))
        .hasSize(2)
        .allSatisfy(row -> assertThat(row.status()).isEqualTo("PENDING"));
    verifyNoInteractions(mail);
    mvc.perform(
            post("/api/v1/competitions/" + draft.id() + "/invitation-emails")
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error").value("PUBLISH_FIRST"));
    mvc.perform(
            post("/api/v1/competitions/" + draft.id() + "/publish")
                .with(as(owner))
                .with(csrf())
                .contentType("application/json")
                .content("{\"version\":" + draft.version() + "}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.published").value(true));
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () ->
                assertThat(emails.list(draft.id(), owner))
                    .allSatisfy(row -> assertThat(row.status()).isEqualTo("SENT")));
    var messages = ArgumentCaptor.forClass(SimpleMailMessage.class);
    verify(mail, times(2)).send(messages.capture());
    for (var message : messages.getAllValues()) {
      assertThat(message.getTo()).hasSize(1);
      assertThat(message.getCc()).isNull();
      assertThat(message.getBcc()).isNull();
      assertThat(message.getText()).doesNotContain("first@example.test", "second@example.test");
      String token = message.getText().split("/join\\?token=")[1].split("\\s")[0];
      assertThat(competitions.inspect(token).competitionId()).isEqualTo(draft.id());
    }
    String token =
        messages.getAllValues().getFirst().getText().split("/join\\?token=")[1].split("\\s")[0];
    assertThat(competitions.get(draft.id(), owner).memberCount()).isEqualTo(1);
    competitions.joinInvitation(member, token);
    assertThat(competitions.get(draft.id(), owner).memberCount()).isEqualTo(2);
    assertThat(database.queryForObject("SELECT count(*) FROM app_users", Long.class)).isEqualTo(2);
    mvc.perform(get("/api/v1/competitions/" + draft.id() + "/invitation-emails").with(as(owner)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$[0].status").value("SENT"));
    mvc.perform(get("/api/v1/competitions/" + draft.id() + "/invitation-emails").with(as(member)))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/competitions/" + draft.id() + "/invitation-emails")
                .with(as(member))
                .with(csrf()))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/v1/competitions/" + draft.id() + "/invitation-emails"))
        .andExpect(status().isUnauthorized());
    mvc.perform(post("/api/v1/competitions/" + draft.id() + "/invitation-emails").with(as(owner)))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/v1/competitions/" + draft.id()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.invitationEmails").doesNotExist());
    emails.send(draft.id(), owner);
    verify(mail, times(2)).send(any(SimpleMailMessage.class));
  }

  @Test
  void recordsSmtpFailureWithoutUndoingPublicationAndRetriesOnlyUnsentRecipients()
      throws Exception {
    var draft =
        emails.create(
            owner, creation(List.of()).settings(), List.of("a@example.test", "b@example.test"));
    doThrow(new MailSendException("Synthetic failure"))
        .doNothing()
        .when(mail)
        .send(any(SimpleMailMessage.class));
    mvc.perform(
            post("/api/v1/competitions/" + draft.id() + "/publish")
                .with(as(owner))
                .with(csrf())
                .contentType("application/json")
                .content("{\"version\":" + draft.version() + "}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.published").value(true));
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () ->
                assertThat(emails.list(draft.id(), owner))
                    .noneSatisfy(row -> assertThat(row.status()).isEqualTo("PENDING")));
    assertThat(emails.list(draft.id(), owner))
        .extracting(CompetitionEmailService.InvitationEmail::status)
        .containsExactly("FAILED", "SENT");
    assertThat(emails.list(draft.id(), owner).getFirst().lastError()).isEqualTo("DELIVERY_FAILED");
    assertThat(competitions.invitations(draft.id(), owner))
        .filteredOn(invite -> invite.revokedAt() != null)
        .hasSize(1);
    emails.send(draft.id(), owner);
    verify(mail, times(2)).send(any(SimpleMailMessage.class));
    database.update(
        "UPDATE competition_invitation_email_attempts SET attempted_at = clock_timestamp() - interval '2 minutes' WHERE email_id IN (SELECT id FROM competition_invitation_emails WHERE status = 'FAILED')");
    emails.send(draft.id(), owner);
    assertThat(emails.list(draft.id(), owner))
        .allSatisfy(row -> assertThat(row.status()).isEqualTo("SENT"));
    verify(mail, times(3)).send(any(SimpleMailMessage.class));
  }

  @Test
  void serializesConcurrentRetriesAndHonorsTheExistingActiveLinkLimit() {
    var draft =
        emails.create(owner, creation(List.of()).settings(), List.of("recipient@example.test"));
    competitions.publish(draft.id(), owner, draft.version());
    var a = CompletableFuture.runAsync(() -> emails.send(draft.id(), owner));
    var b = CompletableFuture.runAsync(() -> emails.send(draft.id(), owner));
    a.join();
    b.join();
    verify(mail, times(1)).send(any(SimpleMailMessage.class));
    var full =
        emails.create(owner, creation(List.of()).settings(), List.of("another@example.test"));
    competitions.publish(full.id(), owner, full.version());
    for (int i = 0; i < 20; i++) competitions.invite(full.id(), owner);
    assertThat(emails.send(full.id(), owner).getFirst().lastError()).isEqualTo("INVITATION_LIMIT");
    verify(mail, times(1)).send(any(SimpleMailMessage.class));
  }

  @Test
  void boundsTheOrganizerMailBudgetAndRejectsBadListsBeforeCreatingAnything() throws Exception {
    for (var addresses :
        List.of(List.of("not-an-email"), java.util.Collections.nCopies(21, "valid@example.test"))) {
      mvc.perform(
              post("/api/v1/competitions")
                  .with(as(owner))
                  .with(csrf())
                  .contentType("application/json")
                  .content(json.writeValueAsString(creation(addresses))))
          .andExpect(status().isBadRequest());
    }
    assertThat(competitions.list(owner, "mine", 0).items())
        .allMatch(CompetitionService.Competition::allTime)
        .hasSize(1);
    var draft =
        emails.create(
            owner,
            creation(List.of()).settings(),
            List.of("spent@example.test", "pending@example.test"));
    competitions.publish(draft.id(), owner, draft.version());
    database.update(
        "UPDATE competition_invitation_emails SET status = 'SENT' WHERE email = 'spent@example.test'");
    database.update(
        "INSERT INTO competition_invitation_email_attempts (id, email_id) SELECT gen_random_uuid(), e.id FROM competition_invitation_emails e CROSS JOIN generate_series(1, 40) WHERE e.email = 'spent@example.test'");
    assertThat(emails.send(draft.id(), owner))
        .filteredOn(row -> row.email().equals("pending@example.test"))
        .allSatisfy(row -> assertThat(row.lastError()).isEqualTo("EMAIL_RATE_LIMIT"));
    verifyNoInteractions(mail);
    var disabled =
        new CompetitionEmailService(
            database,
            competitions,
            new AuthProperties(auth.publicBaseUrl(), false, auth.mailFrom(), false, null, null),
            mail);
    assertThatThrownBy(
            () ->
                disabled.create(
                    owner, creation(List.of()).settings(), List.of("next@example.test")))
        .hasMessage("EMAIL_DISABLED");
    assertThat(competitions.list(owner, "mine", 0).items()).hasSize(2);
    database.update(
        "UPDATE competition_invitation_email_attempts SET attempted_at = clock_timestamp() - interval '2 hours'");
    emails.send(draft.id(), owner);
    verify(mail).send(any(SimpleMailMessage.class));
  }

  @Test
  void publicationAndRetryDoNotWaitForSlowSmtp() throws Exception {
    var draft = emails.create(owner, creation(List.of()).settings(), List.of("slow@example.test"));
    var started = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    doAnswer(
            invocation -> {
              started.countDown();
              release.await(5, TimeUnit.SECONDS);
              return null;
            })
        .when(mail)
        .send(any(SimpleMailMessage.class));
    try {
      assertTimeoutPreemptively(
          Duration.ofSeconds(2),
          () ->
              mvc.perform(
                      post("/api/v1/competitions/" + draft.id() + "/publish")
                          .with(as(owner))
                          .with(csrf())
                          .contentType("application/json")
                          .content("{\"version\":" + draft.version() + "}"))
                  .andExpect(status().isOk()));
      assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
      assertTimeoutPreemptively(
          Duration.ofSeconds(2),
          () ->
              mvc.perform(
                      post("/api/v1/competitions/" + draft.id() + "/invitation-emails")
                          .with(as(owner))
                          .with(csrf()))
                  .andExpect(status().isOk())
                  .andExpect(jsonPath("$[0].status").value("PENDING")));
    } finally {
      release.countDown();
    }
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> assertThat(emails.list(draft.id(), owner).getFirst().status()).isEqualTo("SENT"));
    verify(mail).send(any(SimpleMailMessage.class));
  }

  private Creation creation(List<String> recipients) {
    Instant start = Instant.now().plusSeconds(86400).truncatedTo(ChronoUnit.MILLIS);
    return new Creation(
        "Email crew",
        "",
        CompetitionService.Visibility.PUBLIC,
        "UTC",
        start,
        start.plusSeconds(86400),
        false,
        CompetitionService.TrackingMode.BOTH,
        recipients);
  }

  private RequestPostProcessor as(UUID user) {
    return authentication(
        new UsernamePasswordAuthenticationToken(
            new AccountPrincipal(user), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
  }
}
