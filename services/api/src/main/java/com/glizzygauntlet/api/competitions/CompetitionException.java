package com.glizzygauntlet.api.competitions;

import org.springframework.http.HttpStatus;

public class CompetitionException extends RuntimeException {
  private final HttpStatus status;

  public CompetitionException(HttpStatus status, String code) {
    super(code);
    this.status = status;
  }

  public HttpStatus status() {
    return status;
  }
}
