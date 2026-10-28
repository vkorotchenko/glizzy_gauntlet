package com.glizzygauntlet.api.config;

import com.glizzygauntlet.api.auth.GoogleSignInHandler;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

@Configuration
class SecurityConfiguration {
  @Bean
  SecurityFilterChain securityFilterChain(
      HttpSecurity http,
      HttpSessionSecurityContextRepository contexts,
      HttpSessionCsrfTokenRepository csrf,
      SessionAuthenticationStrategy strategy,
      ObjectProvider<ClientRegistrationRepository> clients,
      GoogleSignInHandler google)
      throws Exception {
    http.authorizeHttpRequests(
            authorize ->
                authorize
                    .dispatcherTypeMatchers(DispatcherType.ERROR)
                    .permitAll()
                    .requestMatchers(
                        HttpMethod.GET,
                        "/api/v1/status",
                        "/api/v1/auth/session",
                        "/api/v1/competitions",
                        "/api/v1/competitions/*",
                        "/api/v1/competitions/*/featured-venues",
                        "/api/v1/venues",
                        "/api/v1/venues/*",
                        "/api/v1/directory/photos/*",
                        "/actuator/health",
                        "/actuator/health/**",
                        "/oauth2/**",
                        "/login/oauth2/**")
                    .permitAll()
                    .requestMatchers(
                        HttpMethod.POST,
                        "/api/v1/auth/magic-links",
                        "/api/v1/auth/magic-links/inspect",
                        "/api/v1/auth/magic-links/confirm",
                        "/api/v1/auth/google",
                        "/api/v1/competition-invitations/inspect")
                    .permitAll()
                    .requestMatchers(
                        "/api/v1/me",
                        "/api/v1/competitions/**",
                        "/api/v1/competition-invitations/**")
                    .authenticated()
                    .requestMatchers("/api/v1/venues/**", "/api/v1/directory/**")
                    .authenticated()
                    .anyRequest()
                    .denyAll())
        .securityContext(context -> context.securityContextRepository(contexts))
        .sessionManagement(session -> session.sessionAuthenticationStrategy(strategy))
        .csrf(config -> config.csrfTokenRepository(csrf))
        .exceptionHandling(
            errors ->
                errors.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
        .formLogin(AbstractHttpConfigurer::disable)
        .httpBasic(AbstractHttpConfigurer::disable)
        .requestCache(AbstractHttpConfigurer::disable)
        .logout(
            logout ->
                logout
                    .logoutUrl("/api/v1/auth/logout")
                    .logoutSuccessHandler(
                        (request, response, authentication) -> response.setStatus(204)));
    if (clients.getIfAvailable() != null) {
      http.oauth2Login(oauth -> oauth.successHandler(google).failureHandler(google));
    }
    return http.build();
  }

  @Bean
  UserDetailsService passwordAccountsDisabled() {
    // Suppress Spring's generated development account; this app uses OIDC and magic links.
    return username -> {
      throw new UsernameNotFoundException("Password sign-in is disabled");
    };
  }
}
