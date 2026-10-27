package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class GlizzyGauntletApplicationTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate database;

  @Test
  void reportsReadinessUsingTheRealDatabase() throws Exception {
    mvc.perform(get("/api/v1/status"))
        .andExpect(status().isOk())
        .andExpect(content().json("{\"status\":\"UP\"}"))
        .andExpect(header().string("Cache-Control", "no-store"));
    mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
  }

  @Test
  void protectsSessionCookiesByDefault() throws Exception {
    mvc.perform(get("/api/v1/auth/session"))
        .andExpect(status().isOk())
        .andExpect(
            header()
                .string(
                    "Set-Cookie",
                    org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("HttpOnly"),
                        org.hamcrest.Matchers.containsString("Secure"),
                        org.hamcrest.Matchers.containsString("SameSite=Lax"))));
  }

  @Test
  void deniesOtherApiRoutesWithoutOfferingPasswordSignIn() throws Exception {
    mvc.perform(get("/api/v1/me"))
        .andExpect(status().isUnauthorized())
        .andExpect(header().doesNotExist("WWW-Authenticate"))
        .andExpect(header().doesNotExist("Location"));
  }

  @Test
  @Transactional
  void runsTheMigrationAndEnforcesItsConstraints() {
    UUID id = UUID.randomUUID();
    database.update(
        "INSERT INTO app_users (id, display_name) VALUES (?, ?)", id, "Test participant");
    assertThat(
            database.queryForObject(
                "SELECT display_name FROM app_users WHERE id = ?", String.class, id))
        .isEqualTo("Test participant");
    assertThatThrownBy(
            () ->
                database.update(
                    "INSERT INTO app_users (id, display_name) VALUES (?, ?)",
                    UUID.randomUUID(),
                    "  "))
        .isInstanceOf(DataIntegrityViolationException.class);
  }
}
