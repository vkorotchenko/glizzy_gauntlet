# Glizzy Gauntlet

A web-based, friendly hot-dog competition tracker. The **foundation, accounts, competitions, venue directory, and meal-logging milestones** are implemented; the product is not ready for public deployment.

The implementation connects React/TypeScript through a thin Node gateway to Spring Boot and PostgreSQL. It includes email magic links, optional Google OIDC, explicitly linked sign-in methods, database-backed sessions, display-name editing, public/private competitions, memberships, revocable invitations, Flyway migrations, a generated API client, and automated checks.

**Not implemented yet:** standings, progress dashboards, organizer scoring corrections, and final recaps. The home page labels its scoring illustration as an example; it does not display invented participant data.

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

Open **My meals** to record measured lengths, optional private photos, and a venue or private location label. Saving privately does not submit to a competition: explicitly select each eligible competition when saving.

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

Creation, publication, and settings changes require a future start. All settings, including written rules and visibility, lock when a published eating window starts. Updates use a version to reject stale-tab overwrites. Joining is allowed before and during eating, but not during the grace period. A closed submission window is labeled **Submissions closed**, not falsely finalized; standings and recap finalization are still pending.

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

There is no HTTP role-granting endpoint. Site owners can review directory contributions and hide or restore approved listings.

## Venue directory and photos

Open **Venues** for the public approved directory. The list always works independently of the optional map. Loading the map contacts OpenFreeMap and displays only the current page's listings, with OpenStreetMap attribution. `VITE_MAP_STYLE_URL` is a public build-time setting; rebuild the gateway image after changing it. No paid places API, geocoding, or address search is used.

Signed-in accounts can suggest a venue with a public address, manually entered coordinates, and up to 20 menu items. Save a private draft, attach optional venue/menu-item photos, then explicitly **Submit for review**. Use **My contributions** to return to drafts, check review reasons, or discard a nonapproved submission. At most 20 open drafts/pending submissions are allowed per account. Do not put home addresses or private meal locations in this public-intent workflow.

The site owner's **Review queue** supports approval/rejection with a required, audited reason. **All contributions** also provides private history and access to visibility controls. Only the contributor can upload, submit, or discard their draft; site-owner review does not grant ownership. Approved-listing suggestions are full replacement revisions, including their menu/photos, and leave the existing public version untouched until approval. Reattach photos that should appear in the replacement. Stale replacements are rejected rather than overwriting a newer approval.

Only current, approved, nonhidden venue photos are public. Other photos are available only to their contributor and the site owner. Hiding or replacing a listing revokes public access to its old photos; responses are `no-store`. This directory upload flow never publishes private meal photos automatically.

Uploads accept actual JPEG/PNG content, not a filename or declared MIME type: at most 5 MiB, 6000 pixels per side, and 12 megapixels. The API decodes and reencodes to metadata-free JPEG (longest side 1600 pixels) plus a 400-pixel thumbnail. Originals are not retained, and filenames never determine storage paths. Limits are 10 photos per draft, 200 retained photos per contributor, and a shared 512 MiB sanitized-storage budget (`MEDIA_MAX_BYTES`). Decoding/quota checks are serialized. Discarding a nonapproved contribution removes its files; approved history remains retained.

Compose persists sanitized files in the API-only `media` volume, outside the gateway web root. Host-side Spring uses `services/api/var/media` by default; override `MEDIA_DIRECTORY` as needed. Backups must include both PostgreSQL and media. These are bounded local-storage controls, not a verified production backup or capacity guarantee.

Competition organizers can choose up to 20 approved featured venues from their competition page. Featured views follow the competition's draft/private access rules, and hidden listings automatically disappear. Featuring a venue does not grant moderation privileges or promise availability.

## Meals and competition submissions

Each meal contains up to 20 item lines. Record the whole quantity (0-100), measured full length (0.01-100 inches), and any additional partial portion, which must be smaller than the full length. Each line must contribute a whole hot dog or a positive partial portion. Use separate lines for different sizes. Measurements accept at most two decimal places without rounding; the API calculates scores using integer hundredths. Two 8-inch hot dogs plus 3 partial inches score **19.00 inches and 2 whole hot dogs**. No standard size or eating-speed bonus applies.

Choose an approved venue or enter a private location label, eating time, optional notes, and up to five photos. Meal labels and photos never automatically enter the public directory. The source record and immutable revision history belong only to you, including when you organize a competition or hold the site-owner role.

Select target competitions explicitly on every save. You must be an active member, the eating time must fall at or after the competition's start and strictly before its end, and the submission must arrive before the 24-hour grace period ends. Future eating times are rejected. Sharing one meal across multiple nonwithdrawn submissions requires every affected competition to allow shared meals. A failed target rejects the entire save instead of creating a source or partial submissions.

Each selected competition receives a snapshot of that revision, visible only to its active members. Editing privately or choosing different targets leaves unselected and closed snapshots unchanged. Withdrawal is a separate, audited action available before the submission cutoff. **Archiving a source does not withdraw submissions or erase revisions or photos.** Archived sources remain available through **Show archived sources**; this milestone does not implement permanent meal deletion.

Meal photos use the same content validation, metadata stripping, and filesystem storage as directory photos, with a separate 200-photo limit per account and the shared `MEDIA_MAX_BYTES` budget. An unattached upload stays private to its owner and can be discarded. Bound photos remain with revision history. Competition membership grants photo access only through a current, nonwithdrawn snapshot containing that photo; withdrawing the last accessible snapshot revokes member access.

Updates reject stale versions. Mutation requests use a UUID idempotency key: retrying the same payload and key does not create another revision, while reusing a key with different content fails. The form retains its key for an unchanged retry in that editor session. Cutoff checks use database time after acquiring competition locks.

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

Directory browser checks cover private drafts, image validation/upload, and withdrawal. To include owner approval, public photos, featured venues, hide/restore, and map-outage checks against a **disposable local database only**, set `E2E_DIRECTORY_DB_CONTAINER` to that Compose database container's name. This explicitly permits the test to bootstrap its own generated account as a site owner using `docker exec psql`; never point it at a real user database. CI enables this only on its ephemeral stack.

Meal browser checks cover measured scoring, private photos, access boundaries, and source archival. Set `E2E_TEST_DB_CONTAINER` only for a **disposable local database** to include explicit multi-competition snapshots, frozen submissions, and withdrawal. These fixtures use `docker exec psql` to shift their generated competitions' eating windows; they must never target a real user database. CI enables both database fixtures on its ephemeral stack.

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

Meal endpoints start at `/api/v1/meals`, with revision history, source archival, and per-competition withdrawal beneath each meal. `/api/v1/competitions/{id}/meals` exposes member-only submitted snapshots, not private sources. `/api/v1/meal-photos` handles private uploads. Save/archive/withdraw requests require the current source or entry version and a `requestId`; all mutations require the CSRF header.

## Self-hosting boundaries

The Compose files retain database data and reserve a Caddy profile for future HTTPS deployment. Only the development override publishes the gateway and database, both on loopback. Keep the public profile disabled until authentication, upload controls, backups, and the remaining product features are implemented.

Pi 2/3 production support is **not verified**. Check exact board/OS architecture, runtime image compatibility, memory, storage, and load before choosing it; use an existing local server if it cannot support the complete stack.

Public deployment also requires a free dynamic-DNS hostname, router forwarding, HTTPS, Google application configuration, working SMTP delivery, and independently stored, restore-tested backups. None is automatically provisioned by this repository.
