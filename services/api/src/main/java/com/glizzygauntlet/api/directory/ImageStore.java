package com.glizzygauntlet.api.directory;

import java.awt.Color;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class ImageStore {
  private final Path root;

  public ImageStore(@Value("${app.media.directory:./var/media}") String directory) {
    root = Path.of(directory).toAbsolutePath().normalize();
  }

  public record Images(byte[] image, byte[] thumbnail) {}

  public Images sanitize(byte[] bytes) {
    if (bytes.length == 0 || bytes.length > 5 * 1024 * 1024)
      throw new DirectoryException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE");
    try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
      var readers = ImageIO.getImageReaders(input);
      if (!readers.hasNext()) throw invalid();
      var reader = readers.next();
      try {
        if (!java.util.List.of("JPEG", "PNG").contains(reader.getFormatName().toUpperCase()))
          throw invalid();
        reader.setInput(input, true, true);
        int width = reader.getWidth(0);
        int height = reader.getHeight(0);
        if (width < 1
            || height < 1
            || width > 6000
            || height > 6000
            || (long) width * height > 12_000_000) throw invalid();
        BufferedImage decoded = reader.read(0);
        return new Images(encode(decoded, 1600), encode(decoded, 400));
      } finally {
        reader.dispose();
      }
    } catch (IOException | IllegalArgumentException error) {
      throw invalid();
    }
  }

  private byte[] encode(BufferedImage source, int limit) throws IOException {
    double scale = Math.min(1, (double) limit / Math.max(source.getWidth(), source.getHeight()));
    var output =
        new BufferedImage(
            Math.max(1, (int) (source.getWidth() * scale)),
            Math.max(1, (int) (source.getHeight() * scale)),
            BufferedImage.TYPE_INT_RGB);
    var graphics = output.createGraphics();
    try {
      graphics.setColor(Color.WHITE);
      graphics.fillRect(0, 0, output.getWidth(), output.getHeight());
      graphics.setRenderingHint(
          RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
      graphics.drawImage(source, 0, 0, output.getWidth(), output.getHeight(), null);
    } finally {
      graphics.dispose();
    }
    var bytes = new ByteArrayOutputStream();
    ImageIO.write(output, "jpeg", bytes);
    return bytes.toByteArray();
  }

  public void write(UUID id, Images images) {
    try {
      Files.createDirectories(root);
      Files.write(path(id, false), images.image(), java.nio.file.StandardOpenOption.CREATE_NEW);
      Files.write(path(id, true), images.thumbnail(), java.nio.file.StandardOpenOption.CREATE_NEW);
    } catch (IOException error) {
      delete(id);
      throw new DirectoryException(HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE");
    }
  }

  public byte[] read(UUID id, boolean thumbnail) {
    try {
      return Files.readAllBytes(path(id, thumbnail));
    } catch (IOException error) {
      throw new DirectoryException(HttpStatus.NOT_FOUND, "NOT_FOUND");
    }
  }

  public void delete(UUID id) {
    try {
      Files.deleteIfExists(path(id, false));
      Files.deleteIfExists(path(id, true));
    } catch (IOException error) {
      throw new DirectoryException(HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE");
    }
  }

  private Path path(UUID id, boolean thumbnail) {
    return root.resolve(id + (thumbnail ? "-thumb.jpg" : ".jpg"));
  }

  private DirectoryException invalid() {
    return new DirectoryException(HttpStatus.BAD_REQUEST, "INVALID_IMAGE");
  }
}
