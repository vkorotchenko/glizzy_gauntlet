package com.glizzygauntlet.api.recaps;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class RecapFinalizer {
  private static final Logger LOG = LoggerFactory.getLogger(RecapFinalizer.class);
  private final JdbcTemplate database;
  private final RecapService recaps;

  public RecapFinalizer(JdbcTemplate database, RecapService recaps) {
    this.database = database;
    this.recaps = recaps;
  }

  @Scheduled(
      fixedDelayString = "${app.results.sweep-delay-ms:60000}",
      initialDelayString = "${app.results.sweep-delay-ms:60000}")
  public void sweep() {
    var due =
        database.queryForList(
            """
        SELECT id FROM competitions WHERE published_at IS NOT NULL AND current_result_version IS NULL
          AND clock_timestamp() >= ends_at + interval '24 hours'
        ORDER BY ends_at, id LIMIT 100
        """,
            UUID.class);
    for (UUID id : due) {
      try {
        recaps.finalizeDue(id);
      } catch (RuntimeException error) {
        LOG.warn("Could not finalize competition {}", id, error);
      }
    }
  }
}
