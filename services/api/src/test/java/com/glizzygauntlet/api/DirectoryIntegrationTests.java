package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.SessionAuthentication.AccountPrincipal;
import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.directory.DirectoryException;
import com.glizzygauntlet.api.directory.DirectoryService;
import com.glizzygauntlet.api.directory.DirectoryService.*;
import com.glizzygauntlet.api.directory.ImageStore;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class DirectoryIntegrationTests {
  @TempDir static Path media;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("app.media.directory", () -> media.toString());
  }

  @Autowired DirectoryService directory;
  @Autowired CompetitionService competitions;
  @Autowired AccountService accounts;
  @Autowired ImageStore images;
  @Autowired JdbcTemplate database;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  UUID owner;
  UUID contributor;
  UUID outsider;

  @BeforeEach
  void reset() {
    database.execute("TRUNCATE app_users, spring_session, magic_link_tokens CASCADE");
    owner = accounts.findOrCreate("email", "moderator@example.test", "moderator@example.test").id();
    contributor = accounts.findOrCreate("email", "author@example.test", "author@example.test").id();
    outsider = accounts.findOrCreate("email", "visitor@example.test", "visitor@example.test").id();
    database.update("UPDATE app_users SET site_owner = TRUE WHERE id = ?", owner);
  }

  @Test
  void publishesOnlyReviewedContentAndKeepsRevisionsPrivateUntilApproved() throws Exception {
    var draft = directory.create(contributor, input(null, null, "Dog stand"));
    var photo =
        directory.upload(draft.id(), contributor, draft.venue().menuItems().getFirst().id(), png());
    assertThat(directory.list(0, null, null, null, null).items()).isEmpty();
    mvc.perform(get("/api/v1/venues/" + draft.venue().id())).andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/directory/photos/" + photo.id())).andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/directory/contributions/" + draft.id()).with(as(outsider)))
        .andExpect(status().isNotFound());
    directory.submit(draft.id(), contributor);
    assertThat(directory.contributions(owner, "pending", 0).items()).hasSize(1);
    directory.review(draft.id(), owner, true, "Verified public listing");
    var publicVenue = directory.get(draft.venue().id());
    assertThat(publicVenue.photos()).containsExactly(photo);
    var edit =
        directory.create(outsider, input(publicVenue.id(), publicVenue.revision(), "New name"));
    directory.submit(edit.id(), outsider);
    assertThat(directory.get(publicVenue.id()).name()).isEqualTo("Dog stand");
    directory.review(edit.id(), owner, true, "Confirmed update");
    assertThat(directory.get(publicVenue.id()).name()).isEqualTo("New name");
    mvc.perform(get("/api/v1/directory/photos/" + photo.id())).andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/directory/photos/" + photo.id()).with(as(contributor)))
        .andExpect(status().isOk());
    assertThat(database.queryForObject("SELECT count(*) FROM directory_events", Long.class))
        .isEqualTo(2);
  }

  @Test
  void protectsModerationUploadsAndMutationsWithIdentityAndCsrf() throws Exception {
    String body = json.writeValueAsString(input(null, null, "Stand"));
    mvc.perform(
            post("/api/v1/directory/contributions")
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/v1/directory/contributions")
                .with(as(contributor))
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/directory/contributions")
                .with(as(contributor))
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.status").value("DRAFT"));
    var draft = directory.create(contributor, input(null, null, "Stand"));
    mvc.perform(get("/api/v1/directory/contributions?scope=pending").with(as(contributor)))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/directory/contributions/" + draft.id() + "/review")
                .with(as(contributor))
                .with(csrf())
                .contentType("application/json")
                .content("{\"approve\":true,\"reason\":\"No role\"}"))
        .andExpect(status().isForbidden());
    mvc.perform(
            multipart("/api/v1/directory/contributions/" + draft.id() + "/photos")
                .file(new MockMultipartFile("file", "../../escape.svg", "image/png", png()))
                .with(as(outsider))
                .with(csrf()))
        .andExpect(status().isNotFound());
    mvc.perform(
            multipart("/api/v1/directory/contributions/" + draft.id() + "/photos")
                .file(new MockMultipartFile("file", "../../escape.png", "text/plain", png()))
                .with(as(contributor))
                .with(csrf()))
        .andExpect(status().isCreated());
    mvc.perform(
            post("/api/v1/directory/contributions/" + draft.id() + "/submit")
                .with(as(contributor))
                .with(csrf()))
        .andExpect(status().isOk());
    rejected(
        HttpStatus.CONFLICT,
        "CONTRIBUTION_LOCKED",
        () -> directory.upload(draft.id(), contributor, null, pngUnchecked()));
    assertThat(Files.exists(media.getParent().resolve("escape.png"))).isFalse();
  }

  @Test
  void validatesCoordinatesMenuAndUnknownPropertiesAtApiBoundary() throws Exception {
    String body = json.writeValueAsString(input(null, null, "Stand"));
    for (String invalid :
        List.of(
            body.replace("\"latitude\":40.0", "\"latitude\":91.0"),
            body.replace("\"menuItems\":[", "\"menuItems\":[null,"),
            body.substring(0, body.length() - 1) + ",\"status\":\"APPROVED\"}")) {
      mvc.perform(
              post("/api/v1/directory/contributions")
                  .with(as(contributor))
                  .with(csrf())
                  .contentType("application/json")
                  .content(invalid))
          .andExpect(status().isBadRequest());
    }
    mvc.perform(get("/api/v1/venues?south=20")).andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/venues?south=NaN&north=90&west=-180&east=180"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void serializesCompetingReviewsAndRejectsStaleReplacements() {
    var initial = approved();
    var a = directory.create(contributor, input(initial.id(), initial.revision(), "First edit"));
    var b = directory.create(outsider, input(initial.id(), initial.revision(), "Stale edit"));
    directory.submit(a.id(), contributor);
    directory.submit(b.id(), outsider);
    directory.review(a.id(), owner, true, "Confirmed");
    rejected(
        HttpStatus.CONFLICT,
        "VERSION_CONFLICT",
        () -> directory.review(b.id(), owner, true, "Would overwrite"));
    rejected(
        HttpStatus.CONFLICT,
        "CONTRIBUTION_LOCKED",
        () -> directory.review(a.id(), owner, false, "Cannot undo"));
    directory.review(b.id(), owner, false, "Superseded");
    directory.discard(b.id(), outsider);
    assertThat(directory.get(initial.id()).name()).isEqualTo("First edit");
    assertThat(database.queryForObject("SELECT count(*) FROM directory_events", Long.class))
        .isEqualTo(3);
  }

  @Test
  void hidesPublicDetailsPhotosAndFeaturedListingsWithoutRemovingAudit() throws Exception {
    var draft = directory.create(contributor, input(null, null, "Stand"));
    var photo = directory.upload(draft.id(), contributor, null, png());
    directory.submit(draft.id(), contributor);
    directory.review(draft.id(), owner, true, "Confirmed");
    mvc.perform(get("/api/v1/directory/photos/" + photo.id()))
        .andExpect(status().isOk())
        .andExpect(content().contentType("image/jpeg"))
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    directory.hide(draft.venue().id(), owner, true, "Outdated");
    assertThat(directory.list(0, null, null, null, null).items()).isEmpty();
    mvc.perform(get("/api/v1/directory/photos/" + photo.id()).with(as(outsider)))
        .andExpect(status().isNotFound());
    directory.hide(draft.venue().id(), owner, false, "Confirmed again");
    assertThat(directory.get(draft.venue().id()).photos()).containsExactly(photo);
  }

  @Test
  void filtersCoordinatesAndPaginatesOnlyApprovedVenues() {
    for (int i = 0; i < 21; i++) {
      var draft = directory.create(contributor, input(null, null, "Stand " + i));
      directory.submit(draft.id(), contributor);
      directory.review(draft.id(), owner, true, "Confirmed");
    }
    assertThat(directory.list(0, 39.0, 41.0, -75.0, -73.0).items()).hasSize(20);
    assertThat(directory.list(0, null, null, null, null).hasMore()).isTrue();
    assertThat(directory.list(1, null, null, null, null).items()).hasSize(1);
    assertThat(directory.list(0, -10.0, 10.0, -75.0, -73.0).items()).isEmpty();
  }

  @Test
  void sanitizesPixelsRejectsBadImagesAndRemovesDiscardedDraftFiles() throws Exception {
    var draft = directory.create(contributor, input(null, null, "Stand"));
    var upload = png();
    var photo = directory.upload(draft.id(), contributor, null, upload);
    var safe = directory.photo(photo.id(), contributor, false);
    assertThat(safe).isNotEqualTo(upload);
    assertThat(ImageIO.read(new java.io.ByteArrayInputStream(safe)).getWidth()).isEqualTo(12);
    rejected(
        HttpStatus.BAD_REQUEST,
        "INVALID_IMAGE",
        () ->
            directory.upload(draft.id(), contributor, null, "<svg onload='alert(1)'/>".getBytes()));
    rejected(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "IMAGE_TOO_LARGE",
        () -> directory.upload(draft.id(), contributor, null, new byte[5 * 1024 * 1024 + 1]));
    rejected(
        HttpStatus.BAD_REQUEST,
        "INVALID_REQUEST",
        () -> directory.upload(draft.id(), contributor, UUID.randomUUID(), upload));
    directory.discard(draft.id(), contributor);
    assertThat(Files.exists(media.resolve(photo.id() + ".jpg"))).isFalse();
    assertThat(Files.exists(media.resolve(photo.id() + "-thumb.jpg"))).isFalse();
  }

  @Test
  void rejectsOversizedDimensionsBeforeDecodingAndBoundsPhotoCounts() throws Exception {
    var large = new BufferedImage(6001, 1, BufferedImage.TYPE_INT_RGB);
    var encoded = new ByteArrayOutputStream();
    ImageIO.write(large, "png", encoded);
    rejected(HttpStatus.BAD_REQUEST, "INVALID_IMAGE", () -> images.sanitize(encoded.toByteArray()));
    var draft = directory.create(contributor, input(null, null, "Stand"));
    for (int i = 0; i < 10; i++) directory.upload(draft.id(), contributor, null, png());
    rejected(
        HttpStatus.CONFLICT,
        "PHOTO_LIMIT",
        () -> directory.upload(draft.id(), contributor, null, pngUnchecked()));
    var limited = new DirectoryService(database, images, competitions, 1);
    // The real service also holds the global transaction lock; this read-only quota rejection
    // writes no files.
    var transactions =
        new org.springframework.transaction.support.TransactionTemplate(
            new org.springframework.jdbc.support.JdbcTransactionManager(database.getDataSource()));
    var other = directory.create(outsider, input(null, null, "Other"));
    rejected(
        HttpStatus.CONFLICT,
        "STORAGE_LIMIT",
        () ->
            transactions.execute(
                status -> limited.upload(other.id(), outsider, null, pngUnchecked())));
  }

  @Test
  void scopesFeaturedVenuesToCompetitionVisibilityAndOrganizer() throws Exception {
    var venue = approved();
    var draft =
        competitions.create(
            contributor,
            new CompetitionService.Settings(
                "Private crew",
                "",
                CompetitionService.Visibility.PRIVATE,
                "UTC",
                Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.MILLIS),
                Instant.now().plusSeconds(7200).truncatedTo(java.time.temporal.ChronoUnit.MILLIS),
                false));
    mvc.perform(get("/api/v1/competitions/" + draft.id() + "/featured-venues"))
        .andExpect(status().isNotFound());
    mvc.perform(
            put("/api/v1/competitions/" + draft.id() + "/featured-venues/" + venue.id())
                .with(as(outsider))
                .with(csrf()))
        .andExpect(status().isNotFound());
    directory.feature(draft.id(), contributor, venue.id(), true);
    directory.feature(draft.id(), contributor, venue.id(), true);
    assertThat(directory.featured(draft.id(), contributor)).hasSize(1);
    directory.hide(venue.id(), owner, true, "Review requested");
    assertThat(directory.featured(draft.id(), contributor)).isEmpty();
    directory.hide(venue.id(), owner, false, "Verified");
    directory.feature(draft.id(), contributor, venue.id(), false);
    assertThat(directory.featured(draft.id(), contributor)).isEmpty();
  }

  private Venue approved() {
    var draft = directory.create(contributor, input(null, null, "Stand"));
    directory.submit(draft.id(), contributor);
    directory.review(draft.id(), owner, true, "Confirmed");
    return directory.get(draft.venue().id());
  }

  private Input input(UUID venue, UUID revision, String name) {
    return new Input(
        venue,
        revision,
        name,
        "123 Main Street",
        "Community listing",
        40.0,
        -74.0,
        List.of(new MenuInput("House dog", "Ask about current availability")));
  }

  private byte[] png() throws Exception {
    var bytes = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(12, 8, BufferedImage.TYPE_INT_RGB), "png", bytes);
    return bytes.toByteArray();
  }

  private byte[] pngUnchecked() {
    try {
      return png();
    } catch (Exception error) {
      throw new RuntimeException(error);
    }
  }

  private RequestPostProcessor as(UUID id) {
    return authentication(
        new UsernamePasswordAuthenticationToken(
            new AccountPrincipal(id), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
  }

  private void rejected(
      HttpStatus status,
      String code,
      org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
    assertThatThrownBy(action)
        .isInstanceOfSatisfying(
            DirectoryException.class,
            error -> {
              assertThat(error.status()).isEqualTo(status);
              assertThat(error.getMessage()).isEqualTo(code);
            });
  }
}
