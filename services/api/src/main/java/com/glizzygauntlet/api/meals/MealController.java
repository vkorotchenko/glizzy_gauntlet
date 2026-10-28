package com.glizzygauntlet.api.meals;

import com.glizzygauntlet.api.auth.SessionAuthentication;
import com.glizzygauntlet.api.competitions.CompetitionException;
import com.glizzygauntlet.api.directory.DirectoryException;
import jakarta.validation.Valid;
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
public class MealController {
  private final MealService meals;
  private final SessionAuthentication sessions;

  public MealController(MealService meals, SessionAuthentication sessions) {
    this.meals = meals;
    this.sessions = sessions;
  }

  public record Error(String error, UUID competitionId) {}

  public record Photo(UUID id) {}

  @GetMapping("/meals")
  public MealService.MealPage list(
      Authentication auth,
      @RequestParam(defaultValue = "false") boolean archived,
      @RequestParam(defaultValue = "0") int page) {
    return meals.list(sessions.currentId(auth), archived, page);
  }

  @GetMapping("/meals/{id}")
  public MealService.Meal get(@PathVariable UUID id, Authentication auth) {
    return meals.get(id, sessions.currentId(auth));
  }

  @GetMapping("/meals/{id}/history")
  public MealService.RevisionPage history(
      @PathVariable UUID id, Authentication auth, @RequestParam(defaultValue = "0") int page) {
    return meals.history(id, sessions.currentId(auth), page);
  }

  @PostMapping("/meals")
  @ResponseStatus(HttpStatus.CREATED)
  public MealService.Meal create(@Valid @RequestBody MealService.Save save, Authentication auth) {
    return meals.save(null, sessions.currentId(auth), save);
  }

  @PutMapping("/meals/{id}")
  public MealService.Meal update(
      @PathVariable UUID id, @Valid @RequestBody MealService.Save save, Authentication auth) {
    return meals.save(id, sessions.currentId(auth), save);
  }

  @PostMapping("/meals/{id}/archive")
  public MealService.Meal archive(
      @PathVariable UUID id, @Valid @RequestBody MealService.Change change, Authentication auth) {
    return meals.archive(id, sessions.currentId(auth), change);
  }

  @PostMapping("/meals/{id}/submissions/{competition}/withdraw")
  public MealService.Meal withdraw(
      @PathVariable UUID id,
      @PathVariable UUID competition,
      @Valid @RequestBody MealService.Change change,
      Authentication auth) {
    return meals.withdraw(id, competition, sessions.currentId(auth), change);
  }

  @GetMapping("/competitions/{id}/meals")
  public MealService.EntryPage entries(
      @PathVariable UUID id, Authentication auth, @RequestParam(defaultValue = "0") int page) {
    return meals.entries(id, sessions.currentId(auth), page);
  }

  @GetMapping("/meal-photos")
  public List<UUID> staged(Authentication auth) {
    return meals.stagedPhotos(sessions.currentId(auth));
  }

  @PostMapping(value = "/meal-photos", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  public Photo upload(@RequestParam MultipartFile file, Authentication auth) throws IOException {
    if (file.getSize() > 5 * 1024 * 1024)
      throw new DirectoryException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE");
    return new Photo(meals.upload(sessions.currentId(auth), file.getBytes()));
  }

  @GetMapping(value = "/meal-photos/{id}", produces = MediaType.IMAGE_JPEG_VALUE)
  public ResponseEntity<byte[]> photo(
      @PathVariable UUID id,
      Authentication auth,
      @RequestParam(defaultValue = "false") boolean thumbnail) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .body(meals.photo(id, sessions.currentId(auth), thumbnail));
  }

  @DeleteMapping("/meal-photos/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void discardPhoto(@PathVariable UUID id, Authentication auth) {
    meals.discardPhoto(id, sessions.currentId(auth));
  }

  @ExceptionHandler(MealException.class)
  ResponseEntity<Error> rejected(MealException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage(), error.competitionId()));
  }

  @ExceptionHandler(DirectoryException.class)
  ResponseEntity<Error> image(DirectoryException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage(), null));
  }

  @ExceptionHandler(CompetitionException.class)
  ResponseEntity<Error> competition(CompetitionException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new Error(error.getMessage(), null));
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
        .body(new Error("INVALID_REQUEST", null));
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ResponseEntity<Error> oversized(Exception error) {
    return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
        .cacheControl(CacheControl.noStore())
        .body(new Error("IMAGE_TOO_LARGE", null));
  }
}
