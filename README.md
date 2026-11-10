# Glizzy Gauntlet

A web-based, friendly hot-dog competition tracker. The **foundation, accounts, competitions, venue directory, meal logging, progress, versioned recaps, and competitor feed milestones** are implemented; the product is not ready for public deployment.

The implementation connects React/TypeScript through a thin Node gateway to Spring Boot and PostgreSQL. It includes email magic links, optional Google OIDC, explicitly linked sign-in methods, database-backed sessions, display-name editing, public/private competitions, memberships, revocable invitations, Flyway migrations, a generated API client, and automated checks.

**Before public launch:** complete host feasibility checks, real sign-in provider verification, and independently stored backups with a restore rehearsal on the chosen host. Local recovery tooling and deployment preflight are implemented; they do not certify a production environment. The home page combines your own meals with submitted competitor meals for signed-in users, or public competition discovery and a sign-in prompt for visitors.

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

In **Profile settings**, upload, replace, or remove your profile picture (JPEG/PNG, up to 5 MiB). Pictures appear in the account header, meal preview, and competitor feed, with initials when absent or unavailable. Images are sanitized and visible only to their owner and signed-in active members sharing a published competition, not to guests or unrelated accounts. Replacing or removing a picture retires its previous image URL.

Open **Competitions** to see your joined events above public discovery. **My competitions** in your account separates **Competitions I administer** from **Other competitions**, including drafts and past events without duplicate cards. Create a draft, choose its visibility, time zone, dates, written rules, and sharing policy, optionally add invitee emails, then publish it when ready.

**My account** has persistent tabs for **Profile settings**, **My venues**, **My competitions**, and **My feed**. Open **My feed**, then **Log a meal** to record hot dog count and/or total measured inches. Photos, location, notes, and eating time are optional. Eligible joined competitions are selected by default; review the sharing choices or keep the meal private before saving. The old `/meals` link redirects to the account's personal feed.

Select **Keep this meal private** to save only for yourself, even while participating in public competitions. Private meals do not count toward any competition totals, including the all-time leaderboard. This choice stays selected when you edit the meal. Making a previously shared meal private withdraws its open submissions; closed or unavailable submissions must remain unchanged, so they block that change. Turning private mode off lets you explicitly share the meal again.

Mailpit contains sign-in links and competition invitations. It is development-only, binds to loopback, and must never be exposed publicly. Google remains unavailable until you configure your own Google OAuth client.

```bash
npm run stack:down
```

Stopping the stack retains the database volume. Do not use `down --volumes` unless you intend to delete that stack's local database.

## Project commands

Run `make` or `make help` from the repository root to list the commands. GNU Make 3.81 or newer wraps the existing npm, Maven, Compose, and GitHub CLI commands; it never creates or loads an environment file itself. Configure `.env` privately as described above before starting the stack.

| Command                                            | Purpose                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `make install`                                     | Install locked Node dependencies.                                                              |
| `make up` / `make down`                            | Build/start the local stack and wait for health, or stop it without deleting volumes.          |
| `make watch` / `make dev`                          | Start Vite hot reload against the running Docker stack.                                        |
| `make dev-host` / `make dev-api`                   | Run the host gateway/web app or host API with privately exported configuration.                |
| `make build`                                       | Build the Node applications and package the Java API without tests.                            |
| `make build-js` / `make build-api` / `make images` | Build only the Node applications, API package, or local Docker images.                         |
| `make status` / `make logs ARGS=api`               | Inspect local services or follow their logs.                                                   |
| `make check` / `make test` / `make test-api`       | Run Node checks, Node unit tests, or full Java verification with Docker-backed tests.          |
| `make lint` / `make typecheck` / `make format`     | Run individual checks or format Node/documentation and Java sources.                           |
| `make api-generate` / `make api-check`             | Regenerate or verify the OpenAPI TypeScript declarations.                                      |
| `make browser-install` / `make test-e2e`           | Install Chromium, then test an already-running local stack.                                    |
| `make test-recovery`                               | Run the existing recovery rehearsal with its required disposable-stack flags.                  |
| `make ci`                                          | Run Node checks/builds and Java verification, in order, without deploying or starting a stack. |

Use `ARGS` for test filters, such as `make test ARGS='--project web'` or `make test-e2e ARGS='tests/e2e/meals.spec.ts --workers=2'`. Use `ENV_FILE` and `PROJECT` to select a local Compose configuration/project. Browser database fixture flags and recovery opt-ins remain explicit: never point them at real user data. Java commands honor `JAVA_HOME`; `make build-api` skips tests, while `make test-api` and `make ci` do not.

### Deploy and maintain a production host

For a fresh Ubuntu server, use the [interactive host installer](ops/README.md#bootstrap-a-fresh-ubuntu-server) to install dependencies, configure SMTP/Google and server settings, and walk through router-side DHCP reservation without deploying publicly.

`make up` is local development, not public deployment. After completing every gate in the [operations guide](ops/README.md), run on the intended Linux host:

```bash
make preflight ENV_FILE=/private/glizzy.env
make deploy ENV_FILE=/private/glizzy.env PROD_PROJECT=glizzy-prod
make deploy-status ENV_FILE=/private/glizzy.env PROD_PROJECT=glizzy-prod
```

`make deploy` reruns preflight before starting the base Compose configuration with the public HTTPS profile, never the development override. Preflight failure blocks deployment, but success does not certify DNS, TLS reachability, provider authorization, host capacity, or independent backups. Deployment may apply Flyway migrations; follow the backup and upgrade procedure before upgrading an existing site. `make deploy-logs` uses the same production variables.

Backup briefly stops writers. Restore requires a separately prepared, empty project and leaves its writers stopped. Both require explicit project and directory arguments; the existing operations safety checks remain in force:

```bash
make backup OPS_PROJECT=glizzy-prod BACKUP_DIR=/mnt/gauntlet-backups/manual-001
make restore OPS_PROJECT=glizzy-restore BACKUP_DIR=/mnt/gauntlet-backups/manual-001
```

### Run GitHub Actions

Pushes and pull requests continue to trigger CI automatically. The workflow now uses the same Make targets for checks, builds, browser acceptance, and the disposable recovery rehearsal. CI alone retains its explicit ephemeral-volume cleanup; `make down` never deletes volumes.

With the GitHub CLI authenticated for this repository:

```bash
make ci-run
make ci-runs
make ci-watch RUN_ID=123456789
make ci-logs RUN_ID=123456789
make ci-rerun RUN_ID=123456789
```

`make ci-run` dispatches `ci.yml` for your current branch; override `REF` or `WORKFLOW` when needed. Manual dispatch becomes available after the updated workflow is merged into the default branch. `ci-watch` returns a failure if the run fails, `ci-logs` shows failed-job logs, and `ci-rerun` retries only failed jobs. These commands do not deploy production.

## Develop with hot reload

Run the full stack in Docker and Vite on your host:

```bash
npm run stack:up
npm run watch
```

`make watch` does the same thing; `make dev` remains an alias. If the Docker stack is already running, start only the watcher.

Open http://127.0.0.1:5173. Saving React, TypeScript, or CSS files updates the browser automatically without rebuilding containers. React Fast Refresh preserves component state when possible. Vite forwards API/auth requests through the containerized Node gateway on port 3000. Spring remains internal-only. For a different gateway port, run `GATEWAY_PORT=3100 npm run watch`.

Keep the watch command running while you edit. Press Ctrl+C to stop it; the Docker backend stays running. This watches the frontend only: gateway, Java API, or dependency changes still need the appropriate rebuild/restart. The built website on port 3000 does not hot reload.

The root `npm run dev` command starts both Vite and a host-side gateway instead. Use it only when Spring is already running on your host at port 8080, not alongside the containerized gateway. Host-side Spring uses Java 21 or newer and needs `POSTGRES_PASSWORD` exported with the same value as your local database. Never expose PostgreSQL or Spring directly on the public network.

Email links and Google callbacks use the container gateway's origin, so they open the built app on port 3000 rather than Vite. Complete sign-in there, then return to port 5173 to continue editing; use `127.0.0.1` consistently so both ports share the session cookie. Rebuild the stack when you also want the built app to show your updates. `GATEWAY_PORT`, `POSTGRES_PORT`, and `MAILPIT_PORT` override the development ports.

## Competition behavior

**All-time Glizzy Gauntlet** is a permanent public hot dog count leaderboard with no eating end, submission cutoff, or final recap. Global **Admins** manage its members and invitations; its permanent public count-based settings stay locked. A legacy organizer assignment alone no longer grants all-time administration. Existing accounts join during the migration, and new accounts join on creation. Membership never publishes private meals automatically: explicitly select this competition when saving a meal. You can also submit that meal to one timed competition without changing its normal sharing policy.

Choose **Leave all-time competition** on its detail page to opt out. Leaving withdraws your shared all-time entries and removes you from its feed and standings, while preserving private source meals and submissions to other competitions. Later sign-ins respect the opt-out. You can explicitly rejoin, but old entries remain withdrawn until you choose to submit them again. Global Admins keep member-management and invitation access without rejoining; this does not grant access to unjoined meal details.

Only the creator organizes an ordinary competition. Drafts are visible only to their organizer. Published public competitions expose metadata and member counts to visitors; member identities/details are available only after joining. Private competitions are not discoverable and return not found to outsiders, even if they know the UUID.

Choose **Hot dog count**, **Length in inches**, or **Count and length** when creating a competition. Existing competitions retain both metrics. Count-only competitions rank by whole hot dogs; length and combined competitions rank by inches without a count tie-breaker. Tracking mode locks with the other settings when eating starts.

You enter times in the selected IANA time zone, not your device's zone. Daylight-saving gaps are rejected. For a repeated hour, choose its first or second occurrence explicitly. Editing preserves the original occurrence and milliseconds. Start/end instants accept up to millisecond precision and are stored in PostgreSQL; the submission cutoff is exactly 24 elapsed hours after the eating end.

Creation, publication, and settings changes require a future start. All settings, including written rules and visibility, lock when a published eating window starts. Updates use a version to reject stale-tab overwrites. Joining is allowed before and during eating, but not during the grace period. A closed submission window is labeled **Submissions closed** until its first immutable result is published, then **Final results** or **Revised results**.

Organizers can create reusable invitation links for published competitions. Links expire after seven days or when eating ends, whichever comes first. At most 20 unexpired, unrevoked links may exist per competition. Copy each link when created: only its hash is stored, and the original cannot be retrieved. Invitation previews do not automatically join anyone or reveal member identities. If you are signed out, sign in and reopen the invitation to accept it.

When creating a competition, optionally enter up to 20 email addresses separated by commas, semicolons, spaces, or newlines. Addresses are normalized and deduplicated. They stay private with the draft; publishing starts background delivery of a separate invitation to each recipient. Sending does not create accounts or memberships. Recipients must sign in and explicitly accept, and links remain reusable and forwardable rather than restricted to the addressed email.

Open **Email invitations** in the organizer's **Invitations** section to view delivery status or retry pending and failed messages. **Sent** means SMTP accepted the message, not guaranteed inbox delivery; ordinary retries skip sent recipients. Failed-send links are revoked. Delivery failures do not undo publication. Pending recipients survive a restart or a busy worker queue, but there is no automatic recovery scheduler: retry them from this section. SMTP cannot guarantee exactly-once delivery after an interrupted or uncertain acknowledgement.

Email invitations use the same configured SMTP provider as sign-in; local messages go only to Mailpit. Email delivery must be enabled to add recipients. Invitation mail allows at most 100 attempts per hour globally, 40 per organizer, and 5 per recipient, with a one-minute recipient cooldown. The existing 20-active-link limit also applies to emailed invitations. Recipient addresses and delivery status are organizer-only and never appear in competition discovery, metadata, or member views.

Revoking an invitation prevents subsequent joins but does not remove existing members. An organizer can exclude a participant with a required, audited reason; excluded accounts cannot rejoin through a different invitation or access private member views. Exclusion is not a retrospective scoring correction. The organizer cannot exclude themselves.

Discovery returns 20 competitions per page and the member directory returns 50 members per page. Authentication identities and email addresses never appear in these projections. Invitation metadata is organizer-only and lists active links first, at most 50 records.

## Configure real sign-in providers

The base Compose file disables both sign-in methods by default. The development override enables email through Mailpit and disables Secure cookies only for loopback HTTP. **Do not use the development override for public deployment.**

### Google sign-in for local development

Google sign-in uses a server-side OAuth flow. No public hostname or production email provider is needed for local use.

1. Select or create a project in [Google Auth Platform](https://console.cloud.google.com/auth/overview). Complete **Branding** with the app name and required contact details. For personal Google accounts, choose an **External** audience; keep the app in **Testing** and add the accounts you will use under **Test users**.
2. Under **Clients**, create an OAuth client with application type **Web application**. Add this exact **Authorized redirect URI**:

   ```text
   http://127.0.0.1:3000/login/oauth2/code/google
   ```

   Authorized JavaScript origins are not required for this server-side flow. The app requests only `openid` and `email`; do not add unrelated API scopes.

3. Copy the client ID and secret into your existing, untracked `.env`, replacing the values below without changing your database password or other settings:

   ```dotenv
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

   Keep the secret out of chat, Git, screenshots, and logs. If you download Google's credentials file, store it outside the checkout.

4. Run `npm run stack:up` again to recreate the API with the updated configuration. Restarting an existing container alone does not apply changed environment settings.
5. Open **http://127.0.0.1:3000**, choose **Sign in**, and select **Continue with Google**. If you already have an email-based account, sign in with email first and link Google from **My account** instead of creating a separate profile.

Use `127.0.0.1` consistently, not `localhost` or the Vite port: the OAuth callback must return to the same origin that started sign-in so its session cookie is available. If you override `GATEWAY_PORT`, register and use that port instead of `3000`; the development Compose file derives the callback origin from it.

If the Google button is missing, confirm `GOOGLE_ENABLED=true` and rerun `npm run stack:up`. A `redirect_uri_mismatch` means Google's registered URI does not exactly match the callback above, including the scheme, host, port, and path. An `invalid_client` error means the web client's ID/secret must be checked privately. If Google reports an audience or test-user restriction, check **Audience** and use an allowed account.

### Production providers

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

Sessions live in PostgreSQL with a 12-hour idle timeout. Sign-in rotates the session ID and CSRF token. Cookies are HttpOnly, SameSite=Lax, and Secure by default. Sign-out invalidates the stored session. Profile edits cannot change global roles or identity ownership.

Global roles are stored against account UUIDs in `account_roles`, never inferred from email addresses. **Admin** grants all-time administration, audited role management, venue review, and venue visibility moderation. **Venue approver** grants the pending review queue and review of submitted contributions/photos, but not other accounts' drafts, all-contribution history, role management, or venue hiding. Regular competition organizers remain scoped to their own events; global roles do not bypass other accounts' private competitions or meals.

No public signup becomes an administrator automatically. Existing site-owner flags migrate to Admin. An authorized operator can bootstrap the first Admin; subsequent grants and revocations use **My account > Role management**, which shows display names and account IDs, never email addresses. Revocation takes effect on the backend immediately, and concurrent changes cannot remove the last Admin.

To bootstrap the first Admin, copy the existing account UUID from **My account**, then open the database console:

```bash
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.dev.yaml exec db psql -U glizzy -d glizzy_gauntlet
```

Replace the placeholder below with that UUID:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('global-role-assignments', 0));
WITH granted AS (
    INSERT INTO account_roles (user_id, role)
    SELECT id, 'ADMIN' FROM app_users
    WHERE id = 'YOUR_ACCOUNT_UUID'
      AND NOT EXISTS (SELECT 1 FROM account_roles WHERE role = 'ADMIN')
    ON CONFLICT DO NOTHING
    RETURNING user_id, role
)
INSERT INTO account_role_events (id, target_user_id, role, action, reason)
SELECT gen_random_uuid(), user_id, role, 'GRANTED', 'Initial Admin bootstrap by authorized database operator.'
FROM granted;
COMMIT;
```

This only grants the first Admin and records a maintenance audit event. All browser role changes require Admin authorization and CSRF protection; idempotent retries do not duplicate audit events. The deprecated `siteOwner` profile field remains a read-only compatibility alias for Admin, not a separate permission store.

## Venue directory and photos

Sign in and open **Venues** for the approved venue map. The map loads automatically and includes every directory page, without approved-list or map-toggle buttons. Loading it contacts OpenFreeMap, with OpenStreetMap attribution; a map outage shows a retry explanation rather than a separate venue-card list. `VITE_MAP_STYLE_URL` is a public build-time setting; rebuild the gateway image after changing it. No paid places API, geocoding, or address search is used. Guests cannot access venue pages, photos, or featured-venue endpoints.

Signed-in accounts can suggest a venue with a public address, manually entered coordinates, and up to 20 menu items. Save a private draft, attach optional venue/menu-item photos, then explicitly **Submit for review**. Use **My venues** in your account to return to drafts, check review reasons, or discard a nonapproved submission. Authorized review and history links remain under **Profile settings**. At most 20 open drafts/pending submissions are allowed per account. Do not put home addresses or private meal locations in this shared directory workflow.

Admins and Venue approvers use **Review queue** for approval/rejection with a required, audited reason. Admin-only **All contributions** also provides private history and visibility controls. Only the contributor can upload, submit, or discard their draft; global roles do not grant contribution ownership. Approved-listing suggestions are full replacement revisions, including their menu/photos, and leave the existing public version untouched until approval. Reattach photos that should appear in the replacement. Stale replacements are rejected rather than overwriting a newer approval.

Only current, approved, nonhidden venue photos are visible to all signed-in accounts. Other photos require contributor or Admin access; Venue approvers may inspect submitted/reviewed photos but never another account's draft. Hiding or replacing a listing revokes ordinary directory access to its old photos; responses are `no-store`. This directory upload flow never publishes private meal photos automatically.

Uploads accept actual JPEG/PNG content, not a filename or declared MIME type: at most 5 MiB, 6000 pixels per side, and 12 megapixels. The API decodes and reencodes to metadata-free JPEG (longest side 1600 pixels) plus a 400-pixel thumbnail. Originals are not retained, and filenames never determine storage paths. Limits are 10 photos per draft, 200 retained photos per contributor, and a shared 512 MiB sanitized-storage budget (`MEDIA_MAX_BYTES`). Decoding/quota checks are serialized. Discarding a nonapproved contribution removes its files; approved history remains retained.

Compose persists sanitized files in the API-only `media` volume, outside the gateway web root. Host-side Spring uses `services/api/var/media` by default; override `MEDIA_DIRECTORY` as needed. Backups must include both PostgreSQL and media. These are bounded local-storage controls, not a verified production backup or capacity guarantee.

Competition organizers can choose up to 20 approved featured venues from their competition page. Featured views follow the competition's draft/private access rules, and hidden listings automatically disappear. Featuring a venue does not grant moderation privileges or promise availability.

Competitions can have one optional cover photo, shown on competition cards and the competition page. Choose a cover when creating a draft, or use **Manage cover photo** on the competition page to upload, replace, or remove it. Only the organizer can change an ordinary competition's cover; global Admins manage the all-time cover. Covers can change even after scoring settings lock. Draft/private covers follow competition access rules; published public covers are visible to guests. Replaced and removed covers become unavailable and their files are deleted after commit. Covers use the same JPEG/PNG sanitization and shared storage budget as other photos, with at most 200 covered competitions per organizer; meal and venue photos are never reused automatically. Creating a draft with its cover is atomic, so a failed upload does not leave a partial draft.

## Home feed and likes

Signed-in visitors see their own current meals, including private meals, alongside competitor meals across all their actively joined, published competitions, newest eating time first with 20 cards per page. Your meals appear once regardless of sharing and show your current source revision. Other members see only explicitly submitted competition snapshots, including their member-visible location, notes, and photos, never your private source edits. Archived own sources remain in your archive; archiving does not remove submitted snapshots from competitors' feeds. Withdrawal or loss of membership removes access to competition cards.

The bottom of each competitor meal card shows its hot dog totals, like count, and **Like** button; your own cards have a **View meal** link instead. Press **Liked** to remove your like. Each member can like another member's competition submission once; retries cannot duplicate it, and likes never affect scores. Competitor meals appear separately in each competition, with independent likes and no disclosure of other competitions. **Refresh feed** fetches current activity; there is no live push feed.

The top-bar **Feed** link opens the landing feed; an underline marks the current navigation section. An empty first feed page shows two clearly labeled sample cards by **glizzy gauntlet**, with local hotdog illustrations and example totals. Select **Start a competition** for a tutorial with sample rules and standings, or **Log in or create an account** to see membership benefits. Samples never enter the database, accept reactions, or affect standings, and disappear when real meals are available.

Signed-out visitors see the sample preview, a sign-in prompt, and up to two recent public competition cards, never real member meal details or photos.

## Meals and competition submissions

Log a meal with individual hot dog rows beneath a live feed-style preview. Each new row counts as one hot dog and has an optional description (default **Hotdog**), a multi-select condiment picker, duplicate/remove buttons, and an inches field when an open joined competition tracks length. **Add hot dog** appends another row, up to 20; **Include inches** also permits private length logging without a length-tracking competition. Length is per hot dog, accepts at most two decimal places without rounding, and uses integer hundredths internally. Condiments are saved with the revision and shown in the feed, but never affect scoring. Count-only rows record no invented length. COUNT submission targets require a positive count; LENGTH and BOTH targets require positive total inches.

Click or drag JPEG/PNG files onto the preview to upload photos, or use the photo picker below the rows. New revisions allow at most three photos per meal; older revisions retain their photos. New meals default to the private location label **Home**, without requesting coordinates or loading a map. Choose **Somewhere else** to reveal a searchable venue picker with a compact **List / Map** switch, or enter another private location label. Choosing a map pin selects the venue without leaving the meal; selection is retained when switching views or temporarily switching back to Home. Map tiles load from OpenFreeMap only in Map view. **Use my location** requests browser permission and orders venues from all directory pages by straight-line distance in List view; without permission, the list stays alphabetical and fully usable, including if the map is unavailable. Coordinates remain in page memory and are not sent to the server or saved with the meal. Home is a label, not an address, and like other location labels it is visible to members of selected competitions. Editing an existing meal preserves its location, including an omitted location; omitted locations do not count as visited places. Expand **Notes (optional)** to add notes. **Meal date override** has separate date and time controls at the bottom; enter both or leave both blank to use database time when saving. An explicitly entered time uses your device's local date and time with minute precision and rounds to the nearest 15 minutes, rounding down instead if rounding up would move a past meal into the future. Existing precise timestamps stay unchanged when you edit only other meal details. Longer explanations are available through the adjacent info buttons. Competition eating windows and submission deadlines are still enforced, so grace-period backfill needs an explicit eligible eating time.

Older measured rows retain their original quantities and partial lengths when edited. Older aggregate meals keep their count/length editor unless you explicitly replace their totals with individual rows. Neither private edits nor changing the input format alters older revisions or unselected submissions.

Meal labels and photos never automatically enter the public directory. The source record and immutable revision history belong only to you, including when you organize a competition or hold a global role.

**Share with all eligible competitions** is checked by default for new meals and edits, selecting every open joined competition, including later membership pages. Uncheck it to reveal individual choices; selecting none saves privately, without withdrawing older submissions. Custom choices are retained when toggling all-sharing on and off. Saves remain limited to 20 targets; if more competitions are open, choose a subset before saving. The server still enforces active membership, eating windows, and submission deadlines: the eating time must fall at or after a timed competition's start and strictly before its end, and the submission must arrive before the 24-hour grace period ends. Future eating times are rejected. Sharing one meal across multiple nonwithdrawn submissions requires every affected competition to allow shared meals. A failed target rejects the entire save instead of creating a source or partial submissions.

Each selected competition receives a snapshot of that revision, visible only to its active members. Editing privately or choosing different targets leaves unselected and closed snapshots unchanged. Withdrawal is a separate, audited action available before the submission cutoff. **Archiving a source does not withdraw submissions or erase revisions or photos.** Archived sources remain available through **Show archived sources**; this milestone does not implement permanent meal deletion.

Meal photos use the same content validation, metadata stripping, and filesystem storage as directory photos, with a separate 200-photo limit per account and the shared `MEDIA_MAX_BYTES` budget. An unattached upload stays private to its owner and can be discarded. Bound photos remain with revision history. Competition membership grants photo access only through a current, nonwithdrawn snapshot containing that photo; withdrawing the last accessible snapshot revokes member access.

Updates reject stale versions. Mutation requests use a UUID idempotency key: retrying the same payload and key does not create another revision, while reusing a key with different content fails. The form retains its key for an unchanged retry in that editor session. Cutoff checks use database time after acquiring competition locks.

## Standings and personal progress

Published public competition pages show display names, tracked totals, and ranks to visitors. Private standings follow competition access rules. Equal tracked scores share a rank, such as **1, 1, 3**; other measurements and entry timing never break ties. Count-only progress charts use hot dogs rather than inches. Current members with no submissions score zero. Excluding a member does not silently erase their retained scores; score corrections are a separate organizer action.

Open **My competition progress** from a joined competition to see your own totals, rank, daily/cumulative charts with an exact data table, distinct venues/private labels, and five recent submitted meals. Everything comes from that competition's nonwithdrawn snapshots, not your newest private source revision or another competition. A meal shared with two competitions counts once in each respective view. Archiving its source does not remove either score.

Daily windows contain up to 30 calendar days, newest window first, using the competition's IANA time zone rather than your device's zone. **Older days** moves backward; each window displays days chronologically and includes zero days. Cumulative totals include all earlier submissions, even outside the displayed window. Daylight-saving transitions use local calendar boundaries, not assumed 24-hour days.

Places are grouped by venue ID or exact private-label text. Renamed or hidden directory venues still count once, with a retained snapshot label. Place lists show 20 records per page; standings show 20 participants. Page parameters range from 0 to 1000. Recent-meal links open your private source, which can have newer revisions than the submitted snapshot. Personal progress is available only to the current active member; public standings never include meal locations, notes, photos, daily activity, account IDs, or other competitions.

Results are **provisional** until the submission deadline is processed. After finalization, standings use the latest immutable result, and personal progress uses the latest corrected scores. Use **Refresh standings** or **Refresh progress** to request current results; there is no live push feed.

## Final recaps and score corrections

After the 24-hour grace period, a bounded background sweep publishes the first immutable recap. It checks up to 100 overdue competitions every minute and catches up after restarts. Recap requests also perform the same idempotent deadline catch-up under the competition lock. Before the cutoff, the recap is unavailable. Participant writes stop at the cutoff regardless of scheduler timing.

Open **Competition recap** for frozen rankings, totals, publication time, and calculation version. The first result freezes participant display names and the roster, including zero-score members and former members with retained submissions. Later profile edits or membership exclusions do not silently rewrite published participants. Equal tracked scores still share a rank. The revision list retains every previously published result; `?version=N` opens a specific revision.

Public recaps and revision history expose only result metadata, names, ranks, inches, and whole counts. Private competitions keep their existing visibility rules. Active members also see revision-specific meal/place counts, the largest submitted score, the highest-total local day, top visited places, and the correction audit. Public visitors never receive these details, private locations, correction reasons, photos, or account IDs.

After submissions close, only the competition organizer can use **Correct competition scores**. Supply a required, member-visible reason and either override the aggregate inches/whole count or exclude an entry from scoring. Every changed decision atomically publishes a new **revised** recap and records the actor, time, before/after scores, and result version. Unchanged retries retain their request key and return the original publication receipt rather than creating duplicate revisions.

Corrections are score decisions, not rewritten measurements: they never edit the private source, original item lines, location, photos, memberships, or another competition. A scoring-excluded entry counts zero but its already shared details and photos remain member-visible. Withdrawn entries cannot be corrected or reinstated. Restoring a scoring-excluded entry publishes another revision without erasing its exclusion history.

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

Directory browser checks cover private drafts, image validation/upload, and withdrawal. To include Admin approval, public photos, featured venues, hide/restore, and map-outage checks against a **disposable local database only**, set `E2E_DIRECTORY_DB_CONTAINER` to that Compose database container's name. This explicitly permits the test to bootstrap its own generated account as an Admin using `docker exec psql`; never point it at a real user database. CI enables this only on its ephemeral stack. `E2E_TEST_DB_CONTAINER` also enables audited role-management and Venue approver browser checks with synthetic accounts.

Meal browser checks cover measured scoring, private photos, access boundaries, and source archival. Set `E2E_TEST_DB_CONTAINER` only for a **disposable local database** to include explicit multi-competition snapshots, frozen submissions, and withdrawal. These fixtures use `docker exec psql` to shift their generated competitions' eating windows; they must never target a real user database. CI enables both database fixtures on its ephemeral stack.

The same disposable database flag enables progress and recap browser checks for shared ranks, zero-score members, private snapshot progress, finalization, historical revisions, organizer corrections, retry after an uncertain response, scoring exclusion/restoration, source isolation, and public-data boundaries.

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

`/api/v1/competitions/{id}/recap` accepts optional `version` and `page`; `/recap/history` lists published versions, and `/recap/highlights` exposes member-only details for the selected version. `/corrections` lists the member-visible audit. Organizer `POST /entries/{entry}/corrections` requires an entry `version`, durable `requestId`, integer-hundredth total, whole count, scoring-exclusion flag, reason, and CSRF header. Read responses are `no-store`.

`GET /api/v1/competitions/{id}/standings?page=0` returns the permitted public/private standings projection. `GET /api/v1/competitions/{id}/progress?dayPage=0&placePage=0` returns only the current active member's own progress. Both use a consistent read-only database snapshot and `Cache-Control: no-store`; neither accepts a target user selector.

## Self-hosting boundaries

The Compose files retain database data and reserve a Caddy profile for future HTTPS deployment. Only the development override publishes the gateway and database, both on loopback. Keep the public profile disabled until operational hardening, runtime provider checks, and backup/restore verification are complete.

Pi 2/3 production support is **not verified**. Check exact board/OS architecture, runtime image compatibility, memory, storage, and load before choosing it; use an existing local server if it cannot support the complete stack.

Public deployment also requires a free dynamic-DNS hostname, router forwarding, HTTPS, Google application configuration, working SMTP delivery, and independently stored, restore-tested backups. None is automatically provisioned by this repository.

Follow the [operations guide](ops/README.md) for redacted deployment preflight, consistent database-plus-media backups, non-destructive clean-project restores, interruption recovery, and upgrade/rollback boundaries. `npm run test:recovery` rehearses recovery using synthetic data on an explicitly allowed disposable local stack; CI runs it after browser acceptance.

The gateway applies no-referrer, frame-denial, and MIME-sniffing protections to application and error responses. It strips incoming proxy-forwarding headers, and Spring constructs sign-in destinations from the configured public origin. When configured, SMTP STARTTLS is required rather than silently downgraded. Production Compose services use bounded logs. These controls do not replace the real-host/network/provider checks above.
