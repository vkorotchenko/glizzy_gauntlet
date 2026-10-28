package com.glizzygauntlet.api.progress;

import com.glizzygauntlet.api.auth.SessionAuthentication;
import com.glizzygauntlet.api.competitions.CompetitionException;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestController
@RequestMapping("/api/v1/competitions/{id}")
public class ProgressController {
  private final ProgressService progress;
  private final SessionAuthentication sessions;

  public ProgressController(ProgressService progress, SessionAuthentication sessions) {
    this.progress = progress;
    this.sessions = sessions;
  }

  @GetMapping("/standings")
  public ResponseEntity<ProgressService.Standings> standings(
      @PathVariable UUID id, Authentication auth, @RequestParam(defaultValue = "0") int page) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(progress.standings(id, sessions.currentId(auth), page));
  }

  @GetMapping("/progress")
  public ResponseEntity<ProgressService.Progress> personal(
      @PathVariable UUID id,
      Authentication auth,
      @RequestParam(defaultValue = "0") int dayPage,
      @RequestParam(defaultValue = "0") int placePage) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(progress.personal(id, sessions.currentId(auth), dayPage, placePage));
  }

  public record Error(String error) {}

  @ExceptionHandler(CompetitionException.class)
  ResponseEntity<Error> rejected(CompetitionException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage()));
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  ResponseEntity<Error> invalid(Exception error) {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new Error("INVALID_REQUEST"));
  }
}
