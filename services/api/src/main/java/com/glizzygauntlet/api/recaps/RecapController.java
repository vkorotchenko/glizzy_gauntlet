package com.glizzygauntlet.api.recaps;

import com.glizzygauntlet.api.auth.SessionAuthentication;
import com.glizzygauntlet.api.competitions.CompetitionException;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestController
@RequestMapping("/api/v1/competitions/{id}")
public class RecapController {
  private final RecapService recaps;
  private final SessionAuthentication sessions;

  public RecapController(RecapService recaps, SessionAuthentication sessions) {
    this.recaps = recaps;
    this.sessions = sessions;
  }

  @GetMapping("/recap")
  public ResponseEntity<RecapService.Recap> recap(
      @PathVariable UUID id,
      Authentication auth,
      @RequestParam(required = false) Long version,
      @RequestParam(defaultValue = "0") int page) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(recaps.get(id, sessions.currentId(auth), version, page));
  }

  @GetMapping("/recap/history")
  public ResponseEntity<RecapService.History> history(
      @PathVariable UUID id, Authentication auth, @RequestParam(defaultValue = "0") int page) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(recaps.history(id, sessions.currentId(auth), page));
  }

  @GetMapping("/recap/highlights")
  public ResponseEntity<RecapService.Highlights> highlights(
      @PathVariable UUID id, Authentication auth, @RequestParam(required = false) Long version) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(recaps.highlights(id, sessions.currentId(auth), version));
  }

  @PostMapping("/entries/{entry}/corrections")
  public RecapService.Receipt correct(
      @PathVariable UUID id,
      @PathVariable UUID entry,
      Authentication auth,
      @Valid @RequestBody RecapService.Correction correction) {
    return recaps.correct(id, entry, sessions.currentId(auth), correction);
  }

  @GetMapping("/corrections")
  public ResponseEntity<RecapService.AuditPage> audit(
      @PathVariable UUID id, Authentication auth, @RequestParam(defaultValue = "0") int page) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(recaps.audit(id, sessions.currentId(auth), page));
  }

  public record Error(String error) {}

  @ExceptionHandler(CompetitionException.class)
  ResponseEntity<Error> rejected(CompetitionException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage()));
  }

  @ExceptionHandler({
    MethodArgumentTypeMismatchException.class,
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class
  })
  ResponseEntity<Error> invalid(Exception error) {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new Error("INVALID_REQUEST"));
  }
}
