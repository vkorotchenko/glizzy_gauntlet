package com.glizzygauntlet.api.directory;

import org.springframework.http.HttpStatus;

public class DirectoryException extends RuntimeException {
  private final HttpStatus status;

  public DirectoryException(HttpStatus status, String code) {
    super(code);
    this.status = status;
  }

  public HttpStatus status() {
    return status;
  }
}
