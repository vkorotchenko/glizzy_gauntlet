# Glizzy Gauntlet

A web-based, friendly hot-dog competition tracker. The **foundation, accounts, and competition-management milestones** are implemented; the product is not ready for public deployment.

The implementation connects React/TypeScript through a thin Node gateway to Spring Boot and PostgreSQL. It includes email magic links, optional Google OIDC, explicitly linked sign-in methods, database-backed sessions, display-name editing, public/private competitions, memberships, revocable invitations, Flyway migrations, a generated API client, and automated checks.

**Not implemented yet:** saved meal logs, venue maps/photos, progress dashboards, and final recaps. The home page labels its scoring illustration as an example; it does not display invented participant data.

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

Open **My account**, choose email sign-in, and open **http://127.0.0.1:8025** to read the message in the local Mailpit inbox. No email leaves the development stack. Follow the link and explicitly confirm the displayed email address before signing in. You can then change your display name and sign out.

Open **Competitions** to browse public events or your own memberships and drafts. Create a draft, choose its visibility, time zone, dates, written rules, and sharing policy, then publish it when ready.

Mailpit contains sign-in links. It is development-only, binds to loopback, and must never be exposed publicly. Google remains unavailable until you configure your own Google OAuth client.

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

The local email link uses the container gateway's origin, so it opens the built app on port 3000 rather than Vite. Rebuild the stack after changing account screens if you want to test the full email flow. `GATEWAY_PORT`, `POSTGRES_PORT`, and `MAILPIT_PORT` override the development ports.

## Competition behavior

Only the creator organizes a competition. Drafts are visible only to their organizer. Published public competitions expose metadata and member counts to visitors; member identities/details are available only after joining. Private competitions are not discoverable and return not found to outsiders, even if they know the UUID.

You enter times in the selected IANA time zone, not your device's zone. Daylight-saving gaps are rejected. For a repeated hour, choose its first or second occurrence explicitly. Editing preserves the original occurrence and milliseconds. Start/end instants accept up to millisecond precision and are stored in PostgreSQL; the submission cutoff is exactly 24 elapsed hours after the eating end.

Creation, publication, and settings changes require a future start. All settings, including written rules and visibility, lock when a published eating window starts. Updates use a version to reject stale-tab overwrites. Joining is allowed before and during eating, but not during the grace period. A closed submission window is labeled **Submissions closed**, not falsely finalized; saved meals, standings, and recap finalization are still pending.

Organizers can create reusable invitation links for published competitions. Links expire after seven days or when eating ends, whichever comes first. At most 20 unexpired, unrevoked links may exist per competition. Copy each link when created: only its hash is stored, and the original cannot be retrieved. Invitation previews do not automatically join anyone or reveal member identities. If you are signed out, sign in and reopen the invitation to accept it.

Revoking an invitation prevents subsequent joins but does not remove existing members. An organizer can exclude a participant with a required, audited reason; excluded accounts cannot rejoin through a different invitation or access private member views. Exclusion is not a retrospective scoring correction. The organizer cannot exclude themselves.

Discovery returns 20 competitions per page and the member directory returns 50 members per page. Authentication identities and email addresses never appear in these projections. Invitation metadata is organizer-only and lists active links first, at most 50 records.

## Configure real sign-in providers

The base Compose file disables both sign-in methods by default. The development override enables email through Mailpit and disables Secure cookies only for loopback HTTP. **Do not use the development override for public deployment.**

For Google, set `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in runtime configuration. Set `PUBLIC_BASE_URL` to your HTTPS origin and register this exact callback:

```text
https://YOUR_HOSTNAME/login/oauth2/code/google
```

Only `openid` and `email` scopes are requested. Spring validates Google's OIDC response, and the app requires a verified email. Provider configuration is optional for local tests; real Google authorization still needs to be checked with your own client before launch.

For real email delivery, set `EMAIL_ENABLED=true`, `MAIL_FROM`, and the `SMTP_*` values for your existing mailbox/provider. Use its required TLS/authentication settings; for example, a provider using STARTTLS needs `SMTP_AUTH=true` and `SMTP_STARTTLS=true` in addition to its credentials. App-password availability and delivery limits depend on the provider. Test actual inbox delivery before public use.

Keep all credentials in runtime configuration, never Git. The app builds links from `PUBLIC_BASE_URL`, not incoming Host/forwarded headers. HTTPS is required outside loopback development.

Accounts are never merged just because Google and email addresses match. To add a second method, sign in to the original account and explicitly link it from **My account**. Linking an identity already owned by another account fails rather than merging their data. Each account currently supports one email identity and one Google identity.

## Account data and permissions

Email identities, provider subjects, and sessions are private. Public display names use generated nicknames until you edit them; Google profile names are not copied automatically.

Magic links expire after 15 minutes, are single-use, and require a confirmation action. GET requests and link inspection do not authenticate or consume them. Only hashes are stored; bearer links are not logged. Token rows are removed after one day. Requests have a resend cooldown, a per-address limit, and a global mail budget to bound free-mailbox usage.

Sessions live in PostgreSQL with a 12-hour idle timeout. Sign-in rotates the session ID and CSRF token. Cookies are HttpOnly, SameSite=Lax, and Secure by default. Sign-out invalidates the stored session. Profile edits cannot change site-owner status or identity ownership.

No public signup becomes an administrator automatically. An operator with local database access can bootstrap the site-owner flag explicitly. First copy your account UUID from **My account**, then open the database console:

```bash
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.dev.yaml exec db psql -U glizzy -d glizzy_gauntlet
```

Replace the placeholder below with that UUID:

```sql
UPDATE app_users SET site_owner = TRUE WHERE id = 'YOUR_ACCOUNT_UUID';
```

There is no HTTP role-granting endpoint. Directory/moderation features are still pending; the owner flag does not expose unimplemented APIs.

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

The browser suite checks the real stack, failure/retry behavior, routing boundaries, and desktop/mobile layouts. It reads email from Mailpit and covers sign-in, profiles, logout, token reuse, private drafts, public discovery, explicit invitation joins, revocation, exclusion, and organizer-only settings with separate browser sessions. Set `PLAYWRIGHT_BASE_URL` and `MAILPIT_BASE_URL` when using nondefault gateway/inbox addresses.

Run `npm run format` and `(cd services/api && ./mvnw spotless:apply)` before checking formatting.

## API contract

`packages/api-client/openapi.yaml` is the contract-first source for the versioned API. Generate its TypeScript declarations with:

```bash
npm run api:generate
```

Commit the generated declarations alongside any contract/controller changes and update the endpoint tests. `npm run api:check` detects stale generated output. Business rules belong in Spring, not the Node gateway or the generated client.

`GET /api/v1/status` returns `{"status":"UP"}` only when PostgreSQL is reachable, or HTTP 503 with `{"status":"DOWN"}` otherwise. The gateway returns HTTP 502 JSON if Spring is unreachable. Unimplemented API routes cannot fall through to SPA HTML and remain denied by Spring.

`GET /api/v1/auth/session` provides the current account, available methods, and a session-bound CSRF token. Send that token in `X-CSRF-TOKEN` for account mutations. `GET/PUT /api/v1/me` act only on the current signed-in account; logout uses `POST /api/v1/auth/logout`.

Competition endpoints start at `/api/v1/competitions`; use `scope=mine` for your memberships/drafts. Creation starts a draft, publication is explicit, and settings updates require the current version. Invitation inspection and acceptance use POST `/api/v1/competition-invitations/inspect` and `/join`. Every mutation, including invitation inspection, requires the session CSRF header.

## Self-hosting boundaries

The Compose files retain database data and reserve a Caddy profile for future HTTPS deployment. Only the development override publishes the gateway and database, both on loopback. Keep the public profile disabled until authentication, upload controls, backups, and the remaining product features are implemented.

Pi 2/3 production support is **not verified**. Check exact board/OS architecture, runtime image compatibility, memory, storage, and load before choosing it; use an existing local server if it cannot support the complete stack.

Public deployment also requires a free dynamic-DNS hostname, router forwarding, HTTPS, Google application configuration, working SMTP delivery, and independently stored, restore-tested backups. None is automatically provisioned by this repository.
