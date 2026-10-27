package com.glizzygauntlet.api.auth;

import org.springframework.http.HttpStatus;

public class AuthException extends RuntimeException {
  private final HttpStatus status;

  public AuthException(HttpStatus status, String code) {
    super(code);
    this.status = status;
  }

  public HttpStatus status() {
    return status;
  }
}
