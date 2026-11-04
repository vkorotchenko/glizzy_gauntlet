package com.glizzygauntlet.api.auth;

import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestController
@RequestMapping("/api/v1/admin/accounts")
public class GlobalRoleController {
  private final GlobalRoleService roles;
  private final SessionAuthentication sessions;

  public GlobalRoleController(GlobalRoleService roles, SessionAuthentication sessions) {
    this.roles = roles;
    this.sessions = sessions;
  }

  @GetMapping
  public ResponseEntity<GlobalRoleService.AccountPage> accounts(
      Authentication authentication,
      @RequestParam(defaultValue = "") String query,
      @RequestParam(defaultValue = "0") int page) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(roles.accounts(sessions.currentId(authentication), query, page));
  }

  @PutMapping("/{id}/roles/{role}")
  public ResponseEntity<GlobalRoleService.Account> grant(
      Authentication authentication,
      @PathVariable UUID id,
      @PathVariable GlobalRoleService.Role role) {
    return change(authentication, id, role, true);
  }

  @DeleteMapping("/{id}/roles/{role}")
  public ResponseEntity<GlobalRoleService.Account> revoke(
      Authentication authentication,
      @PathVariable UUID id,
      @PathVariable GlobalRoleService.Role role) {
    return change(authentication, id, role, false);
  }

  private ResponseEntity<GlobalRoleService.Account> change(
      Authentication authentication, UUID id, GlobalRoleService.Role role, boolean grant) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(roles.assign(sessions.currentId(authentication), id, role, grant));
  }

  @ExceptionHandler(AuthException.class)
  ResponseEntity<AuthController.ApiError> rejected(AuthException error) {
    return ResponseEntity.status(error.status())
        .cacheControl(CacheControl.noStore())
        .body(new AuthController.ApiError(error.getMessage()));
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  ResponseEntity<AuthController.ApiError> invalidRequest() {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new AuthController.ApiError("INVALID_REQUEST"));
  }
}
