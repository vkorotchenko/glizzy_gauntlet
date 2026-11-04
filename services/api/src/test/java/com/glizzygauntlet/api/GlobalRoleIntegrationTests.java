package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.AuthException;
import com.glizzygauntlet.api.auth.GlobalRoleService;
import com.glizzygauntlet.api.auth.GlobalRoleService.Role;
import com.glizzygauntlet.api.auth.SessionAuthentication.AccountPrincipal;
import com.glizzygauntlet.api.competitions.CompetitionService;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
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

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class GlobalRoleIntegrationTests {
  @Autowired GlobalRoleService roles;
  @Autowired AccountService accounts;
  @Autowired CompetitionService competitions;
  @Autowired JdbcTemplate database;
  @Autowired MockMvc mvc;
  @Autowired DataSource dataSource;
  UUID admin;
  UUID member;

  @BeforeEach
  void reset() {
    database.execute("TRUNCATE app_users, spring_session, magic_link_tokens CASCADE");
    admin = accounts.findOrCreate("email", "admin@example.test", "admin@example.test").id();
    member = accounts.findOrCreate("email", "member@example.test", "member@example.test").id();
    database.update("INSERT INTO account_roles (user_id, role) VALUES (?, 'ADMIN')", admin);
  }

  @Test
  void enforcesAuthenticationCsrfAndAdminAuthorityAndRejectsProfileEscalation() throws Exception {
    String path = "/api/v1/admin/accounts/" + member + "/roles/ADMIN";
    mvc.perform(get("/api/v1/admin/accounts")).andExpect(status().isUnauthorized());
    mvc.perform(put(path).with(csrf())).andExpect(status().isUnauthorized());
    mvc.perform(put(path).with(as(admin))).andExpect(status().isForbidden());
    mvc.perform(put(path).with(as(member)).with(csrf())).andExpect(status().isForbidden());
    roles.assign(admin, member, Role.VENUE_APPROVER, true);
    mvc.perform(get("/api/v1/admin/accounts").with(as(member))).andExpect(status().isForbidden());
    mvc.perform(put(path).with(as(member)).with(csrf())).andExpect(status().isForbidden());
    mvc.perform(
            put("/api/v1/me")
                .with(as(member))
                .with(csrf())
                .contentType("application/json")
                .content("{\"displayName\":\"Diner\",\"roles\":[\"ADMIN\"]}"))
        .andExpect(status().isBadRequest());
    mvc.perform(put(path.replace("/ADMIN", "/UNKNOWN")).with(as(admin)).with(csrf()))
        .andExpect(status().isBadRequest());
    assertThat(roles.roles(member)).containsExactly(Role.VENUE_APPROVER);
  }

  @Test
  void grantsAndRevokesIdempotentlyWithPrivateAccountDiscoveryAndAuditedChanges() throws Exception {
    mvc.perform(get("/api/v1/admin/accounts").param("query", member.toString()).with(as(admin)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.items.length()").value(1))
        .andExpect(jsonPath("$.items[0].email").doesNotExist());
    String path = "/api/v1/admin/accounts/" + member + "/roles/VENUE_APPROVER";
    for (int i = 0; i < 2; i++)
      mvc.perform(put(path).with(as(admin)).with(csrf()))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.roles[0]").value("VENUE_APPROVER"));
    assertThat(accounts.profile(member).siteOwner()).isFalse();
    for (int i = 0; i < 2; i++)
      mvc.perform(delete(path).with(as(admin)).with(csrf()))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.roles.length()").value(0));
    assertThat(
            database.queryForObject(
                "SELECT count(*) FROM account_role_events WHERE actor_id = ? AND target_user_id = ?",
                Long.class,
                admin,
                member))
        .isEqualTo(2);
    mvc.perform(
            put("/api/v1/admin/accounts/" + UUID.randomUUID() + "/roles/ADMIN")
                .with(as(admin))
                .with(csrf()))
        .andExpect(status().isNotFound());
    mvc.perform(
            delete("/api/v1/admin/accounts/" + admin + "/roles/ADMIN").with(as(admin)).with(csrf()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error").value("LAST_ADMIN"));
  }

  @Test
  void administersAllTimeWhileOptedOutWithoutAccessToUnjoinedPrivateCompetitions()
      throws Exception {
    UUID id = CompetitionService.ALL_TIME_ID;
    competitions.leave(id, admin);
    accounts.findOrCreate("email", "admin@example.test", "admin@example.test");
    var lifetime = competitions.get(id, admin);
    assertThat(lifetime.viewerRole()).isEqualTo(CompetitionService.Role.NONE);
    assertThat(lifetime.canAdminister()).isTrue();
    assertThat(competitions.list(admin, "administered", 0).items())
        .extracting(CompetitionService.Competition::id)
        .containsExactly(id);
    assertThat(competitions.list(admin, "mine", 0).items()).isEmpty();
    assertThat(competitions.list(admin, "participating", 0).items()).isEmpty();
    assertThat(competitions.members(id, admin, 0).items()).hasSize(1);
    assertThat(competitions.invite(id, admin).id()).isNotNull();
    String body =
        "{\"name\":\"Private crew\",\"rules\":\"\",\"visibility\":\"PRIVATE\",\"timeZone\":\"UTC\","
            + "\"startsAt\":\"2035-01-01T00:00:00Z\",\"endsAt\":\"2035-01-02T00:00:00Z\",\"allowSharedMeals\":false}";
    var result =
        mvc.perform(
                post("/api/v1/competitions")
                    .with(as(member))
                    .with(csrf())
                    .contentType("application/json")
                    .content(body))
            .andExpect(status().isCreated())
            .andReturn();
    String privateId =
        com.jayway.jsonpath.JsonPath.read(result.getResponse().getContentAsString(), "$.id");
    mvc.perform(get("/api/v1/competitions/" + privateId).with(as(admin)))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/competitions/" + id + "/members").with(as(admin)))
        .andExpect(status().isOk());
    mvc.perform(get("/api/v1/competitions/" + id + "/meals").with(as(admin)))
        .andExpect(status().isForbidden());
  }

  @Test
  void revocationImmediatelyRemovesAllTimeAuthorityEvenForItsLegacyOrganizer() {
    UUID id = CompetitionService.ALL_TIME_ID;
    database.update("UPDATE competitions SET organizer_id = ? WHERE id = ?", member, id);
    assertThat(competitions.get(id, member).canAdminister()).isFalse();
    roles.assign(admin, member, Role.ADMIN, true);
    assertThat(competitions.get(id, member).canAdminister()).isTrue();
    roles.assign(admin, member, Role.ADMIN, false);
    assertThat(competitions.get(id, member).canAdminister()).isFalse();
    assertThat(competitions.get(id, member).viewerRole()).isEqualTo(CompetitionService.Role.MEMBER);
    assertThatThrownBy(() -> roles.assign(member, admin, Role.VENUE_APPROVER, true))
        .isInstanceOfSatisfying(
            AuthException.class,
            error -> assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN));
  }

  @Test
  void concurrentSelfRevocationsCannotRemoveEveryAdmin() {
    roles.assign(admin, member, Role.ADMIN, true);
    var first = CompletableFuture.supplyAsync(() -> revokeSelf(admin));
    var second = CompletableFuture.supplyAsync(() -> revokeSelf(member));
    assertThat(List.of(first.join(), second.join()))
        .containsExactlyInAnyOrder("REVOKED", "LAST_ADMIN");
    assertThat(
            database.queryForObject(
                "SELECT count(*) FROM account_roles WHERE role = 'ADMIN'", Long.class))
        .isEqualTo(1);
  }

  @Test
  void migratesLegacySiteOwnersWithoutPromotingCompetitionOrganizers() {
    String schema = "global_roles_upgrade_check";
    try {
      Flyway.configure()
          .dataSource(dataSource)
          .schemas(schema)
          .defaultSchema(schema)
          .target("11")
          .load()
          .migrate();
      UUID legacy = UUID.randomUUID();
      UUID ordinary = UUID.randomUUID();
      database.update(
          "INSERT INTO "
              + schema
              + ".app_users (id, display_name, site_owner) VALUES (?, 'Legacy owner', true)",
          legacy);
      database.update(
          "INSERT INTO " + schema + ".app_users (id, display_name) VALUES (?, 'Ordinary account')",
          ordinary);
      database.update(
          "UPDATE " + schema + ".competitions SET organizer_id = ? WHERE all_time", ordinary);
      Flyway.configure()
          .dataSource(dataSource)
          .schemas(schema)
          .defaultSchema(schema)
          .load()
          .migrate();
      assertThat(
              database.queryForList(
                  "SELECT user_id FROM " + schema + ".account_roles WHERE role = 'ADMIN'",
                  UUID.class))
          .containsExactly(legacy);
    } finally {
      database.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    }
  }

  private String revokeSelf(UUID user) {
    try {
      roles.assign(user, user, Role.ADMIN, false);
      return "REVOKED";
    } catch (AuthException error) {
      return error.getMessage();
    }
  }

  private RequestPostProcessor as(UUID id) {
    return authentication(
        UsernamePasswordAuthenticationToken.authenticated(
            new AccountPrincipal(id), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
  }
}
