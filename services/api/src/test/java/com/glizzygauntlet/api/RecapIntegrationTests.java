package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.SessionAuthentication.AccountPrincipal;
import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.meals.MealService;
import com.glizzygauntlet.api.progress.ProgressService;
import com.glizzygauntlet.api.recaps.RecapFinalizer;
import com.glizzygauntlet.api.recaps.RecapService;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = "app.results.sweep-delay-ms=3600000")
@AutoConfigureMockMvc
class RecapIntegrationTests {
  @Autowired RecapService recaps;
  @Autowired RecapFinalizer finalizer;
  @Autowired MealService meals;
  @Autowired ProgressService progress;
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
    author = user("Captain");
    member = user("Member");
    stranger = user("Stranger");
  }

  @Test
  void finalizesAtTheDatabaseDeadlineOnceUnderConcurrentRequests() {
    UUID competition = active("PUBLIC");
    submit(competition, author, 1900);
    submit(competition, member, 1900);
    assertThat(recaps.finalizeDue(competition)).isFalse();
    rejected("RECAP_NOT_READY", () -> recaps.get(competition, null, null, 0));
    UUID entry = meals.entries(competition, author, 0).items().getFirst().id();
    rejected(
        "RECAP_NOT_READY",
        () -> recaps.correct(competition, entry, author, correction(1, 1700, false)));
    close(competition);
    var jobs = new ArrayList<CompletableFuture<RecapService.Recap>>();
    for (int i = 0; i < 6; i++)
      jobs.add(CompletableFuture.supplyAsync(() -> recaps.get(competition, null, null, 0)));
    var first = jobs.getFirst().join();
    for (var job : jobs) assertThat(job.join()).isEqualTo(first);
    assertThat(first.result().state()).isEqualTo("FINAL");
    assertThat(first.totalHundredths()).isEqualTo(3800);
    assertThat(first.standings())
        .extracting(ProgressService.Standing::rank)
        .containsExactly(1L, 1L);
    assertThat(count("competition_results")).isEqualTo(1);
    assertThat(count("competition_result_entries")).isEqualTo(2);
    assertThat(competitions.get(competition, author).phase())
        .isEqualTo(CompetitionService.Phase.FINALIZED);
    assertThat(progress.standings(competition, null, 0).provisional()).isFalse();
    assertThat(recaps.finalizeDue(competition)).isFalse();
  }

  @Test
  void sweepsMissedPrivateCompetitionsAndEmptyCompetitionsIdempotently() {
    UUID competition = active("PRIVATE");
    close(competition);
    finalizer.sweep();
    finalizer.sweep();
    assertThat(count("competition_results")).isEqualTo(1);
    var recap = recaps.get(competition, author, null, 0);
    assertThat(recap.totalHundredths()).isZero();
    assertThat(recap.standings()).hasSize(2).allSatisfy(row -> assertThat(row.rank()).isEqualTo(1));
    assertThat(recaps.highlights(competition, author, null).busiestDay()).isNull();
  }

  @Test
  void correctsOnlyOneCompetitionAndPreservesOldRecapsSourcesAndNames() {
    UUID a = active("PUBLIC");
    UUID b = active("PRIVATE");
    var source = meals.save(null, author, save(0, content(1900), List.of(a, b)));
    close(a);
    close(b);
    var original = recaps.get(a, null, null, 0);
    recaps.get(b, author, null, 0);
    var entry = meals.entries(a, author, 0).items().getFirst();
    var receipt = recaps.correct(a, entry.id(), author, correction(entry.version(), 1700, false));
    assertThat(receipt.resultVersion()).isEqualTo(2);
    assertThat(recaps.get(a, null, 1L, 0)).isEqualTo(original);
    assertThat(recaps.get(a, null, null, 0).totalHundredths()).isEqualTo(1700);
    assertThat(recaps.get(b, author, null, 0).totalHundredths()).isEqualTo(1900);
    assertThat(meals.get(source.id(), author).revision().totalHundredths()).isEqualTo(1900);
    assertThat(meals.history(source.id(), author, 0).items()).hasSize(1);
    assertThat(progress.personal(a, author, 0, 0).totalHundredths()).isEqualTo(1700);
    assertThat(progress.personal(a, author, 0, 0).days().getLast().cumulativeHundredths())
        .isEqualTo(1700);
    assertThat(progress.personal(a, author, 0, 0).provisional()).isFalse();
    assertThat(recaps.highlights(a, author, 1L).largestMealHundredths()).isEqualTo(1900);
    assertThat(recaps.highlights(a, author, 2L).largestMealHundredths()).isEqualTo(1700);
    accounts.rename(author, "Later nickname");
    assertThat(recaps.get(a, null, null, 0).standings())
        .extracting(ProgressService.Standing::displayName)
        .contains("Captain")
        .doesNotContain("Later nickname");
    var audit = recaps.audit(a, member, 0).items().getFirst();
    assertThat(audit.beforeTotalHundredths()).isEqualTo(1900);
    assertThat(audit.afterTotalHundredths()).isEqualTo(1700);
    assertThat(audit.actorDisplayName()).isEqualTo("Captain");
  }

  @Test
  void excludesAndRestoresScoresWithoutRemovingSnapshotsOrChangingMembership() {
    UUID competition = active("PRIVATE");
    var source = submit(competition, member, 1900);
    close(competition);
    var entry = meals.entries(competition, author, 0).items().getFirst();
    recaps.correct(competition, entry.id(), author, correction(1, 1900, true));
    assertThat(progress.personal(competition, member, 0, 0).mealCount()).isZero();
    assertThat(recaps.highlights(competition, author, 2L).mealCount()).isZero();
    assertThat(meals.entries(competition, member, 0).items()).hasSize(1);
    assertThat(meals.get(source.id(), member).submissions().getFirst().scoreExcluded()).isTrue();
    recaps.correct(competition, entry.id(), author, correction(2, 1900, false));
    assertThat(recaps.get(competition, member, null, 0).totalHundredths()).isEqualTo(1900);
    assertThat(recaps.get(competition, member, 2L, 0).totalHundredths()).isZero();
    assertThat(competitions.get(competition, member).viewerRole())
        .isEqualTo(CompetitionService.Role.MEMBER);
  }

  @Test
  void makesCorrectionsIdempotentAndRejectsChangedKeysStaleVersionsAndNoOps() {
    UUID competition = active("PUBLIC");
    submit(competition, author, 1900);
    close(competition);
    UUID entry = meals.entries(competition, author, 0).items().getFirst().id();
    var request = correction(1, 1700, false);
    var first =
        CompletableFuture.supplyAsync(() -> recaps.correct(competition, entry, author, request));
    var second =
        CompletableFuture.supplyAsync(() -> recaps.correct(competition, entry, author, request));
    assertThat(first.join()).isEqualTo(second.join());
    assertThat(count("entry_score_corrections")).isEqualTo(1);
    assertThat(count("competition_results")).isEqualTo(2);
    rejected(
        "REQUEST_CONFLICT",
        () ->
            recaps.correct(
                competition,
                entry,
                author,
                new RecapService.Correction(
                    request.requestId(), 1L, 1600L, 1, false, "Different payload")));
    rejected(
        "VERSION_CONFLICT",
        () -> recaps.correct(competition, entry, author, correction(1, 1600, false)));
    rejected(
        "NO_SCORE_CHANGE",
        () -> recaps.correct(competition, entry, author, correction(2, 1700, false)));
    assertThat(count("competition_results")).isEqualTo(2);
  }

  @Test
  void neverRevivesWithdrawnEntriesOrAcceptsAnotherCompetitionsEntry() {
    UUID a = active("PUBLIC");
    UUID b = active("PUBLIC");
    var source = submit(a, author, 1900);
    UUID entry = meals.entries(a, author, 0).items().getFirst().id();
    meals.withdraw(source.id(), a, author, new MealService.Change(UUID.randomUUID(), 1L));
    close(a);
    close(b);
    rejected("ENTRY_WITHDRAWN", () -> recaps.correct(a, entry, author, correction(2, 1700, false)));
    rejected("NOT_FOUND", () -> recaps.correct(b, entry, author, correction(1, 1700, false)));
    assertThat(count("entry_score_corrections")).isZero();
    assertThat(recaps.get(a, null, null, 0).totalHundredths()).isZero();
  }

  @Test
  void enforcesCsrfRolesValidationAndPublicMemberProjectionBoundaries() throws Exception {
    UUID competition = active("PUBLIC");
    submit(competition, member, 1900);
    close(competition);
    UUID entry = meals.entries(competition, author, 0).items().getFirst().id();
    String path = "/api/v1/competitions/" + competition;
    String target = path + "/entries/" + entry + "/corrections";
    String body = json.writeValueAsString(correction(1, 1700, false));
    mvc.perform(post(target).with(as(author)).contentType("application/json").content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post(target)
                .with(as(member))
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    for (String invalid :
        List.of(
            body.replace("\"reason\":\"Measured correction\"", "\"reason\":\" \""),
            body.replace("\"totalHundredths\":1700", "\"totalHundredths\":1700.5"),
            body.substring(0, body.length() - 1) + ",\"ownerId\":\"" + member + "\"}"))
      mvc.perform(
              post(target)
                  .with(as(author))
                  .with(csrf())
                  .contentType("application/json")
                  .content(invalid))
          .andExpect(status().isBadRequest());
    mvc.perform(
            post(target)
                .with(as(author))
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk());
    String publicJson =
        mvc.perform(get(path + "/recap"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(publicJson)
        .doesNotContain(
            "Secret picnic",
            "Measured correction",
            "entryId",
            "actorId",
            "busiestDay",
            "revisionId",
            "location",
            "@example.test",
            member.toString());
    mvc.perform(get(path + "/recap/highlights")).andExpect(status().isUnauthorized());
    mvc.perform(get(path + "/recap/highlights").with(as(stranger)))
        .andExpect(status().isForbidden());
    mvc.perform(get(path + "/recap/highlights").with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.places[0].location").value("Secret picnic"));
    mvc.perform(get(path + "/corrections").with(as(stranger))).andExpect(status().isForbidden());
    mvc.perform(get(path + "/corrections").with(as(member))).andExpect(status().isOk());
    UUID privateCompetition = active("PRIVATE");
    close(privateCompetition);
    mvc.perform(get("/api/v1/competitions/" + privateCompetition + "/recap"))
        .andExpect(status().isNotFound());
    mvc.perform(
            get("/api/v1/competitions/" + privateCompetition + "/recap/history").with(as(stranger)))
        .andExpect(status().isNotFound());
  }

  @Test
  void rejectsParticipantWritesAfterFinalizationEvenIfTheClockWindowMovesBack() {
    UUID competition = active("PUBLIC");
    submit(competition, author, 1900);
    close(competition);
    recaps.finalizeDue(competition);
    database.update(
        "UPDATE competitions SET ends_at = clock_timestamp() + interval '1 day' WHERE id = ?",
        competition);
    rejected("SUBMISSIONS_CLOSED", () -> submit(competition, author, 1000));
    rejected("JOINING_CLOSED", () -> competitions.join(competition, stranger));
    assertThat(recaps.get(competition, null, null, 0).totalHundredths()).isEqualTo(1900);
  }

  @Test
  void serializesFinalizationWithAQueuedParticipantWriteAtTheCutoff() throws Exception {
    UUID competition = active("PUBLIC");
    submit(competition, author, 1900);
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var holder =
        CompletableFuture.runAsync(
            () ->
                new TransactionTemplate(transactions)
                    .executeWithoutResult(
                        status -> {
                          database.queryForList(
                              "SELECT id FROM competitions WHERE id = ? FOR UPDATE", competition);
                          locked.countDown();
                          try {
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                          } catch (InterruptedException error) {
                            throw new RuntimeException(error);
                          }
                          close(competition);
                        }));
    assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
    var writer = CompletableFuture.runAsync(() -> submit(competition, author, 1000));
    var finalizing = CompletableFuture.supplyAsync(() -> recaps.finalizeDue(competition));
    try {
      long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while (System.nanoTime() < until && waiting() < 2) Thread.sleep(10);
      assertThat(waiting()).isGreaterThanOrEqualTo(2);
    } finally {
      release.countDown();
    }
    holder.join();
    assertThatThrownBy(writer::join).hasRootCauseMessage("SUBMISSIONS_CLOSED");
    assertThat(finalizing.join()).isTrue();
    assertThat(recaps.get(competition, null, null, 0).totalHundredths()).isEqualTo(1900);
  }

  @Test
  void retainsPagedHistoryWithoutRewritingEarlierResultRevisions() {
    UUID competition = active("PUBLIC");
    submit(competition, author, 1900);
    close(competition);
    var original = recaps.get(competition, null, null, 0);
    UUID entry = meals.entries(competition, author, 0).items().getFirst().id();
    for (int i = 0; i < 21; i++)
      recaps.correct(
          competition, entry, author, correction(i + 1, i % 2 == 0 ? 1700 : 1800, false));
    assertThat(recaps.history(competition, null, 0).items()).hasSize(20);
    assertThat(recaps.history(competition, null, 0).hasMore()).isTrue();
    assertThat(recaps.history(competition, null, 1).items()).hasSize(2);
    assertThat(recaps.get(competition, null, 1L, 0)).isEqualTo(original);
    assertThat(recaps.audit(competition, member, 0).items()).hasSize(20);
  }

  private long waiting() {
    return database.queryForObject(
        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%competitions%'",
        Long.class);
  }

  private UUID user(String name) {
    UUID id = accounts.findOrCreate("email", name + "@example.test", name + "@example.test").id();
    accounts.rename(id, name);
    return id;
  }

  private UUID active(String visibility) {
    var start = Instant.now().plusSeconds(3600).truncatedTo(ChronoUnit.MILLIS);
    var draft =
        competitions.create(
            author,
            new CompetitionService.Settings(
                "Recap crew",
                "",
                CompetitionService.Visibility.valueOf(visibility),
                "America/New_York",
                start,
                start.plusSeconds(86400),
                true));
    competitions.publish(draft.id(), author, draft.version());
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '48 hours' WHERE id = ?",
        draft.id());
    database.update(
        "INSERT INTO competition_memberships (competition_id, user_id) VALUES (?, ?)",
        draft.id(),
        member);
    return draft.id();
  }

  private MealService.Meal submit(UUID competition, UUID owner, long hundredths) {
    return meals.save(null, owner, save(0, content(hundredths), List.of(competition)));
  }

  private MealService.Content content(long hundredths) {
    return new MealService.Content(
        Instant.now().minusSeconds(25 * 3600).truncatedTo(ChronoUnit.MILLIS),
        null,
        "Secret picnic",
        "Private notes",
        List.of(new MealService.Item("Measured dog", 1, (int) hundredths, 0)),
        List.of());
  }

  private MealService.Save save(long version, MealService.Content content, List<UUID> targets) {
    return new MealService.Save(UUID.randomUUID(), version, content, targets);
  }

  private void close(UUID id) {
    database.update(
        "UPDATE competitions SET ends_at = date_trunc('milliseconds', clock_timestamp()) - interval '24 hours' WHERE id = ?",
        id);
  }

  private RecapService.Correction correction(long version, long total, boolean excluded) {
    return new RecapService.Correction(
        UUID.randomUUID(), version, total, 1, excluded, "Measured correction");
  }

  private long count(String table) {
    return database.queryForObject("SELECT count(*) FROM " + table, Long.class);
  }

  private RequestPostProcessor as(UUID user) {
    return authentication(
        new UsernamePasswordAuthenticationToken(
            new AccountPrincipal(user), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
  }

  private void rejected(String code, org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
    assertThatThrownBy(action).hasMessage(code);
  }
}
