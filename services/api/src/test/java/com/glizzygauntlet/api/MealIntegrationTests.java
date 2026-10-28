package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.SessionAuthentication.AccountPrincipal;
import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.meals.MealException;
import com.glizzygauntlet.api.meals.MealService;
import com.glizzygauntlet.api.meals.MealService.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class MealIntegrationTests {
  @TempDir static Path media;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("app.media.directory", () -> media.toString());
  }

  @Autowired MealService meals;
  @Autowired CompetitionService competitions;
  @Autowired AccountService accounts;
  @Autowired JdbcTemplate database;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired PlatformTransactionManager transactions;
  UUID author;
  UUID member;
  UUID stranger;

  @BeforeEach
  void reset() {
    database.execute("TRUNCATE app_users, spring_session, magic_link_tokens CASCADE");
    author =
        accounts.findOrCreate("email", "meal-author@example.test", "meal-author@example.test").id();
    member =
        accounts.findOrCreate("email", "meal-member@example.test", "meal-member@example.test").id();
    stranger =
        accounts
            .findOrCreate("email", "meal-stranger@example.test", "meal-stranger@example.test")
            .id();
  }

  @Test
  void calculatesActualLengthsPartialOnlyAndWholeCountsWithoutStandardSizing() {
    var meal =
        meals.save(
            null,
            author,
            save(
                0,
                content(
                    List.of(
                        new Item("Eight inch", 2, 800, 300),
                        new Item("Small portion", 0, 550, 25))),
                List.of()));
    assertThat(meal.revision().totalHundredths()).isEqualTo(1925);
    assertThat(meal.revision().wholeHotDogs()).isEqualTo(2);
    assertThat(meal.submissions()).isEmpty();
    assertThat(meals.list(member, false, 0).items()).isEmpty();
    rejected(
        "INVALID_MEASUREMENT",
        () ->
            meals.save(
                null, author, save(0, content(List.of(new Item("Empty", 0, 800, 0))), List.of())));
    rejected(
        "INVALID_MEASUREMENT",
        () ->
            meals.save(
                null,
                author,
                save(0, content(List.of(new Item("Whole partial", 0, 800, 800))), List.of())));
    rejected(
        "INVALID_MEASUREMENT",
        () ->
            meals.save(
                null,
                author,
                save(0, content(List.of(new Item("Unbounded", 101, 800, 0))), List.of())));
  }

  @Test
  void rejectsMissingLengthsFractionalHundredthsForgedOwnershipAndCsrf() throws Exception {
    String body = json.writeValueAsString(save(0, content(), List.of()));
    mvc.perform(post("/api/v1/meals").with(csrf()).contentType("application/json").content(body))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/v1/meals").with(as(author)).contentType("application/json").content(body))
        .andExpect(status().isForbidden());
    for (String invalid :
        List.of(
            body.replace("\"unitHundredths\":800", "\"unitHundredths\":800.5"),
            body.replace("\"unitHundredths\":800", "\"unitHundredths\":null"),
            body.substring(0, body.length() - 1) + ",\"ownerId\":\"" + member + "\"}")) {
      mvc.perform(
              post("/api/v1/meals")
                  .with(as(author))
                  .with(csrf())
                  .contentType("application/json")
                  .content(invalid))
          .andExpect(status().isBadRequest());
    }
    mvc.perform(
            post("/api/v1/meals")
                .with(as(author))
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.revision.totalHundredths").value(1900))
        .andExpect(jsonPath("$.revision.wholeHotDogs").value(2));
  }

  @Test
  void makesRepeatedCreatesAndUpdatesIdempotentWithoutDuplicateEntries() {
    var competition = active(true);
    var request = save(0, content(), List.of(competition.id()));
    var a = CompletableFuture.supplyAsync(() -> meals.save(null, author, request));
    var b = CompletableFuture.supplyAsync(() -> meals.save(null, author, request));
    var first = a.join();
    assertThat(b.join().id()).isEqualTo(first.id());
    assertThat(count("competition_entries")).isEqualTo(1);
    assertThat(count("meal_revisions")).isEqualTo(1);
    var update =
        save(
            first.version(),
            content(List.of(new Item("Longer", 3, 900, 0))),
            List.of(competition.id()));
    meals.save(first.id(), author, update);
    meals.save(first.id(), author, update);
    assertThat(count("meal_revisions")).isEqualTo(2);
    assertThat(count("competition_entries")).isEqualTo(1);
    assertThat(count("competition_entry_events")).isEqualTo(2);
    rejected(
        "REQUEST_CONFLICT",
        () ->
            meals.save(
                null,
                author,
                new Save(
                    request.requestId(),
                    0L,
                    content(List.of(new Item("Changed", 1, 900, 0))),
                    List.of())));
  }

  @Test
  void appliesAllSelectedTargetsAtomicallyAndChecksEveryAffectedSharingPolicy() {
    var exclusive = active(false);
    var shared = active(true);
    var original = meals.save(null, author, save(0, content(), List.of(exclusive.id())));
    rejected(
        "SHARING_NOT_ALLOWED",
        () ->
            meals.save(
                original.id(), author, save(original.version(), content(), List.of(shared.id()))));
    assertThat(count("meal_revisions")).isEqualTo(1);
    assertThat(count("competition_entries")).isEqualTo(1);
    var unjoined = competitions.create(member, settings(true));
    unjoined = competitions.publish(unjoined.id(), member, unjoined.version());
    UUID unavailable = unjoined.id();
    rejected(
        "TARGET_UNAVAILABLE",
        () -> meals.save(null, author, save(0, content(), List.of(shared.id(), unavailable))));
    assertThat(count("meals")).isEqualTo(1);
    var two = active(true);
    var meal = meals.save(null, author, save(0, content(), List.of(shared.id(), two.id())));
    assertThat(meal.submissions())
        .hasSize(2)
        .allSatisfy(submission -> assertThat(submission.totalHundredths()).isEqualTo(1900));
    assertThat(meals.list(author, false, 0).items()).hasSize(2);
  }

  @Test
  void preservesUnselectedAndClosedSnapshotsAcrossEditsAndSourceArchival() {
    var a = active(true);
    var b = active(true);
    var meal = meals.save(null, author, save(0, content(), List.of(a.id(), b.id())));
    UUID old = meal.revision().id();
    close(b.id());
    meal =
        meals.save(
            meal.id(),
            author,
            save(
                meal.version(), content(List.of(new Item("Changed", 1, 900, 0))), List.of(a.id())));
    assertThat(
            meal.submissions().stream()
                .filter(entry -> entry.competitionId().equals(b.id()))
                .findFirst()
                .orElseThrow()
                .revisionId())
        .isEqualTo(old);
    assertThat(
            meal.submissions().stream()
                .filter(entry -> entry.competitionId().equals(a.id()))
                .findFirst()
                .orElseThrow()
                .totalHundredths())
        .isEqualTo(900);
    var archived = meals.archive(meal.id(), author, new Change(UUID.randomUUID(), meal.version()));
    assertThat(archived.archived()).isTrue();
    assertThat(archived.submissions()).hasSize(2).noneMatch(Submission::withdrawn);
    assertThat(meals.list(author, false, 0).items()).isEmpty();
    assertThat(meals.list(author, true, 0).items()).hasSize(1);
    assertThat(meals.history(meal.id(), author, 0).items()).hasSize(2);
    UUID id = meal.id();
    long version = archived.version();
    rejected("MEAL_ARCHIVED", () -> meals.save(id, author, save(version, content(), List.of())));
  }

  @Test
  void acceptsGracePeriodBackfillButRejectsFutureEndAndExactCutoffWrites() {
    var competition = active(true);
    database.update(
        "UPDATE competitions SET ends_at = date_trunc('milliseconds', clock_timestamp()) - interval '1 hour' WHERE id = ?",
        competition.id());
    var past =
        new Content(
            Instant.now().minusSeconds(5400).truncatedTo(ChronoUnit.MILLIS),
            null,
            "Private place",
            "",
            content().items(),
            List.of());
    var meal = meals.save(null, author, save(0, past, List.of(competition.id())));
    assertThat(meal.submissions()).hasSize(1);
    var end = competitions.get(competition.id(), author).endsAt();
    rejected(
        "OUTSIDE_EATING_WINDOW",
        () ->
            meals.save(
                null,
                author,
                save(
                    0,
                    new Content(end, null, "Place", "", past.items(), List.of()),
                    List.of(competition.id()))));
    rejected(
        "INVALID_EATEN_AT",
        () ->
            meals.save(
                null,
                author,
                save(
                    0,
                    new Content(
                        Instant.now().plusSeconds(60), null, "Place", "", past.items(), List.of()),
                    List.of())));
    close(competition.id());
    rejected(
        "SUBMISSIONS_CLOSED",
        () -> meals.save(meal.id(), author, save(meal.version(), past, List.of(competition.id()))));
    rejected(
        "SUBMISSIONS_CLOSED",
        () ->
            meals.withdraw(meal.id(), competition.id(), author, new Change(UUID.randomUUID(), 1L)));
    assertThat(
            meals
                .save(meal.id(), author, save(meal.version(), content(), List.of()))
                .revision()
                .id())
        .isNotEqualTo(meal.revision().id());
  }

  @Test
  void rechecksTheDatabaseDeadlineAfterWaitingForCompetitionLocks() throws Exception {
    var competition = active(true);
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var locker =
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
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                          } catch (InterruptedException error) {
                            throw new RuntimeException(error);
                          }
                          close(competition.id());
                        }));
    assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
    var waiting =
        CompletableFuture.runAsync(
            () -> meals.save(null, author, save(0, content(), List.of(competition.id()))));
    try {
      long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while (System.nanoTime() < until
          && database.queryForObject(
                  "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%competitions%'",
                  Long.class)
              == 0) Thread.sleep(10);
      assertThat(
              database.queryForObject(
                  "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%competitions%'",
                  Long.class))
          .isPositive();
    } finally {
      release.countDown();
    }
    locker.join();
    assertThatThrownBy(waiting::join)
        .hasRootCauseInstanceOf(MealException.class)
        .hasRootCauseMessage("SUBMISSIONS_CLOSED");
    assertThat(count("meals")).isZero();
  }

  @Test
  void requiresPrivateSourceOwnershipAndMemberAccessToOnlyTheirSnapshot() throws Exception {
    var competition = active(true);
    var meal = meals.save(null, author, save(0, content(), List.of(competition.id())));
    mvc.perform(get("/api/v1/meals/" + meal.id()).with(as(member)))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/competitions/" + competition.id() + "/meals"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/competitions/" + competition.id() + "/meals").with(as(stranger)))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/competitions/" + competition.id() + "/meals").with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].revision.totalHundredths").value(1900))
        .andExpect(jsonPath("$.items[0].ownerId").doesNotExist());
    var changed =
        meals.save(
            meal.id(),
            author,
            save(meal.version(), content(List.of(new Item("Private edit", 1, 100, 0))), List.of()));
    assertThat(meals.entries(competition.id(), member, 0).items().getFirst().revision().id())
        .isEqualTo(meal.revision().id());
    assertThat(changed.revision().totalHundredths()).isEqualTo(100);
    competitions.exclude(competition.id(), author, member, "No longer a member");
    mvc.perform(get("/api/v1/competitions/" + competition.id() + "/meals").with(as(member)))
        .andExpect(status().isNotFound());
  }

  @Test
  void withdrawsAndResubmitsOneUniqueEntryWithAnAuditTrailAndVersionChecks() {
    var competition = active(false);
    var meal = meals.save(null, author, save(0, content(), List.of(competition.id())));
    var request = new Change(UUID.randomUUID(), 1L);
    meals.withdraw(meal.id(), competition.id(), author, request);
    meals.withdraw(meal.id(), competition.id(), author, request);
    assertThat(meals.entries(competition.id(), member, 0).items()).isEmpty();
    var updated =
        meals.save(meal.id(), author, save(meal.version(), content(), List.of(competition.id())));
    assertThat(updated.submissions()).hasSize(1).noneMatch(Submission::withdrawn);
    assertThat(count("competition_entry_events")).isEqualTo(3);
    rejected(
        "VERSION_CONFLICT", () -> meals.save(meal.id(), author, save(0, content(), List.of())));
    rejected(
        "VERSION_CONFLICT",
        () ->
            meals.withdraw(meal.id(), competition.id(), author, new Change(UUID.randomUUID(), 1L)));
  }

  @Test
  void keepsMealPhotosSeparateAndAuthorizesOnlyExplicitlySubmittedSnapshotAssociations()
      throws Exception {
    var competition = active(true);
    var encoded = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB), "png", encoded);
    var photo = meals.upload(author, encoded.toByteArray());
    mvc.perform(get("/api/v1/meal-photos/" + photo).with(as(member)))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/directory/photos/" + photo)).andExpect(status().isNotFound());
    var withPhoto =
        new Content(
            content().eatenAt(), null, "Private place", "", content().items(), List.of(photo));
    var meal = meals.save(null, author, save(0, withPhoto, List.of()));
    assertThat(meals.stagedPhotos(author)).isEmpty();
    rejected("INVALID_PHOTO", () -> meals.save(null, author, save(0, withPhoto, List.of())));
    meal =
        meals.save(meal.id(), author, save(meal.version(), withPhoto, List.of(competition.id())));
    mvc.perform(get("/api/v1/meal-photos/" + photo).with(as(member)))
        .andExpect(status().isOk())
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                .contentType("image/jpeg"))
        .andExpect(header().string("Cache-Control", "no-store"));
    meals.save(meal.id(), author, save(meal.version(), content(), List.of()));
    mvc.perform(get("/api/v1/meal-photos/" + photo).with(as(member))).andExpect(status().isOk());
    meals.withdraw(meal.id(), competition.id(), author, new Change(UUID.randomUUID(), 1L));
    mvc.perform(get("/api/v1/meal-photos/" + photo).with(as(member)))
        .andExpect(status().isNotFound());
    rejected("PHOTO_IN_USE", () -> meals.discardPhoto(photo, author));
  }

  private CompetitionService.Competition active(boolean sharing) {
    var draft = competitions.create(author, settings(sharing));
    var published = competitions.publish(draft.id(), author, draft.version());
    var invite = competitions.invite(published.id(), author);
    competitions.joinInvitation(
        member, invite.inviteUrl().substring(invite.inviteUrl().lastIndexOf('=') + 1));
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '2 hours', ends_at = clock_timestamp() + interval '1 hour' WHERE id = ?",
        draft.id());
    return competitions.get(draft.id(), author);
  }

  private CompetitionService.Settings settings(boolean sharing) {
    return new CompetitionService.Settings(
        "Test crew",
        "",
        CompetitionService.Visibility.PRIVATE,
        "UTC",
        Instant.now().plusSeconds(3600).truncatedTo(ChronoUnit.MILLIS),
        Instant.now().plusSeconds(7200).truncatedTo(ChronoUnit.MILLIS),
        sharing);
  }

  private void close(UUID id) {
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '48 hours', ends_at = clock_timestamp() - interval '24 hours' WHERE id = ?",
        id);
  }

  private Content content() {
    return content(List.of(new Item("Eight inch", 2, 800, 300)));
  }

  private Content content(List<Item> items) {
    return new Content(
        Instant.now().minusSeconds(1800).truncatedTo(ChronoUnit.MILLIS),
        null,
        "Private place",
        "",
        items,
        List.of());
  }

  private Save save(long version, Content content, List<UUID> targets) {
    return new Save(UUID.randomUUID(), version, content, targets);
  }

  private long count(String table) {
    return database.queryForObject("SELECT count(*) FROM " + table, Long.class);
  }

  private RequestPostProcessor as(UUID id) {
    return authentication(
        new UsernamePasswordAuthenticationToken(
            new AccountPrincipal(id), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
  }

  private void rejected(String code, org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
    assertThatThrownBy(action)
        .isInstanceOfSatisfying(
            MealException.class, error -> assertThat(error.getMessage()).isEqualTo(code));
  }
}
