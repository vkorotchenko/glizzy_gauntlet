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
import com.glizzygauntlet.api.meals.MealService;
import com.glizzygauntlet.api.progress.ProgressService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
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
  @Autowired MealService meals;
  @Autowired ProgressService progress;
  @Autowired DataSource dataSource;
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
  void persistsEachTrackingModeAndDefaultsOlderRequestsToBoth() throws Exception {
    var settings = settings(Visibility.PUBLIC);
    String legacy = json.writeValueAsString(settings).replace(",\"trackingMode\":\"BOTH\"", "");
    mvc.perform(
            post("/api/v1/competitions")
                .with(as(owner))
                .with(csrf())
                .contentType("application/json")
                .content(legacy))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.trackingMode").value("BOTH"));
    for (var mode : TrackingMode.values()) {
      var configured =
          new Settings(
              settings.name(),
              settings.rules(),
              settings.visibility(),
              settings.timeZone(),
              settings.startsAt(),
              settings.endsAt(),
              settings.allowSharedMeals(),
              mode);
      var draft = competitions.create(owner, configured);
      assertThat(competitions.get(draft.id(), owner).trackingMode()).isEqualTo(mode);
      var changed = competitions.update(draft.id(), owner, draft.version(), settings);
      assertThat(changed.trackingMode()).isEqualTo(TrackingMode.BOTH);
    }
    mvc.perform(
            post("/api/v1/competitions")
                .with(as(owner))
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(settings).replace("\"BOTH\"", "\"UNKNOWN\"")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void keepsDraftsAndPrivateCompetitionsOutOfDiscoveryAndOutsiderReads() throws Exception {
    var draft = competitions.create(owner, settings(Visibility.PUBLIC));
    var privateCompetition = published(Visibility.PRIVATE);
    rejected(HttpStatus.NOT_FOUND, "NOT_FOUND", () -> competitions.get(draft.id(), outsider));
    rejected(
        HttpStatus.NOT_FOUND, "NOT_FOUND", () -> competitions.get(privateCompetition.id(), null));
    assertThat(competitions.list(null, "public", 0).items())
        .allMatch(Competition::allTime)
        .hasSize(1);
    assertThat(competitions.list(owner, "mine", 0).items()).hasSize(3);
    assertThat(competitions.list(participant, "mine", 0).items())
        .allMatch(Competition::allTime)
        .hasSize(1);
    assertThat(competitions.list(owner, "administered", 0).items())
        .extracting(Competition::id)
        .containsExactlyInAnyOrder(draft.id(), privateCompetition.id());
    assertThat(competitions.list(participant, "administered", 0).items()).isEmpty();
    assertThat(competitions.list(owner, "participating", 0).items())
        .allMatch(Competition::allTime)
        .hasSize(1);
    var invitation = competitions.invite(privateCompetition.id(), owner);
    competitions.joinInvitation(participant, token(invitation));
    assertThat(competitions.list(participant, "participating", 0).items())
        .extracting(Competition::id)
        .containsExactlyInAnyOrder(CompetitionService.ALL_TIME_ID, privateCompetition.id());
    assertThat(competitions.list(outsider, "participating", 0).items())
        .allMatch(Competition::allTime)
        .hasSize(1);
    mvc.perform(get("/api/v1/competitions/" + privateCompetition.id()).with(as(outsider)))
        .andExpect(status().isNotFound())
        .andExpect(content().json("{\"error\":\"NOT_FOUND\"}"));
    mvc.perform(get("/api/v1/competitions?scope=mine")).andExpect(status().isUnauthorized());
    for (String scope : List.of("administered", "participating")) {
      mvc.perform(get("/api/v1/competitions").param("scope", scope))
          .andExpect(status().isUnauthorized());
    }
    mvc.perform(get("/api/v1/competitions").param("scope", "administered").with(as(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(2));
    mvc.perform(get("/api/v1/competitions/" + draft.id())).andExpect(status().isNotFound());
  }

  @Test
  void paginatesAdministeredCompetitionsIndependentlyFromOtherMemberships() {
    for (int i = 0; i < 21; i++) competitions.create(owner, settings(Visibility.PRIVATE));
    var first = competitions.list(owner, "administered", 0);
    var second = competitions.list(owner, "administered", 1);
    assertThat(first.items()).hasSize(20);
    assertThat(first.hasMore()).isTrue();
    assertThat(second.items()).hasSize(1);
    assertThat(second.hasMore()).isFalse();
    assertThat(first.items())
        .extracting(Competition::id)
        .doesNotContain(second.items().get(0).id());
    assertThat(competitions.list(owner, "participating", 0).items())
        .extracting(Competition::id)
        .containsExactly(CompetitionService.ALL_TIME_ID);
    assertThat(competitions.list(owner, "participating", 0).hasMore()).isFalse();
    assertThat(competitions.list(owner, "mine", 0).items().get(0).allTime()).isTrue();
  }

  @Test
  void permitsGlobalAllTimeAdministrationWithoutChangingLifetimeSettings() throws Exception {
    UUID id = CompetitionService.ALL_TIME_ID;
    database.update(
        "UPDATE competitions SET organizer_id = ?, version = version + 1 WHERE id = ?", owner, id);
    assertThat(competitions.get(id, owner).canAdminister()).isFalse();
    database.update("INSERT INTO account_roles (user_id, role) VALUES (?, 'ADMIN')", owner);
    var lifetime = competitions.get(id, owner);
    assertThat(lifetime.viewerRole()).isEqualTo(Role.ORGANIZER);
    assertThat(lifetime.phase()).isEqualTo(Phase.ACTIVE);
    assertThat(lifetime.visibility()).isEqualTo(Visibility.PUBLIC);
    assertThat(lifetime.trackingMode()).isEqualTo(TrackingMode.COUNT);
    assertThat(lifetime.endsAt()).isNull();
    assertThat(lifetime.submissionClosesAt()).isNull();
    assertThat(accounts.profile(owner).roles())
        .containsExactly(com.glizzygauntlet.api.auth.GlobalRoleService.Role.ADMIN);
    assertThat(competitions.list(owner, "administered", 0).items())
        .extracting(Competition::id)
        .containsExactly(id);
    assertThat(competitions.list(owner, "participating", 0).items()).isEmpty();
    assertThat(competitions.list(owner, "mine", 0).items())
        .extracting(Competition::id)
        .containsExactly(id);
    rejected(
        HttpStatus.CONFLICT,
        "SETTINGS_LOCKED",
        () -> competitions.update(id, owner, lifetime.version(), settings(Visibility.PRIVATE)));
    rejected(HttpStatus.FORBIDDEN, "ORGANIZER_ONLY", () -> competitions.invite(id, participant));
    rejected(
        HttpStatus.CONFLICT,
        "CANNOT_EXCLUDE_ORGANIZER",
        () -> competitions.exclude(id, owner, owner, "Cannot exclude the organizer."));
    competitions.exclude(id, owner, participant, "Test moderation reason.");
    assertThat(competitions.get(id, participant).viewerRole()).isEqualTo(Role.NONE);
    accounts.findOrCreate("email", "participant@example.test", "participant@example.test");
    rejected(HttpStatus.FORBIDDEN, "MEMBERSHIP_EXCLUDED", () -> competitions.join(id, participant));

    var invitation = competitions.invite(id, owner);
    assertThat(invitation.expiresAt())
        .isBetween(Instant.now().plus(Duration.ofDays(6)), Instant.now().plus(Duration.ofDays(7)));
    var preview = competitions.inspect(token(invitation));
    assertThat(preview.endsAt()).isNull();
    mvc.perform(
            post("/api/v1/competition-invitations/inspect")
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(java.util.Map.of("token", token(invitation)))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.endsAt").value(org.hamcrest.Matchers.nullValue()));
    assertThat(competitions.invitations(id, owner))
        .singleElement()
        .satisfies(
            listed -> {
              assertThat(listed.active()).isTrue();
              assertThat(listed.expiresAt()).isEqualTo(invitation.expiresAt());
            });
    competitions.leave(id, outsider);
    assertThat(competitions.joinInvitation(outsider, token(invitation)).viewerRole())
        .isEqualTo(Role.MEMBER);
    competitions.revoke(id, owner, invitation.id());
    assertThat(competitions.invitations(id, owner).get(0).active()).isFalse();

    competitions.leave(id, owner);
    accounts.findOrCreate("email", "owner@example.test", "owner@example.test");
    assertThat(competitions.get(id, owner).viewerRole()).isEqualTo(Role.NONE);
    assertThat(competitions.list(owner, "administered", 0).items())
        .extracting(Competition::id)
        .containsExactly(id);
    assertThat(competitions.list(owner, "joined", 0).items()).isEmpty();
    assertThat(competitions.get(id, owner).canAdminister()).isTrue();
    assertThat(competitions.invite(id, owner).id()).isNotNull();
    assertThat(competitions.join(id, owner).viewerRole()).isEqualTo(Role.ORGANIZER);
  }

  @Test
  void enrollsAccountsInAnEndlessCompetitionAndRespectsExplicitOptOut() throws Exception {
    UUID id = CompetitionService.ALL_TIME_ID;
    var lifetime = competitions.get(id, owner);
    assertThat(lifetime.allTime()).isTrue();
    assertThat(lifetime.phase()).isEqualTo(Phase.ACTIVE);
    assertThat(lifetime.endsAt()).isNull();
    assertThat(lifetime.submissionClosesAt()).isNull();
    assertThat(lifetime.viewerRole()).isEqualTo(Role.MEMBER);
    assertThat(lifetime.memberCount()).isEqualTo(3);
    var ordinary = published(Visibility.PUBLIC);
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '1 hour' WHERE id = ?",
        ordinary.id());
    var content = new MealService.Content(null, null, null, "", List.of(), List.of(), 600L, 2);
    var saved =
        meals.save(
            null,
            owner,
            new MealService.Save(UUID.randomUUID(), 0L, content, List.of(id, ordinary.id())));
    assertThat(progress.personal(id, owner, 0, 0).wholeHotDogs()).isEqualTo(2);
    assertThat(progress.personal(id, owner, 0, 0).days()).hasSize(30);
    mvc.perform(post("/api/v1/competitions/" + id + "/leave").with(as(owner)))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/competitions/" + id + "/leave").with(csrf()))
        .andExpect(status().isUnauthorized());
    mvc.perform(post("/api/v1/competitions/" + id + "/leave").with(as(owner)).with(csrf()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.viewerRole").value("NONE"));
    assertThat(meals.get(saved.id(), owner).submissions())
        .anySatisfy(
            entry -> {
              assertThat(entry.competitionId()).isEqualTo(id);
              assertThat(entry.withdrawn()).isTrue();
            })
        .anySatisfy(
            entry -> {
              assertThat(entry.competitionId()).isEqualTo(ordinary.id());
              assertThat(entry.withdrawn()).isFalse();
            });
    assertThat(meals.get(saved.id(), owner).revision().id()).isEqualTo(saved.revision().id());
    accounts.findOrCreate("email", "owner@example.test", "owner@example.test");
    assertThat(competitions.get(id, owner).viewerRole()).isEqualTo(Role.NONE);
    assertThat(competitions.list(owner, "joined", 0).items()).noneMatch(Competition::allTime);
    competitions.join(id, owner);
    competitions.join(id, owner);
    assertThat(competitions.get(id, owner).memberCount()).isEqualTo(3);
    assertThat(progress.personal(id, owner, 0, 0).wholeHotDogs()).isZero();
    rejected(
        HttpStatus.FORBIDDEN,
        "ORGANIZER_ONLY",
        () -> competitions.update(id, owner, 0, settings(Visibility.PUBLIC)));
  }

  @Test
  void migratesExistingAccountsIntoTheAllTimeCompetition() {
    String schema = "all_time_backfill_check";
    try {
      Flyway.configure()
          .dataSource(dataSource)
          .schemas(schema)
          .defaultSchema(schema)
          .target("9")
          .load()
          .migrate();
      UUID existing = UUID.randomUUID();
      database.update(
          "INSERT INTO " + schema + ".app_users (id, display_name) VALUES (?, 'Existing diner')",
          existing);
      Flyway.configure()
          .dataSource(dataSource)
          .schemas(schema)
          .defaultSchema(schema)
          .load()
          .migrate();
      assertThat(
              database.queryForObject(
                  "SELECT count(*) FROM " + schema + ".competition_memberships WHERE user_id = ?",
                  Long.class,
                  existing))
          .isEqualTo(1);
      assertThat(
              database.queryForObject(
                  "SELECT all_time FROM " + schema + ".competitions", Boolean.class))
          .isTrue();
    } finally {
      database.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    }
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
