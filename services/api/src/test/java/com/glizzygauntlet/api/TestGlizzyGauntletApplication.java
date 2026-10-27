package com.glizzygauntlet.api;

import org.springframework.boot.SpringApplication;

public class TestGlizzyGauntletApplication {

  public static void main(String[] args) {
    SpringApplication.from(GlizzyGauntletApplication::main)
        .with(TestcontainersConfiguration.class)
        .run(args);
  }
}
