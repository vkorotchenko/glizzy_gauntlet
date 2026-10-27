package com.glizzygauntlet.api.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.Serializable;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;

@Service
public class SessionAuthentication {
  private final HttpSessionSecurityContextRepository contexts;
  private final SessionAuthenticationStrategy strategy;

  public SessionAuthentication(
      HttpSessionSecurityContextRepository contexts, SessionAuthenticationStrategy strategy) {
    this.contexts = contexts;
    this.strategy = strategy;
  }

  public record AccountPrincipal(UUID id) implements Principal, Serializable {
    @Override
    public String getName() {
      return id.toString();
    }
  }

  public UUID currentId(Authentication authentication) {
    return authentication != null
            && authentication.isAuthenticated()
            && authentication.getPrincipal() instanceof AccountPrincipal principal
        ? principal.id()
        : null;
  }

  public void signIn(UUID id, HttpServletRequest request, HttpServletResponse response) {
    var authentication =
        UsernamePasswordAuthenticationToken.authenticated(
            new AccountPrincipal(id), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    strategy.onAuthentication(authentication, request, response);
    var context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(authentication);
    SecurityContextHolder.setContext(context);
    request.getSession().removeAttribute(GoogleSignInHandler.INTENT_KEY);
    contexts.saveContext(context, request, response);
  }

  public void clear(HttpServletRequest request) {
    SecurityContextHolder.clearContext();
    var session = request.getSession(false);
    if (session != null) session.invalidate();
  }
}
