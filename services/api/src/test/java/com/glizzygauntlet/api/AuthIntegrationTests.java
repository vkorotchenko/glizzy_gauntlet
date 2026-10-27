package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.AuthException;
import com.glizzygauntlet.api.auth.MagicLinkService;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import java.net.HttpCookie;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(
    properties = {
      "app.auth.email-enabled=true", "app.auth.mail-from=no-reply@glizzy.test",
      "app.auth.google-enabled=true", "app.auth.google-client-id=test-client",
      "app.auth.google-client-secret=test-only-secret", "app.auth.public-base-url=http://localhost",
      "server.servlet.session.cookie.secure=false"
    })
@AutoConfigureMockMvc
class AuthIntegrationTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate database;
  @Autowired AccountService accounts;
  @Autowired MagicLinkService links;
  @MockitoBean JavaMailSender mail;

  record Browser(Cookie cookie, String csrf) {}

  record SignedIn(Browser browser, String token, UUID id) {}

  @BeforeEach
  void resetData() {
    database.execute(
        "TRUNCATE magic_link_tokens, external_identities, app_users, spring_session CASCADE");
    reset(mail);
  }

  @Test
  void rejectsLoginCsrfAndDoesNotCreateAnAccountOnRequestOrInspection() throws Exception {
    Browser browser = browser(null);
    mvc.perform(
            post("/api/v1/auth/magic-links")
                .cookie(browser.cookie())
                .contentType("application/json")
                .content("{\"email\":\"diner@example.test\"}"))
        .andExpect(status().isForbidden());
    verifyNoInteractions(mail);
    String token = requestLink(browser, "Diner@example.test");
    mvc.perform(jsonPost(browser, "/api/v1/auth/magic-links/inspect", tokenBody(token)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.email").value("diner@example.test"));
    mvc.perform(
            get("/api/v1/auth/magic-links/confirm").param("token", token).cookie(browser.cookie()))
        .andExpect(status().isUnauthorized());
    assertThat(database.queryForObject("SELECT count(*) FROM app_users", Long.class)).isZero();
    assertThat(
            database.queryForObject(
                "SELECT count(*) FROM magic_link_tokens WHERE consumed_at IS NOT NULL", Long.class))
        .isZero();
  }

  @Test
  void signsInWithAJdbcSessionRotatesItsIdEditsOnlyTheDisplayNameAndSignsOut() throws Exception {
    Browser before = browser(null);
    String token = requestLink(before, "profile@example.test");
    MvcResult confirmed =
        mvc.perform(jsonPost(before, "/api/v1/auth/magic-links/confirm", tokenBody(token)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.siteOwner").value(false))
            .andReturn();
    Cookie signedCookie = responseCookie(confirmed, before.cookie());
    assertThat(signedCookie.getValue()).isNotEqualTo(before.cookie().getValue());
    assertThat(confirmed.getResponse().getHeaders("Set-Cookie").toString())
        .contains("HttpOnly")
        .contains("SameSite=Lax");
    Browser signed = browser(signedCookie);
    mvc.perform(get("/api/v1/me").cookie(signed.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.providers[0]").value("email"));
    mvc.perform(
            put("/api/v1/me")
                .cookie(signed.cookie())
                .header("X-CSRF-TOKEN", signed.csrf())
                .contentType("application/json")
                .content("{\"displayName\":\"  Pickle captain  \"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.displayName").value("Pickle captain"));
    mvc.perform(
            put("/api/v1/me")
                .cookie(signed.cookie())
                .header("X-CSRF-TOKEN", signed.csrf())
                .contentType("application/json")
                .content("{\"displayName\":\"Intruder\",\"siteOwner\":true}"))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/me").cookie(signed.cookie()))
        .andExpect(jsonPath("$.displayName").value("Pickle captain"))
        .andExpect(jsonPath("$.siteOwner").value(false));
    mvc.perform(jsonPost(signed, "/api/v1/auth/logout", "{}")).andExpect(status().isNoContent());
    mvc.perform(get("/api/v1/me").cookie(signed.cookie())).andExpect(status().isUnauthorized());
    Browser fresh = browser(null);
    mvc.perform(jsonPost(fresh, "/api/v1/auth/magic-links/confirm", tokenBody(token)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("INVALID_LINK"));
  }

  @Test
  void rejectsExpiredAndUnknownLinksWithoutLeakingDetails() throws Exception {
    Browser browser = browser(null);
    String token = requestLink(browser, "expired@example.test");
    database.update(
        "UPDATE magic_link_tokens SET expires_at = clock_timestamp() - interval '1 second'");
    for (String value : List.of(token, "A".repeat(43))) {
      mvc.perform(jsonPost(browser, "/api/v1/auth/magic-links/confirm", tokenBody(value)))
          .andExpect(status().isBadRequest())
          .andExpect(content().json("{\"error\":\"INVALID_LINK\"}"));
    }
    assertThat(database.queryForObject("SELECT count(*) FROM app_users", Long.class)).isZero();
  }

  @Test
  void limitsResendsWithoutDisclosingDeliveryAndNeverStoresTheBearerToken() throws Exception {
    Browser browser = browser(null);
    String token = requestLink(browser, "limited@example.test");
    mvc.perform(
            jsonPost(browser, "/api/v1/auth/magic-links", "{\"email\":\"limited@example.test\"}"))
        .andExpect(status().isAccepted());
    verify(mail, times(1)).send(any(SimpleMailMessage.class));
    String stored =
        database.queryForObject("SELECT token_hash FROM magic_link_tokens", String.class);
    assertThat(stored).hasSize(64).isNotEqualTo(token).doesNotContain(token);
    assertThat(database.queryForObject("SELECT count(*) FROM app_users", Long.class)).isZero();
  }

  @Test
  void enforcesTheGlobalMailBudgetWithoutSendingMoreMessages() throws Exception {
    database.execute(
        """
        INSERT INTO magic_link_tokens (token_hash, email, expires_at)
        SELECT lpad(value::text, 64, '0'), 'budget@example.test', clock_timestamp() + interval '15 minutes'
        FROM generate_series(1, 100) AS value
        """);
    Browser browser = browser(null);
    mvc.perform(jsonPost(browser, "/api/v1/auth/magic-links", "{\"email\":\"new@example.test\"}"))
        .andExpect(status().isAccepted());
    verifyNoInteractions(mail);
  }

  @Test
  void neverMergesGoogleAndEmailAccountsJustBecauseTheEmailsMatch() {
    var email = accounts.findOrCreate("email", "same@example.test", "same@example.test");
    var google = accounts.findOrCreate("google", "google-subject", "same@example.test");
    assertThat(google.id()).isNotEqualTo(email.id());
    assertThatThrownBy(
            () -> accounts.link(email.id(), "google", "google-subject", "same@example.test"))
        .isInstanceOf(AuthException.class)
        .hasMessage("IDENTITY_IN_USE");
    assertThat(accounts.profile(email.id()).providers()).containsExactly("email");
    var unlinkedGoogle = accounts.findOrCreate("google", "another-subject", "other@example.test");
    var linked =
        accounts.link(unlinkedGoogle.id(), "email", "linked@example.test", "linked@example.test");
    assertThat(linked.providers()).containsExactly("email", "google");
  }

  @Test
  void requiresTheOriginalAccountToConfirmALinkingEmail() throws Exception {
    SignedIn alice = signIn("alice@example.test");
    database.update(
        "UPDATE magic_link_tokens SET created_at = clock_timestamp() - interval '2 minutes'");
    String linking = requestLink(alice.browser(), "alice@example.test");
    SignedIn bob = signIn("bob@example.test");
    mvc.perform(jsonPost(bob.browser(), "/api/v1/auth/magic-links/confirm", tokenBody(linking)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error").value("LINK_REQUIRES_ORIGINAL_ACCOUNT"));
    mvc.perform(jsonPost(alice.browser(), "/api/v1/auth/magic-links/confirm", tokenBody(linking)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(alice.id().toString()));
  }

  @Test
  void consumesATokenOnlyOnceWhenConfirmationsRace() throws Exception {
    String token = requestLink(browser(null), "race@example.test");
    var first = CompletableFuture.supplyAsync(() -> consumeOutcome(token));
    var second = CompletableFuture.supplyAsync(() -> consumeOutcome(token));
    assertThat(List.of(first.join(), second.join()))
        .containsExactlyInAnyOrder("SIGNED_IN", "INVALID_LINK");
    assertThat(database.queryForObject("SELECT count(*) FROM app_users", Long.class)).isEqualTo(1);
  }

  @Test
  void bindsGoogleStartToCsrfAndUsesTheConfiguredOriginInsteadOfTheHostHeader() throws Exception {
    Browser browser = browser(null);
    mvc.perform(jsonPost(browser, "/api/v1/auth/google", "{\"link\":false}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.authorizationUrl").value("/oauth2/authorization/google"));
    mvc.perform(
            get("/oauth2/authorization/google")
                .cookie(browser.cookie())
                .header("Host", "untrusted.invalid"))
        .andExpect(status().isFound())
        .andExpect(
            header()
                .string(
                    "Location",
                    org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("https://accounts.google.com/"),
                        org.hamcrest.Matchers.containsString(
                            "redirect_uri=http://localhost/login/oauth2/code/google"),
                        org.hamcrest.Matchers.containsString("state="),
                        org.hamcrest.Matchers.containsString("nonce="))));
  }

  private String consumeOutcome(String token) {
    try {
      links.consume(token, null);
      return "SIGNED_IN";
    } catch (AuthException rejected) {
      assertThat(rejected.status()).isEqualTo(HttpStatus.BAD_REQUEST);
      return rejected.getMessage();
    }
  }

  private SignedIn signIn(String email) throws Exception {
    Browser anonymous = browser(null);
    String token = requestLink(anonymous, email);
    MvcResult signed =
        mvc.perform(jsonPost(anonymous, "/api/v1/auth/magic-links/confirm", tokenBody(token)))
            .andExpect(status().isOk())
            .andReturn();
    String id = JsonPath.read(signed.getResponse().getContentAsString(), "$.id");
    return new SignedIn(
        browser(responseCookie(signed, anonymous.cookie())), token, UUID.fromString(id));
  }

  private String requestLink(Browser browser, String email) throws Exception {
    mvc.perform(jsonPost(browser, "/api/v1/auth/magic-links", "{\"email\":\"" + email + "\"}"))
        .andExpect(status().isAccepted());
    var messages = ArgumentCaptor.forClass(SimpleMailMessage.class);
    verify(mail, atLeastOnce()).send(messages.capture());
    var match = Pattern.compile("token=([A-Za-z0-9_-]{43})").matcher(messages.getValue().getText());
    assertThat(match.find()).isTrue();
    return match.group(1);
  }

  private Browser browser(Cookie previous) throws Exception {
    var request = get("/api/v1/auth/session");
    if (previous != null) request.cookie(previous);
    MvcResult result = mvc.perform(request).andExpect(status().isOk()).andReturn();
    String csrf = JsonPath.read(result.getResponse().getContentAsString(), "$.csrfToken");
    return new Browser(responseCookie(result, previous), csrf);
  }

  private Cookie responseCookie(MvcResult result, Cookie previous) {
    return result.getResponse().getHeaders("Set-Cookie").stream()
        .flatMap(header -> HttpCookie.parse(header).stream())
        .filter(cookie -> cookie.getName().equals("SESSION"))
        .findFirst()
        .map(cookie -> new Cookie("SESSION", cookie.getValue()))
        .orElse(previous);
  }

  private MockHttpServletRequestBuilder jsonPost(Browser browser, String path, String body) {
    return post(path)
        .cookie(browser.cookie())
        .header("X-CSRF-TOKEN", browser.csrf())
        .contentType("application/json")
        .content(body);
  }

  private String tokenBody(String token) {
    return "{\"token\":\"" + token + "\"}";
  }
}
