package com.glizzygauntlet.api.auth;

import com.glizzygauntlet.api.directory.DirectoryException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestController
@RequestMapping("/api/v1")
public class AuthController {
  private final AuthProperties settings;
  private final SessionAuthentication sessions;
  private final AccountService accounts;
  private final MagicLinkService links;

  public AuthController(
      AuthProperties settings,
      SessionAuthentication sessions,
      AccountService accounts,
      MagicLinkService links) {
    this.settings = settings;
    this.sessions = sessions;
    this.accounts = accounts;
    this.links = links;
  }

  public record SessionInfo(
      AccountService.Profile user,
      String csrfToken,
      String csrfHeader,
      boolean emailEnabled,
      boolean googleEnabled) {}

  public record EmailRequest(@NotBlank @Email @Size(max = 254) String email) {}

  public record TokenRequest(@NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token) {}

  public record GoogleRequest(@NotNull Boolean link) {}

  public record ProfileRequest(@NotBlank @Size(max = 80) String displayName) {}

  public record GoogleResponse(String authorizationUrl) {}

  public record ApiError(String error) {}

  @GetMapping("/auth/session")
  public ResponseEntity<SessionInfo> session(Authentication authentication, CsrfToken csrf) {
    UUID id = sessions.currentId(authentication);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            new SessionInfo(
                id == null ? null : accounts.profile(id),
                csrf.getToken(),
                csrf.getHeaderName(),
                settings.emailEnabled(),
                settings.googleEnabled()));
  }

  @PostMapping(value = "/auth/magic-links", consumes = "application/json")
  public ResponseEntity<Void> requestLink(
      @Valid @RequestBody EmailRequest body, Authentication authentication) {
    links.request(body.email(), sessions.currentId(authentication));
    return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).build();
  }

  @PostMapping(value = "/auth/magic-links/inspect", consumes = "application/json")
  public ResponseEntity<MagicLinkService.LinkDetails> inspect(
      @Valid @RequestBody TokenRequest body) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(links.inspect(body.token()));
  }

  @PostMapping(value = "/auth/magic-links/confirm", consumes = "application/json")
  public ResponseEntity<AccountService.Profile> confirm(
      @Valid @RequestBody TokenRequest body,
      Authentication authentication,
      HttpServletRequest request,
      HttpServletResponse response) {
    var profile = links.consume(body.token(), sessions.currentId(authentication));
    sessions.signIn(profile.id(), request, response);
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(profile);
  }

  @PostMapping(value = "/auth/google", consumes = "application/json")
  public GoogleResponse startGoogle(
      @Valid @RequestBody GoogleRequest body,
      Authentication authentication,
      HttpServletRequest request,
      HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-store");
    if (!settings.googleEnabled())
      throw new AuthException(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_DISABLED");
    UUID current = sessions.currentId(authentication);
    if (body.link() && current == null)
      throw new AuthException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    if (!body.link() && current != null)
      throw new AuthException(HttpStatus.CONFLICT, "ALREADY_SIGNED_IN");
    request
        .getSession()
        .setAttribute(
            GoogleSignInHandler.INTENT_KEY,
            new GoogleSignInHandler.Intent(body.link() ? current : null, Instant.now()));
    return new GoogleResponse("/oauth2/authorization/google");
  }

  @GetMapping("/me")
  public AccountService.Profile me(Authentication authentication) {
    return accounts.profile(requireId(authentication));
  }

  @PutMapping(value = "/me", consumes = "application/json")
  public AccountService.Profile rename(
      @Valid @RequestBody ProfileRequest body, Authentication authentication) {
    return accounts.rename(requireId(authentication), body.displayName());
  }

  @PutMapping(value = "/me/photo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<AccountService.Profile> uploadProfilePhoto(
      @RequestParam MultipartFile file,
      @RequestParam(required = false) UUID expectedPhotoId,
      Authentication authentication)
      throws IOException {
    UUID user = requireId(authentication);
    if (file.getSize() > 5 * 1024 * 1024)
      throw new DirectoryException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE");
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(accounts.uploadProfilePhoto(user, expectedPhotoId, file.getBytes()));
  }

  @DeleteMapping("/me/photo")
  public ResponseEntity<AccountService.Profile> removeProfilePhoto(
      @RequestParam(required = false) UUID expectedPhotoId, Authentication authentication) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(accounts.removeProfilePhoto(requireId(authentication), expectedPhotoId));
  }

  @GetMapping(value = "/profile-photos/{id}", produces = MediaType.IMAGE_JPEG_VALUE)
  public ResponseEntity<byte[]> profilePhoto(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "false") boolean thumbnail,
      Authentication authentication) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .body(accounts.profilePhoto(id, requireId(authentication), thumbnail));
  }

  @ExceptionHandler(AuthException.class)
  ResponseEntity<ApiError> authError(AuthException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new ApiError(error.getMessage()));
  }

  @ExceptionHandler(DirectoryException.class)
  ResponseEntity<ApiError> image(DirectoryException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new ApiError(error.getMessage()));
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ResponseEntity<ApiError> oversized(Exception error) {
    return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
        .cacheControl(CacheControl.noStore())
        .body(new ApiError("IMAGE_TOO_LARGE"));
  }

  @ExceptionHandler({
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class,
    MissingServletRequestPartException.class
  })
  ResponseEntity<ApiError> invalidRequest(Exception error) {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new ApiError("INVALID_REQUEST"));
  }

  private UUID requireId(Authentication authentication) {
    UUID id = sessions.currentId(authentication);
    if (id == null) throw new AuthException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    return id;
  }
}
