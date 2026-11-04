package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.glizzygauntlet.api.auth.AccountService;
import com.glizzygauntlet.api.auth.AuthException;
import com.glizzygauntlet.api.auth.SessionAuthentication.AccountPrincipal;
import com.glizzygauntlet.api.competitions.CompetitionException;
import com.glizzygauntlet.api.competitions.CompetitionService;
import com.glizzygauntlet.api.competitions.CompetitionService.Settings;
import com.glizzygauntlet.api.competitions.CompetitionService.Visibility;
import com.glizzygauntlet.api.directory.DirectoryException;
import com.glizzygauntlet.api.directory.DirectoryService;
import com.glizzygauntlet.api.meals.MealException;
import com.glizzygauntlet.api.meals.MealService;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class ProfilePhotoIntegrationTests {
  @TempDir static Path media;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("app.media.directory", () -> media.toString());
  }

  @Autowired AccountService accounts;
  @Autowired CompetitionService competitions;
  @Autowired MealService meals;
  @Autowired DirectoryService directory;
  @Autowired JdbcTemplate database;
  @Autowired MockMvc mvc;
  @Autowired PlatformTransactionManager transactions;
  UUID owner;
  UUID participant;
  UUID outsider;

  @BeforeEach
  void resetData() {
    database.execute("TRUNCATE app_users, spring_session, magic_link_tokens CASCADE");
    owner = accounts.findOrCreate("email", "owner@example.test", "owner@example.test").id();
    participant =
        accounts.findOrCreate("email", "participant@example.test", "participant@example.test").id();
    outsider =
        accounts.findOrCreate("email", "outsider@example.test", "outsider@example.test").id();
  }

  @Test
  void uploadsSanitizedPicturesAndReplacesOrRemovesOnlyTheExpectedCurrentPicture()
      throws Exception {
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/me/photo")
                .file(new MockMultipartFile("file", "untrusted.txt", "text/plain", png()))
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.profilePhotoId").isNotEmpty());
    UUID original = accounts.profile(owner).profilePhotoId();
    mvc.perform(get("/api/v1/auth/session").with(as(owner)))
        .andExpect(jsonPath("$.user.profilePhotoId").value(original.toString()));
    byte[] sanitized =
        mvc.perform(get(photoUrl(original)).with(as(owner)))
            .andExpect(status().isOk())
            .andExpect(content().contentType("image/jpeg"))
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(sanitized).isNotEqualTo(png());
    assertThat(ImageIO.read(new ByteArrayInputStream(sanitized)).getWidth()).isEqualTo(12);
    mvc.perform(get(photoUrl(original)).param("thumbnail", "true").with(as(owner)))
        .andExpect(status().isOk())
        .andExpect(content().contentType("image/jpeg"));
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/me/photo")
                .file(new MockMultipartFile("file", png()))
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error").value("PHOTO_CONFLICT"));
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/me/photo")
                .file(new MockMultipartFile("file", png()))
                .param("expectedPhotoId", original.toString())
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isOk());
    UUID replacement = accounts.profile(owner).profilePhotoId();
    assertThat(replacement).isNotEqualTo(original);
    assertDeleted(original);
    mvc.perform(get(photoUrl(original)).with(as(owner))).andExpect(status().isNotFound());
    mvc.perform(
            delete("/api/v1/me/photo")
                .param("expectedPhotoId", original.toString())
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isConflict());
    assertThat(accounts.profile(owner).profilePhotoId()).isEqualTo(replacement);
    mvc.perform(
            delete("/api/v1/me/photo")
                .param("expectedPhotoId", replacement.toString())
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.profilePhotoId").value(org.hamcrest.Matchers.nullValue()));
    assertDeleted(replacement);
    mvc.perform(get(photoUrl(replacement)).with(as(owner))).andExpect(status().isNotFound());
  }

  @Test
  void requiresAuthenticationCsrfAndCurrentSharedPublishedMembership() throws Exception {
    UUID photo = accounts.uploadProfilePhoto(owner, null, png()).profilePhotoId();
    for (UUID user : List.of(owner, participant, outsider))
      competitions.leave(CompetitionService.ALL_TIME_ID, user);
    mvc.perform(get(photoUrl(photo))).andExpect(status().isUnauthorized());
    mvc.perform(get(photoUrl(photo)).with(as(owner))).andExpect(status().isOk());
    mvc.perform(get(photoUrl(photo)).with(as(participant))).andExpect(status().isNotFound());
    var draft = competitions.create(owner, settings());
    database.update(
        "INSERT INTO competition_memberships (competition_id, user_id) VALUES (?, ?)",
        draft.id(),
        participant);
    mvc.perform(get(photoUrl(photo)).with(as(participant))).andExpect(status().isNotFound());
    competitions.publish(draft.id(), owner, draft.version());
    mvc.perform(get(photoUrl(photo)).with(as(participant))).andExpect(status().isOk());
    mvc.perform(get(photoUrl(photo)).with(as(outsider))).andExpect(status().isNotFound());
    competitions.exclude(draft.id(), owner, participant, "Test exclusion");
    mvc.perform(get(photoUrl(photo)).with(as(participant))).andExpect(status().isNotFound());
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/me/photo")
                .file(new MockMultipartFile("file", png()))
                .param("expectedPhotoId", photo.toString())
                .with(as(owner)))
        .andExpect(status().isForbidden());
    mvc.perform(
            delete("/api/v1/me/photo").param("expectedPhotoId", photo.toString()).with(as(owner)))
        .andExpect(status().isForbidden());
    mvc.perform(
            delete("/api/v1/me/photo")
                .param("expectedPhotoId", photo.toString())
                .with(as(outsider))
                .with(csrf()))
        .andExpect(status().isConflict());
    assertThat(accounts.profile(owner).profilePhotoId()).isEqualTo(photo);
  }

  @Test
  void rejectsInvalidOversizedAndMalformedUploadsWithoutChangingThePicture() throws Exception {
    UUID original = accounts.uploadProfilePhoto(owner, null, png()).profilePhotoId();
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/me/photo")
                .file(new MockMultipartFile("file", "not an image".getBytes()))
                .param("expectedPhotoId", original.toString())
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("INVALID_IMAGE"));
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/me/photo")
                .file(new MockMultipartFile("file", new byte[5 * 1024 * 1024 + 1]))
                .param("expectedPhotoId", original.toString())
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isPayloadTooLarge());
    mvc.perform(multipart(HttpMethod.PUT, "/api/v1/me/photo").with(as(owner)).with(csrf()))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/me/photo")
                .file(new MockMultipartFile("file", png()))
                .param("expectedPhotoId", "not-a-uuid")
                .with(as(owner))
                .with(csrf()))
        .andExpect(status().isBadRequest());
    assertThat(accounts.profile(owner).profilePhotoId()).isEqualTo(original);
    mvc.perform(get(photoUrl(original)).with(as(owner))).andExpect(status().isOk());
  }

  @Test
  void deletesRolledBackWritesAndRetainsPicturesAfterRolledBackRemoval() throws Exception {
    UUID original = accounts.uploadProfilePhoto(owner, null, png()).profilePhotoId();
    byte[] image = png();
    var changed =
        new TransactionTemplate(transactions)
            .execute(
                status -> {
                  var result = accounts.uploadProfilePhoto(owner, original, image);
                  status.setRollbackOnly();
                  return result;
                });
    assertThat(changed).isNotNull();
    assertDeleted(changed.profilePhotoId());
    assertThat(accounts.profile(owner).profilePhotoId()).isEqualTo(original);
    new TransactionTemplate(transactions)
        .executeWithoutResult(
            status -> {
              accounts.removeProfilePhoto(owner, original);
              status.setRollbackOnly();
            });
    mvc.perform(get(photoUrl(original)).with(as(owner))).andExpect(status().isOk());
  }

  @Test
  void includesProfilePicturesInEverySharedStorageBudget() throws Exception {
    accounts.uploadProfilePhoto(owner, null, png());
    database.update("UPDATE profile_photos SET bytes = 536870912 WHERE user_id = ?", owner);
    byte[] image = png();
    assertThatThrownBy(() -> accounts.uploadProfilePhoto(participant, null, image))
        .isInstanceOfSatisfying(
            AuthException.class,
            error -> assertThat(error.getMessage()).isEqualTo("STORAGE_LIMIT"));
    assertThatThrownBy(() -> meals.upload(owner, image))
        .isInstanceOfSatisfying(
            MealException.class,
            error -> assertThat(error.getMessage()).isEqualTo("STORAGE_LIMIT"));
    var venue =
        directory.create(
            owner,
            new DirectoryService.Input(
                null, null, "Test stand", "Public address", "", 0d, 0d, List.of()));
    assertThatThrownBy(() -> directory.upload(venue.id(), owner, null, image))
        .isInstanceOfSatisfying(
            DirectoryException.class,
            error -> assertThat(error.getMessage()).isEqualTo("STORAGE_LIMIT"));
    var draft = competitions.create(owner, settings());
    assertThatThrownBy(() -> competitions.uploadCover(draft.id(), owner, draft.version(), image))
        .isInstanceOfSatisfying(
            CompetitionException.class,
            error -> assertThat(error.getMessage()).isEqualTo("STORAGE_LIMIT"));
  }

  @Test
  void usesTheAuthorsCurrentPictureWithoutChangingSubmittedMealSnapshots() throws Exception {
    var meal =
        meals.save(
            null,
            owner,
            new MealService.Save(
                UUID.randomUUID(),
                0L,
                new MealService.Content(
                    Instant.now()
                        .minusSeconds(10)
                        .truncatedTo(java.time.temporal.ChronoUnit.MILLIS),
                    null,
                    "Home",
                    "",
                    List.of(),
                    List.of(),
                    0L,
                    1),
                List.of(CompetitionService.ALL_TIME_ID)));
    assertThat(meals.feed(participant, 0).items().getFirst().profilePhotoId()).isNull();
    UUID first = accounts.uploadProfilePhoto(owner, null, png()).profilePhotoId();
    assertThat(meals.feed(participant, 0).items().getFirst().profilePhotoId()).isEqualTo(first);
    UUID replacement = accounts.uploadProfilePhoto(owner, first, png()).profilePhotoId();
    var entry = meals.feed(participant, 0).items().getFirst();
    assertThat(entry.profilePhotoId()).isEqualTo(replacement);
    assertThat(entry.revision().id()).isEqualTo(meal.revision().id());
    accounts.removeProfilePhoto(owner, replacement);
    assertThat(meals.feed(participant, 0).items().getFirst().profilePhotoId()).isNull();
  }

  @Test
  void concurrentUploadsCannotSilentlyOverwriteEachOther() throws Exception {
    byte[] image = png();
    var first = CompletableFuture.supplyAsync(() -> uploadOrConflict(image));
    var second = CompletableFuture.supplyAsync(() -> uploadOrConflict(image));
    var results = List.of(first.join(), second.join());
    assertThat(results).containsOnlyOnce("PHOTO_CONFLICT");
    assertThat(results).contains(accounts.profile(owner).profilePhotoId().toString());
    assertThat(database.queryForObject("SELECT count(*) FROM profile_photos", Long.class))
        .isEqualTo(1);
  }

  private String uploadOrConflict(byte[] image) {
    try {
      return accounts.uploadProfilePhoto(owner, null, image).profilePhotoId().toString();
    } catch (AuthException error) {
      return error.getMessage();
    }
  }

  private Settings settings() {
    Instant start =
        Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    return new Settings(
        "Profile picture crew",
        "",
        Visibility.PRIVATE,
        "UTC",
        start,
        start.plusSeconds(86400),
        true);
  }

  private byte[] png() throws Exception {
    var output = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(12, 4, BufferedImage.TYPE_INT_RGB), "png", output);
    return output.toByteArray();
  }

  private String photoUrl(UUID id) {
    return "/api/v1/profile-photos/" + id;
  }

  private void assertDeleted(UUID id) {
    assertThat(Files.exists(media.resolve(id + ".jpg"))).isFalse();
    assertThat(Files.exists(media.resolve(id + "-thumb.jpg"))).isFalse();
  }

  private RequestPostProcessor as(UUID id) {
    return authentication(
        UsernamePasswordAuthenticationToken.authenticated(
            new AccountPrincipal(id), null, List.of()));
  }
}
