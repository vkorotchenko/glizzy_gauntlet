package com.glizzygauntlet.api;

import static org.assertj.core.api.Assertions.*;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(
    properties = {
      "SMTP_STARTTLS=true",
      "SMTP_AUTH=true",
      "SMTP_USERNAME=synthetic-sender",
      "SMTP_PASSWORD=synthetic-mail-value",
      "SMTP_HOST=127.0.0.1"
    })
class MailTransportTests {
  static final ServerSocket SMTP = server();
  @Autowired JavaMailSender mail;

  static ServerSocket server() {
    try {
      return new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
    } catch (IOException error) {
      throw new UncheckedIOException(error);
    }
  }

  @DynamicPropertySource
  static void smtpPort(DynamicPropertyRegistry registry) {
    registry.add("SMTP_PORT", SMTP::getLocalPort);
  }

  @AfterAll
  static void closeServer() throws IOException {
    SMTP.close();
  }

  @Test
  void refusesAProviderThatDoesNotOfferRequiredStartTlsBeforeSendingCredentialsOrMail()
      throws Exception {
    var commands =
        CompletableFuture.supplyAsync(
            () -> {
              var received = new ArrayList<String>();
              try (var socket = SMTP.accept()) {
                socket.setSoTimeout(5000);
                var input =
                    new BufferedReader(
                        new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                var output =
                    new PrintWriter(socket.getOutputStream(), true, StandardCharsets.US_ASCII);
                output.print("220 local fixture\r\n");
                output.flush();
                String command;
                while ((command = input.readLine()) != null) {
                  received.add(command);
                  output.print(
                      command.startsWith("QUIT") ? "221 bye\r\n" : "250 local fixture\r\n");
                  output.flush();
                  if (command.startsWith("QUIT")) break;
                }
              } catch (IOException error) {
                throw new UncheckedIOException(error);
              }
              return received;
            });
    var message = new SimpleMailMessage();
    message.setFrom("sender@example.test");
    message.setTo("recipient@example.test");
    message.setText("Synthetic transport check.");
    assertThatThrownBy(() -> mail.send(message)).hasMessageContaining("STARTTLS");
    List<String> received = commands.get(10, TimeUnit.SECONDS);
    assertThat(received).anyMatch(command -> command.startsWith("EHLO"));
    assertThat(received).noneMatch(command -> command.matches("^(AUTH|MAIL|RCPT|DATA).*"));
  }
}
