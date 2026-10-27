package com.glizzygauntlet.api.auth;

import java.net.URI;
import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("app.auth")
public record AuthProperties(
    URI publicBaseUrl,
    boolean emailEnabled,
    String mailFrom,
    boolean googleEnabled,
    String googleClientId,
    String googleClientSecret) {
  public AuthProperties {
    if (publicBaseUrl == null
        || publicBaseUrl.getHost() == null
        || publicBaseUrl.getUserInfo() != null
        || publicBaseUrl.getQuery() != null
        || publicBaseUrl.getFragment() != null
        || !Set.of("", "/").contains(publicBaseUrl.getPath())
        || !Set.of("http", "https").contains(publicBaseUrl.getScheme())) {
      throw new IllegalArgumentException("PUBLIC_BASE_URL must be an HTTP(S) origin");
    }
    if (!"https".equals(publicBaseUrl.getScheme())
        && !Set.of("localhost", "127.0.0.1", "[::1]").contains(publicBaseUrl.getHost())) {
      throw new IllegalArgumentException(
          "PUBLIC_BASE_URL requires HTTPS outside loopback development");
    }
    if (emailEnabled && (mailFrom == null || mailFrom.isBlank())) {
      throw new IllegalArgumentException("MAIL_FROM is required when email sign-in is enabled");
    }
    if (googleEnabled
        && (googleClientId == null
            || googleClientId.isBlank()
            || googleClientSecret == null
            || googleClientSecret.isBlank())) {
      throw new IllegalArgumentException(
          "Google sign-in requires client ID and secret configuration");
    }
  }

  public String origin() {
    return publicBaseUrl.toString().replaceAll("/+$", "");
  }

  @Override
  public String toString() {
    return "AuthProperties[configuration redacted]";
  }
}
