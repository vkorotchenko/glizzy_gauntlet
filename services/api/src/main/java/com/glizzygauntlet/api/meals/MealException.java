package com.glizzygauntlet.api.meals;

import java.util.UUID;
import org.springframework.http.HttpStatus;

public class MealException extends RuntimeException {
  private final HttpStatus status;
  private final UUID competitionId;

  public MealException(HttpStatus status, String code, UUID competitionId) {
    super(code);
    this.status = status;
    this.competitionId = competitionId;
  }

  public HttpStatus status() {
    return status;
  }

  public UUID competitionId() {
    return competitionId;
  }
}
