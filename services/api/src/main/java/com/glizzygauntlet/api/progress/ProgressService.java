package com.glizzygauntlet.api.progress;

import com.glizzygauntlet.api.competitions.CompetitionException;
import com.glizzygauntlet.api.competitions.CompetitionService;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class ProgressService {
  private final JdbcTemplate database;
  private final CompetitionService competitions;

  private static final String RANKED =
      """
      WITH scores AS (
        SELECT m.owner_id,
          SUM(CASE WHEN e.score_excluded THEN 0 ELSE COALESCE(e.adjusted_total_hundredths, r.total_hundredths) END) AS total,
          SUM(CASE WHEN e.score_excluded THEN 0 ELSE COALESCE(e.adjusted_whole_hot_dogs, r.whole_hot_dogs) END) AS whole
        FROM competition_entries e JOIN meals m ON m.id = e.meal_id
        JOIN meal_revisions r ON r.id = e.revision_id
        WHERE e.competition_id = ? AND NOT e.withdrawn GROUP BY m.owner_id
      ), ranked AS (
        SELECT u.id, u.display_name, COALESCE(s.total, 0) AS total, COALESCE(s.whole, 0) AS whole,
          RANK() OVER (ORDER BY COALESCE(s.total, 0) DESC) AS rank
        FROM competition_memberships m JOIN app_users u ON u.id = m.user_id
        LEFT JOIN scores s ON s.owner_id = u.id
        WHERE m.competition_id = ? AND (m.status = 'ACTIVE' OR s.owner_id IS NOT NULL)
      )
      """;
  private static final String OWN =
      """
      FROM competition_entries e JOIN meals m ON m.id = e.meal_id
      JOIN meal_revisions r ON r.id = e.revision_id
      WHERE e.competition_id = ? AND m.owner_id = ? AND NOT e.withdrawn AND NOT e.score_excluded
      """;

  public ProgressService(JdbcTemplate database, CompetitionService competitions) {
    this.database = database;
    this.competitions = competitions;
  }

  public record Standing(long rank, String displayName, long totalHundredths, long wholeHotDogs) {}

  public record Standings(List<Standing> items, boolean hasMore, boolean provisional) {}

  public record Day(
      LocalDate date,
      long totalHundredths,
      long wholeHotDogs,
      long mealCount,
      long cumulativeHundredths) {}

  public record Place(UUID venueId, String location, long mealCount, long totalHundredths) {}

  public record RecentMeal(
      UUID mealId,
      UUID revisionId,
      Instant eatenAt,
      String location,
      long totalHundredths,
      long wholeHotDogs) {}

  public record Progress(
      String timeZone,
      boolean provisional,
      long rank,
      long totalHundredths,
      long wholeHotDogs,
      long mealCount,
      long venueCount,
      long privateLocationCount,
      List<Day> days,
      boolean daysHasMore,
      List<Place> places,
      boolean placesHasMore,
      List<RecentMeal> recentMeals) {}

  public Standings standings(UUID id, UUID viewer, int page) {
    competitions.get(id, viewer);
    validatePage(page);
    if (finalized(id)) {
      var frozen =
          database.query(
              """
          SELECT p.* FROM competition_result_participants p JOIN competition_results r ON r.id = p.result_id
          JOIN competitions c ON c.id = r.competition_id AND c.current_result_version = r.version
          WHERE c.id = ? ORDER BY p.rank, p.user_id LIMIT 21 OFFSET ?
          """,
              (rs, i) ->
                  new Standing(
                      rs.getLong("rank"),
                      rs.getString("display_name"),
                      rs.getLong("total_hundredths"),
                      rs.getLong("whole_hot_dogs")),
              id,
              page * 20);
      return new Standings(frozen.stream().limit(20).toList(), frozen.size() > 20, false);
    }
    var rows =
        database.query(
            RANKED + "SELECT * FROM ranked ORDER BY total DESC, id LIMIT 21 OFFSET ?",
            (rs, i) ->
                new Standing(
                    rs.getLong("rank"),
                    rs.getString("display_name"),
                    rs.getLong("total"),
                    rs.getLong("whole")),
            id,
            id,
            page * 20);
    return new Standings(rows.stream().limit(20).toList(), rows.size() > 20, true);
  }

  public Progress personal(UUID id, UUID user, int dayPage, int placePage) {
    if (user == null) throw error(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    var competition = competitions.get(id, user);
    if (competition.viewerRole() == CompetitionService.Role.NONE)
      throw error(HttpStatus.FORBIDDEN, "MEMBERS_ONLY");
    validatePage(dayPage);
    validatePage(placePage);
    boolean finalized = finalized(id);
    var standing =
        finalized
            ? database.queryForObject(
                """
            SELECT p.* FROM competition_result_participants p JOIN competition_results r ON r.id = p.result_id
            JOIN competitions c ON c.id = r.competition_id AND c.current_result_version = r.version
            WHERE c.id = ? AND p.user_id = ?
            """,
                (rs, i) ->
                    new Standing(
                        rs.getLong("rank"),
                        rs.getString("display_name"),
                        rs.getLong("total_hundredths"),
                        rs.getLong("whole_hot_dogs")),
                id,
                user)
            : database.queryForObject(
                RANKED + "SELECT * FROM ranked WHERE id = ?",
                (rs, i) ->
                    new Standing(
                        rs.getLong("rank"),
                        rs.getString("display_name"),
                        rs.getLong("total"),
                        rs.getLong("whole")),
                id,
                id,
                user);
    var counts =
        database.queryForMap(
            """
        SELECT COUNT(*) AS meals, COUNT(DISTINCT r.venue_id) AS venues,
          COUNT(DISTINCT r.location) FILTER (WHERE r.venue_id IS NULL) AS private_places
        """
                + OWN,
            id,
            user);
    var zone = ZoneId.of(competition.timeZone());
    var now = database.queryForObject("SELECT clock_timestamp()", OffsetDateTime.class).toInstant();
    var last =
        (now.isBefore(competition.endsAt()) ? now : competition.endsAt().minusNanos(1))
            .atZone(zone)
            .toLocalDate()
            .minusDays(dayPage * 30L);
    var first = competition.startsAt().atZone(zone).toLocalDate();
    var start = last.minusDays(29).isBefore(first) ? first : last.minusDays(29);
    var days = new ArrayList<Day>();
    if (!last.isBefore(first)) {
      Instant from = start.atStartOfDay(zone).toInstant();
      Instant until = last.plusDays(1).atStartOfDay(zone).toInstant();
      long cumulative =
          database.queryForObject(
              "SELECT COALESCE(SUM(COALESCE(e.adjusted_total_hundredths, r.total_hundredths)), 0) "
                  + OWN
                  + " AND r.eaten_at < ?",
              Long.class,
              id,
              user,
              from.atOffset(ZoneOffset.UTC));
      var daily = new HashMap<LocalDate, long[]>();
      database.query(
          connection -> {
            var statement =
                connection.prepareStatement(
                    "SELECT r.eaten_at, COALESCE(e.adjusted_total_hundredths, r.total_hundredths) AS total_hundredths, "
                        + "COALESCE(e.adjusted_whole_hot_dogs, r.whole_hot_dogs) AS whole_hot_dogs "
                        + OWN
                        + " AND r.eaten_at >= ? AND r.eaten_at < ?");
            statement.setFetchSize(200);
            statement.setObject(1, id);
            statement.setObject(2, user);
            statement.setObject(3, from.atOffset(ZoneOffset.UTC));
            statement.setObject(4, until.atOffset(ZoneOffset.UTC));
            return statement;
          },
          (RowCallbackHandler)
              rs -> {
                var date =
                    rs.getObject("eaten_at", OffsetDateTime.class)
                        .toInstant()
                        .atZone(zone)
                        .toLocalDate();
                var totals = daily.computeIfAbsent(date, ignored -> new long[3]);
                totals[0] = Math.addExact(totals[0], rs.getLong("total_hundredths"));
                totals[1] = Math.addExact(totals[1], rs.getLong("whole_hot_dogs"));
                totals[2]++;
              });
      for (var date = start; !date.isAfter(last); date = date.plusDays(1)) {
        var totals = daily.getOrDefault(date, new long[3]);
        cumulative = Math.addExact(cumulative, totals[0]);
        days.add(new Day(date, totals[0], totals[1], totals[2], cumulative));
      }
    }
    var places =
        database.query(
            """
        SELECT r.venue_id, MIN(r.location) AS location, COUNT(*) AS meals,
          SUM(COALESCE(e.adjusted_total_hundredths, r.total_hundredths)) AS total
        """
                + OWN
                + """
         GROUP BY r.venue_id, CASE WHEN r.venue_id IS NULL THEN r.location END
         ORDER BY total DESC, r.venue_id NULLS LAST, MIN(r.location) LIMIT 21 OFFSET ?
        """,
            (rs, i) ->
                new Place(
                    rs.getObject("venue_id", UUID.class),
                    rs.getString("location"),
                    rs.getLong("meals"),
                    rs.getLong("total")),
            id,
            user,
            placePage * 20);
    var recent =
        database.query(
            """
        SELECT e.meal_id, e.revision_id, r.eaten_at, r.location,
          COALESCE(e.adjusted_total_hundredths, r.total_hundredths) AS total_hundredths,
          COALESCE(e.adjusted_whole_hot_dogs, r.whole_hot_dogs) AS whole_hot_dogs
        """
                + OWN
                + " ORDER BY r.eaten_at DESC, e.id LIMIT 5",
            (rs, i) ->
                new RecentMeal(
                    rs.getObject("meal_id", UUID.class),
                    rs.getObject("revision_id", UUID.class),
                    rs.getObject("eaten_at", OffsetDateTime.class).toInstant(),
                    rs.getString("location"),
                    rs.getLong("total_hundredths"),
                    rs.getLong("whole_hot_dogs")),
            id,
            user);
    return new Progress(
        competition.timeZone(),
        !finalized,
        standing.rank(),
        standing.totalHundredths(),
        standing.wholeHotDogs(),
        ((Number) counts.get("meals")).longValue(),
        ((Number) counts.get("venues")).longValue(),
        ((Number) counts.get("private_places")).longValue(),
        days,
        !last.isBefore(first) && start.isAfter(first),
        places.stream().limit(20).toList(),
        places.size() > 20,
        recent);
  }

  private void validatePage(int page) {
    if (page < 0 || page > 1000) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
  }

  private boolean finalized(UUID id) {
    return Boolean.TRUE.equals(
        database.queryForObject(
            "SELECT current_result_version IS NOT NULL FROM competitions WHERE id = ?",
            Boolean.class,
            id));
  }

  private CompetitionException error(HttpStatus status, String code) {
    return new CompetitionException(status, code);
  }
}
