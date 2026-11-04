package com.glizzygauntlet.api.competitions;

import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;

@Service
public class CompetitionEmailDelivery implements DisposableBean {
  private static final Logger LOG = LoggerFactory.getLogger(CompetitionEmailDelivery.class);
  private final CompetitionEmailService emails;
  private final ThreadPoolExecutor executor =
      new ThreadPoolExecutor(
          1,
          1,
          0,
          TimeUnit.SECONDS,
          new ArrayBlockingQueue<>(20),
          Thread.ofPlatform().name("competition-email-", 0).daemon(true).factory());

  public CompetitionEmailDelivery(CompetitionEmailService emails) {
    this.emails = emails;
  }

  public void queue(UUID id, UUID user) {
    try {
      executor.execute(
          () -> {
            try {
              emails.send(id, user);
            } catch (RuntimeException failure) {
              LOG.warn(
                  "Competition invitation delivery interrupted; pending invitations can be retried");
            }
          });
    } catch (RejectedExecutionException busy) {
      LOG.warn("Competition invitation queue is busy; pending invitations can be retried");
    }
  }

  @Override
  public void destroy() {
    executor.shutdownNow();
  }
}
