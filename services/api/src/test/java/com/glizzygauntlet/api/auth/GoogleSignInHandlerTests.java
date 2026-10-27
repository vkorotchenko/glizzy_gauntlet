package com.glizzygauntlet.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;

class GoogleSignInHandlerTests {
  @Test
  void linksOnlyToTheSessionIntentAndRestoresTheOriginalAccountOnConflict() throws Exception {
    var accounts = mock(AccountService.class);
    var sessions = mock(SessionAuthentication.class);
    var handler = new GoogleSignInHandler(accounts, sessions);
    var request = new MockHttpServletRequest();
    var response = new MockHttpServletResponse();
    UUID id = UUID.randomUUID();
    request
        .getSession()
        .setAttribute(
            GoogleSignInHandler.INTENT_KEY, new GoogleSignInHandler.Intent(id, Instant.now()));
    when(accounts.link(id, "google", "subject", "diner@example.test"))
        .thenThrow(new AuthException(HttpStatus.CONFLICT, "IDENTITY_IN_USE"));
    handler.onAuthenticationSuccess(request, response, identity(true));
    verify(accounts).link(id, "google", "subject", "diner@example.test");
    verify(accounts, never()).findOrCreate(anyString(), anyString(), anyString());
    verify(sessions).signIn(id, request, response);
    assertThat(response.getRedirectedUrl()).isEqualTo("/account?error=google");
  }

  @Test
  void acceptsOnlyVerifiedGoogleEmailAndConvertsTheIdentityToALocalSession() throws Exception {
    var accounts = mock(AccountService.class);
    var sessions = mock(SessionAuthentication.class);
    var handler = new GoogleSignInHandler(accounts, sessions);
    var request = new MockHttpServletRequest();
    var response = new MockHttpServletResponse();
    UUID id = UUID.randomUUID();
    request
        .getSession()
        .setAttribute(
            GoogleSignInHandler.INTENT_KEY, new GoogleSignInHandler.Intent(null, Instant.now()));
    when(accounts.findOrCreate("google", "subject", "diner@example.test"))
        .thenReturn(new AccountService.Profile(id, "Diner", false, List.of("google")));

    handler.onAuthenticationSuccess(request, response, identity(true));

    verify(sessions).signIn(id, request, response);
    assertThat(response.getRedirectedUrl()).isEqualTo("/account");
    assertThat(request.getSession().getAttribute(GoogleSignInHandler.INTENT_KEY)).isNull();
  }

  @Test
  void rejectsUnverifiedEmailAndMissingOrExpiredIntentWithoutCreatingAnAccount() throws Exception {
    for (int scenario = 0; scenario < 3; scenario++) {
      var accounts = mock(AccountService.class);
      var sessions = mock(SessionAuthentication.class);
      var handler = new GoogleSignInHandler(accounts, sessions);
      var request = new MockHttpServletRequest();
      var response = new MockHttpServletResponse();
      if (scenario != 1) {
        request
            .getSession()
            .setAttribute(
                GoogleSignInHandler.INTENT_KEY,
                new GoogleSignInHandler.Intent(
                    null, Instant.now().minusSeconds(scenario == 2 ? 900 : 0)));
      }
      handler.onAuthenticationSuccess(request, response, identity(scenario != 0));
      verifyNoInteractions(accounts);
      verify(sessions).clear(request);
      assertThat(response.getRedirectedUrl()).isEqualTo("/sign-in?error=google");
    }
  }

  private OAuth2AuthenticationToken identity(boolean verified) {
    var now = Instant.now();
    var token =
        new OidcIdToken(
            "test-only-id-token",
            now,
            now.plusSeconds(60),
            Map.of("sub", "subject", "email", "diner@example.test", "email_verified", verified));
    var user = new DefaultOidcUser(List.of(), token);
    return new OAuth2AuthenticationToken(user, List.of(), "google");
  }
}
