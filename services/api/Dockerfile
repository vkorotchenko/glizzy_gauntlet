FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY services/api/.mvn .mvn
COPY services/api/mvnw services/api/pom.xml ./
RUN ./mvnw -B -q dependency:go-offline
COPY services/api/src src
RUN ./mvnw -B -q -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && apt-get clean
WORKDIR /app
RUN mkdir -p /app/media && chown 10001:10001 /app/media
COPY --from=build --chown=10001:10001 /workspace/target/*.jar app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=65", "-jar", "/app/app.jar"]
