# Glizzy Gauntlet

A web-based, friendly hot-dog competition tracker. The project is in its **foundation milestone**, not ready for public deployment.

The current implementation connects a React/TypeScript landing page through a thin Node gateway to a Spring Boot API and PostgreSQL. It includes a real database readiness check, a baseline Flyway migration, a generated TypeScript API client, and automated checks.

**Not implemented yet:** accounts, competitions, saved meal logs, venue maps/photos, progress dashboards, and final recaps. The home page labels its scoring illustration as an example; it does not display invented participant data.

## Run locally

Install Node.js 24 and Docker with Compose. Install Java 21 or newer if you want to run backend checks outside Docker; the project targets Java 21.

```bash
npm ci
cp .env.example .env
```

Replace the password placeholder in your local `.env` with a random password. Do not commit the file.

```bash
npm run stack:up
```

Open **http://127.0.0.1:3000**. The first run builds both application images. The status card confirms the full browser/gateway/API/database connection.

```bash
npm run stack:down
```

Stopping the stack retains the database volume. Do not use `down --volumes` unless you intend to delete that stack's local database.

## Develop with hot reload

Run the full stack in Docker and Vite on your host:

```bash
npm run stack:up
npm run dev -w @glizzy/web
```

Open http://127.0.0.1:5173. Vite forwards API/auth requests through the containerized Node gateway on port 3000. Spring remains internal-only.

The root `npm run dev` command starts both Vite and a host-side gateway instead. Use it only when Spring is already running on your host at port 8080, not alongside the containerized gateway. Host-side Spring uses Java 21 or newer and needs `POSTGRES_PASSWORD` exported with the same value as your local database. Never expose PostgreSQL or Spring directly on the public network.

## Checks

```bash
npm run check
npm run build
(cd services/api && ./mvnw verify)
```

Backend integration tests require Docker and start an isolated PostgreSQL Testcontainer. No H2 replacement or live email/Google account is used.

With the local stack running:

```bash
npx playwright install chromium
npm run test:e2e
```

The browser suite checks the real stack, failure/retry behavior, routing boundaries, and desktop/mobile layouts. Set `PLAYWRIGHT_BASE_URL` when using a nondefault gateway address.

Run `npm run format` and `(cd services/api && ./mvnw spotless:apply)` before checking formatting.

## API contract

`packages/api-client/openapi.yaml` is the contract-first source for the versioned API. Generate its TypeScript declarations with:

```bash
npm run api:generate
```

Commit the generated declarations alongside any contract/controller changes and update the endpoint tests. `npm run api:check` detects stale generated output. Business rules belong in Spring, not the Node gateway or the generated client.

`GET /api/v1/status` returns `{"status":"UP"}` only when PostgreSQL is reachable, or HTTP 503 with `{"status":"DOWN"}` otherwise. The gateway returns HTTP 502 JSON if Spring is unreachable. Unimplemented API routes cannot fall through to SPA HTML. Spring denies every non-health route until authentication is implemented.

## Self-hosting boundaries

The Compose files retain database data and reserve a Caddy profile for future HTTPS deployment. Only the development override publishes the gateway and database, both on loopback. Keep the public profile disabled until authentication, upload controls, backups, and the remaining product features are implemented.

Pi 2/3 production support is **not verified**. Check exact board/OS architecture, runtime image compatibility, memory, storage, and load before choosing it; use an existing local server if it cannot support the complete stack.

Public deployment also requires a free dynamic-DNS hostname, router forwarding, HTTPS, Google application configuration, working SMTP delivery, and independently stored, restore-tested backups. None is automatically provisioned by this repository.
