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
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
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
import tools.jackson.databind.ObjectMapper;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = "app.results.sweep-delay-ms=3600000")
@AutoConfigureMockMvc
class ProgressIntegrationTests {
  @Autowired ProgressService progress;
  @Autowired MealService meals;
  @Autowired CompetitionService competitions;
  @Autowired AccountService accounts;
  @Autowired JdbcTemplate database;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  UUID author;
  UUID other;

  @BeforeEach
  void reset() {
    database.execute("TRUNCATE app_users, spring_session, magic_link_tokens CASCADE");
    author = user("Author");
    other = user("Other");
  }

  @Test
  void ranksOnlyByInchesIncludesZeroMembersAndPreservesRanksAcrossPages() {
    var competition = active("PUBLIC", "UTC");
    submit(competition.id(), author, 1900);
    join(competition.id(), other);
    meals.save(
        null,
        other,
        save(
            0,
            new MealService.Content(
                content(1900).eatenAt(),
                null,
                "Private label",
                "",
                List.of(new MealService.Item("Two smaller dogs", 2, 950, 0)),
                List.of()),
            List.of(competition.id())));
    UUID third = user("Third");
    join(competition.id(), third);
    submit(competition.id(), third, 800);
    UUID zero = user("Zero");
    join(competition.id(), zero);
    var standings = progress.standings(competition.id(), null, 0);
    assertThat(standings.items())
        .extracting(ProgressService.Standing::rank)
        .containsExactly(1L, 1L, 3L, 4L);
    assertThat(progress.personal(competition.id(), zero, 0, 0).totalHundredths()).isZero();
    assertThat(progress.personal(competition.id(), zero, 0, 0).rank()).isEqualTo(4);
    for (int i = 0; i < 21; i++) {
      UUID member = user("Tie" + i);
      join(competition.id(), member);
      submit(competition.id(), member, 1900);
    }
    assertThat(progress.standings(competition.id(), null, 0).hasMore()).isTrue();
    var second = progress.standings(competition.id(), null, 1);
    assertThat(second.hasMore()).isFalse();
    assertThat(second.items())
        .extracting(ProgressService.Standing::rank)
        .containsExactly(1L, 1L, 1L, 24L, 25L);
  }

  @Test
  void usesCompetitionSnapshotsOnceWithoutFollowingPrivateEditsOrSourceArchival() {
    var a = active("PRIVATE", "UTC");
    var b = active("PRIVATE", "UTC");
    var original = meals.save(null, author, save(0, content(1900), List.of(a.id(), b.id())));
    var changed =
        meals.save(original.id(), author, save(original.version(), content(1700), List.of(a.id())));
    meals.archive(
        changed.id(), author, new MealService.Change(UUID.randomUUID(), changed.version()));
    assertThat(progress.personal(a.id(), author, 0, 0).totalHundredths()).isEqualTo(1700);
    assertThat(progress.personal(b.id(), author, 0, 0).totalHundredths()).isEqualTo(1900);
    assertThat(progress.personal(a.id(), author, 0, 0).mealCount()).isEqualTo(1);
    assertThat(progress.personal(b.id(), author, 0, 0).recentMeals().getFirst().revisionId())
        .isEqualTo(original.revision().id());
    meals.withdraw(original.id(), a.id(), author, new MealService.Change(UUID.randomUUID(), 2L));
    var withdrawn = progress.personal(a.id(), author, 0, 0);
    assertThat(withdrawn.totalHundredths()).isZero();
    assertThat(withdrawn.mealCount()).isZero();
    assertThat(withdrawn.places()).isEmpty();
    assertThat(progress.personal(b.id(), author, 0, 0).totalHundredths()).isEqualTo(1900);
  }

  @Test
  void bucketsRepeatedHoursByLocalDateAndCarriesEarlierTotalsAcrossDayPages() {
    var competition = active("PRIVATE", "America/New_York");
    database.update(
        "UPDATE competitions SET starts_at = '2024-10-01T04:00:00Z' WHERE id = ?",
        competition.id());
    submitAt(competition.id(), "2024-10-02T16:00:00Z", 400);
    submitAt(competition.id(), "2024-11-03T03:30:00Z", 100);
    submitAt(competition.id(), "2024-11-03T05:30:00Z", 200);
    submitAt(competition.id(), "2024-11-03T06:30:00Z", 300);
    database.update(
        "UPDATE competitions SET ends_at = '2024-11-05T05:00:00Z' WHERE id = ?", competition.id());
    var view = progress.personal(competition.id(), author, 0, 0);
    assertThat(view.provisional()).isTrue();
    assertThat(view.days()).hasSize(30);
    assertThat(view.daysHasMore()).isTrue();
    var fold =
        view.days().stream()
            .filter(day -> day.date().equals(LocalDate.of(2024, 11, 3)))
            .findFirst()
            .orElseThrow();
    assertThat(fold.totalHundredths()).isEqualTo(500);
    assertThat(fold.mealCount()).isEqualTo(2);
    assertThat(fold.cumulativeHundredths()).isEqualTo(1000);
    assertThat(view.days().getFirst().cumulativeHundredths()).isEqualTo(400);
    var earlier = progress.personal(competition.id(), author, 1, 0);
    assertThat(earlier.daysHasMore()).isFalse();
    assertThat(earlier.days().getLast().cumulativeHundredths()).isEqualTo(400);
  }

  @Test
  void treatsTheSpringForwardDayAsOneLocalDayAndKeepsZeroDays() {
    var competition = active("PRIVATE", "America/New_York");
    database.update(
        "UPDATE competitions SET starts_at = '2025-03-08T05:00:00Z' WHERE id = ?",
        competition.id());
    submitAt(competition.id(), "2025-03-09T06:30:00Z", 100);
    submitAt(competition.id(), "2025-03-09T07:30:00Z", 200);
    database.update(
        "UPDATE competitions SET ends_at = '2025-03-10T04:00:00Z' WHERE id = ?", competition.id());
    var days = progress.personal(competition.id(), author, 0, 0).days();
    assertThat(days).hasSize(2);
    assertThat(days.getFirst().totalHundredths()).isZero();
    assertThat(days.getLast().totalHundredths()).isEqualTo(300);
    assertThat(days.getLast().wholeHotDogs()).isEqualTo(2);
  }

  @Test
  void pagesDistinctSnapshotPlacesAndBoundsRecentMeals() {
    var competition = active("PRIVATE", "UTC");
    for (int i = 0; i < 22; i++) {
      var content =
          new MealService.Content(
              content(100).eatenAt(),
              null,
              "Private label " + i,
              "",
              content(100).items(),
              List.of());
      meals.save(null, author, save(0, content, List.of(competition.id())));
    }
    var view = progress.personal(competition.id(), author, 0, 0);
    assertThat(view.privateLocationCount()).isEqualTo(22);
    assertThat(view.venueCount()).isZero();
    assertThat(view.places()).hasSize(20);
    assertThat(view.placesHasMore()).isTrue();
    assertThat(view.recentMeals()).hasSize(5);
    assertThat(progress.personal(competition.id(), author, 0, 1).places()).hasSize(2);
  }

  @Test
  void countsTheSameVenueOnceAcrossDifferentSubmittedLabelsAndKeepsHiddenVisits() {
    var competition = active("PRIVATE", "UTC");
    UUID venue = UUID.randomUUID();
    UUID revision = UUID.randomUUID();
    database.update("INSERT INTO directory_venues (id) VALUES (?)", venue);
    database.update(
        """
        INSERT INTO directory_contributions
          (id, venue_id, contributor_id, name, address, description, latitude, longitude, status)
        VALUES (?, ?, ?, 'Original name', 'Public address', '', 0, 0, 'APPROVED')
        """,
        revision,
        venue,
        author);
    database.update(
        "UPDATE directory_venues SET current_revision = ? WHERE id = ?", revision, venue);
    for (String name : List.of("Original name", "Renamed venue")) {
      database.update("UPDATE directory_contributions SET name = ? WHERE id = ?", name, revision);
      var content =
          new MealService.Content(
              content(100).eatenAt(), venue, "", "", content(100).items(), List.of());
      meals.save(null, author, save(0, content, List.of(competition.id())));
    }
    database.update("UPDATE directory_venues SET hidden = TRUE WHERE id = ?", venue);
    var view = progress.personal(competition.id(), author, 0, 0);
    assertThat(view.venueCount()).isEqualTo(1);
    assertThat(view.privateLocationCount()).isZero();
    assertThat(view.places()).hasSize(1);
    assertThat(view.places().getFirst().mealCount()).isEqualTo(2);
    assertThat(view.places().getFirst().totalHundredths()).isEqualTo(200);
  }

  @Test
  void exposesOnlyNamesAndTotalsPubliclyAndProtectsPrivateAndPersonalViews() throws Exception {
    var publicCompetition = active("PUBLIC", "UTC");
    submit(publicCompetition.id(), author, 1900);
    var response =
        mvc.perform(get("/api/v1/competitions/" + publicCompetition.id() + "/standings"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    var first = json.readTree(response).get("items").get(0);
    assertThat(first.propertyNames())
        .containsExactlyInAnyOrder("rank", "displayName", "totalHundredths", "wholeHotDogs");
    assertThat(response)
        .doesNotContain("Private label", author.toString(), "@example.test", "revisionId");
    mvc.perform(get("/api/v1/competitions/" + publicCompetition.id() + "/progress"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/competitions/" + publicCompetition.id() + "/progress").with(as(other)))
        .andExpect(status().isForbidden());
    var privateCompetition = active("PRIVATE", "UTC");
    for (String endpoint : List.of("standings", "progress"))
      mvc.perform(
              get("/api/v1/competitions/" + privateCompetition.id() + "/" + endpoint)
                  .with(as(other)))
          .andExpect(status().isNotFound());
    join(privateCompetition.id(), other);
    mvc.perform(
            get("/api/v1/competitions/" + privateCompetition.id() + "/progress?userId=" + author)
                .with(as(other)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mealCount").value(0));
    competitions.exclude(privateCompetition.id(), author, other, "Test exclusion");
    mvc.perform(
            get("/api/v1/competitions/" + privateCompetition.id() + "/progress").with(as(other)))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/competitions/" + publicCompetition.id() + "/standings?page=-1"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            get("/api/v1/competitions/" + publicCompetition.id() + "/progress?dayPage=1001")
                .with(as(author)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void doesNotTreatMembershipExclusionAsAScoringCorrection() {
    var competition = active("PUBLIC", "UTC");
    join(competition.id(), other);
    submit(competition.id(), other, 1900);
    competitions.exclude(competition.id(), author, other, "No longer a member");
    assertThat(progress.standings(competition.id(), null, 0).items().getFirst().totalHundredths())
        .isEqualTo(1900);
  }

  private UUID user(String name) {
    UUID id = accounts.findOrCreate("email", name + "@example.test", name + "@example.test").id();
    accounts.rename(id, name);
    return id;
  }

  private CompetitionService.Competition active(String visibility, String zone) {
    var start = Instant.now().plusSeconds(3600).truncatedTo(ChronoUnit.MILLIS);
    var draft =
        competitions.create(
            author,
            new CompetitionService.Settings(
                "Progress crew",
                "",
                CompetitionService.Visibility.valueOf(visibility),
                zone,
                start,
                start.plusSeconds(86400),
                true));
    competitions.publish(draft.id(), author, draft.version());
    database.update(
        "UPDATE competitions SET starts_at = clock_timestamp() - interval '2 days' WHERE id = ?",
        draft.id());
    return competitions.get(draft.id(), author);
  }

  private void join(UUID competition, UUID user) {
    database.update(
        "INSERT INTO competition_memberships (competition_id, user_id) VALUES (?, ?)",
        competition,
        user);
  }

  private void submit(UUID competition, UUID user, int hundredths) {
    meals.save(null, user, save(0, content(hundredths), List.of(competition)));
  }

  private void submitAt(UUID competition, String time, int hundredths) {
    var body = content(hundredths);
    meals.save(
        null,
        author,
        save(
            0,
            new MealService.Content(
                Instant.parse(time), null, body.location(), "", body.items(), List.of()),
            List.of(competition)));
  }

  private MealService.Content content(int hundredths) {
    return new MealService.Content(
        Instant.now().minusSeconds(3600).truncatedTo(ChronoUnit.MILLIS),
        null,
        "Private label",
        "",
        List.of(new MealService.Item("Measured dog", 1, hundredths, 0)),
        List.of());
  }

  private MealService.Save save(long version, MealService.Content content, List<UUID> targets) {
    return new MealService.Save(UUID.randomUUID(), version, content, targets);
  }

  private RequestPostProcessor as(UUID user) {
    return authentication(
        new UsernamePasswordAuthenticationToken(
            new AccountPrincipal(user), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
  }
}
