package com.glizzygauntlet.api.directory;

import com.glizzygauntlet.api.auth.SessionAuthentication;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
public class DirectoryController {
  private final DirectoryService directory;
  private final SessionAuthentication sessions;

  public DirectoryController(DirectoryService directory, SessionAuthentication sessions) {
    this.directory = directory;
    this.sessions = sessions;
  }

  public record Review(@NotNull Boolean approve, @NotBlank @Size(max = 500) String reason) {}

  public record Visibility(@NotNull Boolean hidden, @NotBlank @Size(max = 500) String reason) {}

  public record Error(String error) {}

  @GetMapping("/venues")
  public DirectoryService.VenuePage list(
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(required = false) Double south,
      @RequestParam(required = false) Double north,
      @RequestParam(required = false) Double west,
      @RequestParam(required = false) Double east) {
    return directory.list(page, south, north, west, east);
  }

  @GetMapping("/venues/{id}")
  public DirectoryService.Venue get(@PathVariable UUID id) {
    return directory.get(id);
  }

  @GetMapping("/directory/contributions")
  public DirectoryService.ContributionPage contributions(
      Authentication auth,
      @RequestParam(defaultValue = "mine") String scope,
      @RequestParam(defaultValue = "0") int page) {
    return directory.contributions(sessions.currentId(auth), scope, page);
  }

  @GetMapping("/directory/contributions/{id}")
  public DirectoryService.Contribution contribution(@PathVariable UUID id, Authentication auth) {
    return directory.contribution(id, sessions.currentId(auth));
  }

  @PostMapping("/directory/contributions")
  @ResponseStatus(HttpStatus.CREATED)
  public DirectoryService.Contribution create(
      @Valid @RequestBody DirectoryService.Input input, Authentication auth) {
    return directory.create(sessions.currentId(auth), input);
  }

  @PostMapping("/directory/contributions/{id}/submit")
  public DirectoryService.Contribution submit(@PathVariable UUID id, Authentication auth) {
    return directory.submit(id, sessions.currentId(auth));
  }

  @DeleteMapping("/directory/contributions/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void discard(@PathVariable UUID id, Authentication auth) {
    directory.discard(id, sessions.currentId(auth));
  }

  @PostMapping(
      value = "/directory/contributions/{id}/photos",
      consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  public DirectoryService.Photo upload(
      @PathVariable UUID id,
      Authentication auth,
      @RequestParam(required = false) UUID menuItemId,
      @RequestParam MultipartFile file)
      throws IOException {
    if (file.getSize() > 5 * 1024 * 1024)
      throw new DirectoryException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE");
    return directory.upload(id, sessions.currentId(auth), menuItemId, file.getBytes());
  }

  @PostMapping("/directory/contributions/{id}/review")
  public DirectoryService.Contribution review(
      @PathVariable UUID id, Authentication auth, @Valid @RequestBody Review review) {
    return directory.review(id, sessions.currentId(auth), review.approve(), review.reason());
  }

  @PutMapping("/venues/{id}/visibility")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void hide(
      @PathVariable UUID id, Authentication auth, @Valid @RequestBody Visibility visibility) {
    directory.hide(id, sessions.currentId(auth), visibility.hidden(), visibility.reason());
  }

  @GetMapping(value = "/directory/photos/{id}", produces = MediaType.IMAGE_JPEG_VALUE)
  public ResponseEntity<byte[]> photo(
      @PathVariable UUID id,
      Authentication auth,
      @RequestParam(defaultValue = "false") boolean thumbnail) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .body(directory.photo(id, sessions.currentId(auth), thumbnail));
  }

  @GetMapping("/competitions/{id}/featured-venues")
  public List<DirectoryService.Venue> featured(@PathVariable UUID id, Authentication auth) {
    return directory.featured(id, sessions.currentId(auth));
  }

  @PutMapping("/competitions/{id}/featured-venues/{venue}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void feature(@PathVariable UUID id, @PathVariable UUID venue, Authentication auth) {
    directory.feature(id, sessions.currentId(auth), venue, true);
  }

  @DeleteMapping("/competitions/{id}/featured-venues/{venue}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void unfeature(@PathVariable UUID id, @PathVariable UUID venue, Authentication auth) {
    directory.feature(id, sessions.currentId(auth), venue, false);
  }

  @ExceptionHandler(DirectoryException.class)
  ResponseEntity<Error> rejected(DirectoryException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage()));
  }

  @ExceptionHandler(com.glizzygauntlet.api.competitions.CompetitionException.class)
  ResponseEntity<Error> competitionRejected(
      com.glizzygauntlet.api.competitions.CompetitionException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage()));
  }

  @ExceptionHandler({
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class,
    org.springframework.web.bind.MissingServletRequestParameterException.class
  })
  ResponseEntity<Error> invalid(Exception error) {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new Error("INVALID_REQUEST"));
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ResponseEntity<Error> oversized(Exception error) {
    return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
        .cacheControl(CacheControl.noStore())
        .body(new Error("IMAGE_TOO_LARGE"));
  }
}
