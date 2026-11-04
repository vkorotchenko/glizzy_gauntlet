package com.glizzygauntlet.api.competitions;

import com.glizzygauntlet.api.auth.SessionAuthentication;
import com.glizzygauntlet.api.directory.DirectoryException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestController
@RequestMapping("/api/v1")
public class CompetitionController {
  private final CompetitionService competitions;
  private final SessionAuthentication sessions;
  private final CompetitionEmailService emails;
  private final CompetitionEmailDelivery delivery;

  public CompetitionController(
      CompetitionService competitions,
      SessionAuthentication sessions,
      CompetitionEmailService emails,
      CompetitionEmailDelivery delivery) {
    this.competitions = competitions;
    this.sessions = sessions;
    this.emails = emails;
    this.delivery = delivery;
  }

  public record Creation(
      @NotBlank @Size(max = 120) String name,
      @NotNull @Size(max = 5000) String rules,
      @NotNull CompetitionService.Visibility visibility,
      @NotBlank @Size(max = 80) String timeZone,
      @NotNull Instant startsAt,
      @NotNull Instant endsAt,
      @NotNull Boolean allowSharedMeals,
      CompetitionService.TrackingMode trackingMode,
      @Size(max = 20) List<@NotBlank @Email @Size(max = 254) String> invitationEmails) {
    public Creation {
      if (invitationEmails == null) invitationEmails = List.of();
    }

    public CompetitionService.Settings settings() {
      return new CompetitionService.Settings(
          name, rules, visibility, timeZone, startsAt, endsAt, allowSharedMeals, trackingMode);
    }
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

  @PostMapping(value = "/competitions", consumes = MediaType.APPLICATION_JSON_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  public CompetitionService.Competition create(
      @Valid @RequestBody Creation body, Authentication auth) {
    return emails.create(sessions.currentId(auth), body.settings(), body.invitationEmails());
  }

  @PostMapping(value = "/competitions", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  public CompetitionService.Competition createWithCover(
      @Valid @RequestPart("competition") Creation body,
      @RequestPart MultipartFile file,
      Authentication auth)
      throws IOException {
    return emails.create(
        sessions.currentId(auth), body.settings(), body.invitationEmails(), imageBytes(file));
  }

  @PutMapping("/competitions/{id}")
  public CompetitionService.Competition update(
      @PathVariable UUID id, @Valid @RequestBody Update body, Authentication auth) {
    return competitions.update(id, sessions.currentId(auth), body.version(), body.settings());
  }

  @PutMapping(value = "/competitions/{id}/cover", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public CompetitionService.Competition uploadCover(
      @PathVariable UUID id,
      @RequestParam @PositiveOrZero long version,
      @RequestParam MultipartFile file,
      Authentication auth)
      throws IOException {
    return competitions.uploadCover(id, sessions.currentId(auth), version, imageBytes(file));
  }

  @DeleteMapping("/competitions/{id}/cover")
  public CompetitionService.Competition removeCover(
      @PathVariable UUID id, @RequestParam @PositiveOrZero long version, Authentication auth) {
    return competitions.removeCover(id, sessions.currentId(auth), version);
  }

  @GetMapping(value = "/competitions/{id}/cover/{photo}", produces = MediaType.IMAGE_JPEG_VALUE)
  public ResponseEntity<byte[]> cover(
      @PathVariable UUID id,
      @PathVariable UUID photo,
      @RequestParam(defaultValue = "false") boolean thumbnail,
      Authentication auth) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .body(competitions.cover(id, photo, sessions.currentId(auth), thumbnail));
  }

  private byte[] imageBytes(MultipartFile file) throws IOException {
    if (file.getSize() > 5 * 1024 * 1024)
      throw new DirectoryException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE");
    return file.getBytes();
  }

  @PostMapping("/competitions/{id}/publish")
  public CompetitionService.Competition publish(
      @PathVariable UUID id, @Valid @RequestBody Version body, Authentication auth) {
    UUID user = sessions.currentId(auth);
    var competition = competitions.publish(id, user, body.version());
    if (List.of(CompetitionService.Phase.SCHEDULED, CompetitionService.Phase.ACTIVE)
        .contains(competition.phase())) {
      if (emails.prepare(id, user).stream().anyMatch(row -> !row.status().equals("SENT")))
        delivery.queue(id, user);
    }
    return competition;
  }

  @GetMapping("/competitions/{id}/invitation-emails")
  public ResponseEntity<List<CompetitionEmailService.InvitationEmail>> invitationEmails(
      @PathVariable UUID id, Authentication auth) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(emails.list(id, sessions.currentId(auth)));
  }

  @PostMapping("/competitions/{id}/invitation-emails")
  public ResponseEntity<List<CompetitionEmailService.InvitationEmail>> sendInvitationEmails(
      @PathVariable UUID id, Authentication auth) {
    UUID user = sessions.currentId(auth);
    var queued = emails.prepare(id, user);
    if (queued.stream().anyMatch(row -> !row.status().equals("SENT"))) delivery.queue(id, user);
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(queued);
  }

  @PostMapping("/competitions/{id}/join")
  public CompetitionService.Competition join(@PathVariable UUID id, Authentication auth) {
    return competitions.join(id, sessions.currentId(auth));
  }

  @PostMapping("/competitions/{id}/leave")
  public CompetitionService.Competition leave(@PathVariable UUID id, Authentication auth) {
    return competitions.leave(id, sessions.currentId(auth));
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

  @ExceptionHandler(DirectoryException.class)
  ResponseEntity<Error> image(DirectoryException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage()));
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ResponseEntity<Error> oversized(Exception error) {
    return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
        .cacheControl(CacheControl.noStore())
        .body(new Error("IMAGE_TOO_LARGE"));
  }

  @ExceptionHandler({
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class,
    MissingServletRequestPartException.class,
    org.springframework.web.bind.MissingServletRequestParameterException.class,
    org.springframework.web.method.annotation.HandlerMethodValidationException.class
  })
  ResponseEntity<Error> invalid(Exception error) {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new Error("INVALID_REQUEST"));
  }
}
