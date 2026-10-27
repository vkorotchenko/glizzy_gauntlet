package com.glizzygauntlet.api.status;

import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class StatusController {
  private final JdbcTemplate database;

  public StatusController(JdbcTemplate database) {
    this.database = database;
  }

  @GetMapping("/status")
  public ResponseEntity<ServiceStatus> status() {
    try {
      database.queryForObject("SELECT 1", Integer.class);
      return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ServiceStatus("UP"));
    } catch (DataAccessException unavailable) {
      return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
          .cacheControl(CacheControl.noStore())
          .body(new ServiceStatus("DOWN"));
    }
  }

  public record ServiceStatus(String status) {}
}
