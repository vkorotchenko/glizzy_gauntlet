package com.glizzygauntlet.api.auth;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.Serializable;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

@Component
public class GoogleSignInHandler
    implements AuthenticationSuccessHandler, AuthenticationFailureHandler {
  static final String INTENT_KEY = "gauntlet.google.intent";

  record Intent(UUID linkUserId, Instant createdAt) implements Serializable {}

  private final AccountService accounts;
  private final SessionAuthentication sessions;

  public GoogleSignInHandler(AccountService accounts, SessionAuthentication sessions) {
    this.accounts = accounts;
    this.sessions = sessions;
  }

  @Override
  public void onAuthenticationSuccess(
      HttpServletRequest request, HttpServletResponse response, Authentication authentication)
      throws IOException {
    Intent intent = popIntent(request);
    try {
      if (!valid(intent)
          || !(authentication.getPrincipal() instanceof OidcUser user)
          || !Boolean.TRUE.equals(user.getEmailVerified())
          || user.getEmail() == null) {
        throw new AuthException(HttpStatus.UNAUTHORIZED, "GOOGLE_SIGN_IN_FAILED");
      }
      var account =
          intent.linkUserId() == null
              ? accounts.findOrCreate("google", user.getSubject(), user.getEmail())
              : accounts.link(intent.linkUserId(), "google", user.getSubject(), user.getEmail());
      sessions.signIn(account.id(), request, response);
      response.sendRedirect("/account");
    } catch (AuthException rejected) {
      fail(intent, request, response);
    }
  }

  @Override
  public void onAuthenticationFailure(
      HttpServletRequest request, HttpServletResponse response, AuthenticationException exception)
      throws IOException, ServletException {
    fail(popIntent(request), request, response);
  }

  private void fail(Intent intent, HttpServletRequest request, HttpServletResponse response)
      throws IOException {
    if (valid(intent) && intent.linkUserId() != null) {
      sessions.signIn(intent.linkUserId(), request, response);
      response.sendRedirect("/account?error=google");
    } else {
      sessions.clear(request);
      response.sendRedirect("/sign-in?error=google");
    }
  }

  private boolean valid(Intent intent) {
    return intent != null
        && !intent.createdAt().isAfter(Instant.now())
        && Duration.between(intent.createdAt(), Instant.now()).compareTo(Duration.ofMinutes(10))
            < 0;
  }

  private Intent popIntent(HttpServletRequest request) {
    var session = request.getSession(false);
    if (session == null) return null;
    Object intent = session.getAttribute(INTENT_KEY);
    session.removeAttribute(INTENT_KEY);
    return intent instanceof Intent value ? value : null;
  }
}
