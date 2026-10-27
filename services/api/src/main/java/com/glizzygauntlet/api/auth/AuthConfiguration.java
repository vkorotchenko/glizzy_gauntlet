package com.glizzygauntlet.api.auth;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(AuthProperties.class)
public class AuthConfiguration {
  @Bean
  CookieSerializer cookieSerializer(
      @Value("${server.servlet.session.cookie.secure:true}") boolean secure) {
    var serializer = new DefaultCookieSerializer();
    serializer.setUseHttpOnlyCookie(true);
    serializer.setUseSecureCookie(secure);
    serializer.setSameSite("Lax");
    serializer.setCookiePath("/");
    return serializer;
  }

  @Bean
  HttpSessionCsrfTokenRepository csrfTokenRepository() {
    return new HttpSessionCsrfTokenRepository();
  }

  @Bean
  HttpSessionSecurityContextRepository securityContextRepository() {
    return new HttpSessionSecurityContextRepository();
  }

  @Bean
  SessionAuthenticationStrategy sessionAuthenticationStrategy(HttpSessionCsrfTokenRepository csrf) {
    return new CompositeSessionAuthenticationStrategy(
        List.of(new ChangeSessionIdAuthenticationStrategy(), new CsrfAuthenticationStrategy(csrf)));
  }

  @Bean
  @ConditionalOnProperty(name = "app.auth.google-enabled", havingValue = "true")
  ClientRegistrationRepository googleClient(AuthProperties settings) {
    return new InMemoryClientRegistrationRepository(
        CommonOAuth2Provider.GOOGLE
            .getBuilder("google")
            .clientId(settings.googleClientId())
            .clientSecret(settings.googleClientSecret())
            .scope("openid", "email")
            .redirectUri(settings.origin() + "/login/oauth2/code/google")
            .issuerUri("https://accounts.google.com")
            .build());
  }
}
