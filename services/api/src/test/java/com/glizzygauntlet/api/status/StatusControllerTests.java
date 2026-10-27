package com.glizzygauntlet.api.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

class StatusControllerTests {
  @Test
  void reportsDatabaseFailureWithoutExposingConnectionDetails() {
    JdbcTemplate database = mock(JdbcTemplate.class);
    when(database.queryForObject("SELECT 1", Integer.class))
        .thenThrow(new DataAccessResourceFailureException("private connection details"));

    var response = new StatusController(database).status();

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(response.getBody()).isEqualTo(new StatusController.ServiceStatus("DOWN"));
    assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
  }
}
