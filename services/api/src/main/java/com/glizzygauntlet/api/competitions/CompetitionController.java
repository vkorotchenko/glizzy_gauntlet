package com.glizzygauntlet.api.competitions;

import com.glizzygauntlet.api.auth.SessionAuthentication;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestController
@RequestMapping("/api/v1")
public class CompetitionController {
  private final CompetitionService competitions;
  private final SessionAuthentication sessions;

  public CompetitionController(CompetitionService competitions, SessionAuthentication sessions) {
    this.competitions = competitions;
    this.sessions = sessions;
  }

  public record Update(
      @NotNull @PositiveOrZero Long version,
      @Valid @NotNull CompetitionService.Settings settings) {}

  public record Version(@NotNull @PositiveOrZero Long version) {}

  public record Token(@NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token) {}

  public record Exclusion(@NotBlank @Size(max = 500) String reason) {}

  public record Error(String error) {}

  @GetMapping("/competitions")
  public CompetitionService.Page list(
      Authentication auth,
      @RequestParam(defaultValue = "public") String scope,
      @RequestParam(defaultValue = "0") int page) {
    return competitions.list(sessions.currentId(auth), scope, page);
  }

  @GetMapping("/competitions/{id}")
  public CompetitionService.Competition get(@PathVariable UUID id, Authentication auth) {
    return competitions.get(id, sessions.currentId(auth));
  }

  @PostMapping("/competitions")
  @ResponseStatus(HttpStatus.CREATED)
  public CompetitionService.Competition create(
      @Valid @RequestBody CompetitionService.Settings body, Authentication auth) {
    return competitions.create(sessions.currentId(auth), body);
  }

  @PutMapping("/competitions/{id}")
  public CompetitionService.Competition update(
      @PathVariable UUID id, @Valid @RequestBody Update body, Authentication auth) {
    return competitions.update(id, sessions.currentId(auth), body.version(), body.settings());
  }

  @PostMapping("/competitions/{id}/publish")
  public CompetitionService.Competition publish(
      @PathVariable UUID id, @Valid @RequestBody Version body, Authentication auth) {
    return competitions.publish(id, sessions.currentId(auth), body.version());
  }

  @PostMapping("/competitions/{id}/join")
  public CompetitionService.Competition join(@PathVariable UUID id, Authentication auth) {
    return competitions.join(id, sessions.currentId(auth));
  }

  @GetMapping("/competitions/{id}/members")
  public CompetitionService.MemberPage members(
      @PathVariable UUID id, Authentication auth, @RequestParam(defaultValue = "0") int page) {
    return competitions.members(id, sessions.currentId(auth), page);
  }

  @PostMapping("/competitions/{id}/members/{user}/exclude")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void exclude(
      @PathVariable UUID id,
      @PathVariable UUID user,
      @Valid @RequestBody Exclusion body,
      Authentication auth) {
    competitions.exclude(id, sessions.currentId(auth), user, body.reason());
  }

  @GetMapping("/competitions/{id}/invitations")
  public List<CompetitionService.Invitation> invitations(
      @PathVariable UUID id, Authentication auth) {
    return competitions.invitations(id, sessions.currentId(auth));
  }

  @PostMapping("/competitions/{id}/invitations")
  @ResponseStatus(HttpStatus.CREATED)
  public CompetitionService.CreatedInvitation invite(@PathVariable UUID id, Authentication auth) {
    return competitions.invite(id, sessions.currentId(auth));
  }

  @DeleteMapping("/competitions/{id}/invitations/{invitation}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void revoke(@PathVariable UUID id, @PathVariable UUID invitation, Authentication auth) {
    competitions.revoke(id, sessions.currentId(auth), invitation);
  }

  @PostMapping("/competition-invitations/inspect")
  public CompetitionService.InvitationPreview inspect(@Valid @RequestBody Token body) {
    return competitions.inspect(body.token());
  }

  @PostMapping("/competition-invitations/join")
  public CompetitionService.Competition joinInvitation(
      @Valid @RequestBody Token body, Authentication auth) {
    return competitions.joinInvitation(sessions.currentId(auth), body.token());
  }

  @ExceptionHandler(CompetitionException.class)
  ResponseEntity<Error> rejected(CompetitionException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage()));
  }

  @ExceptionHandler({
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<Error> invalid(Exception error) {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new Error("INVALID_REQUEST"));
  }
}
