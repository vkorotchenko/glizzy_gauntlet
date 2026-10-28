# Self-hosting operations

These tools prepare a single-host deployment; they do not provision a hostname, configure your router, register Google credentials, send a provider test email, or certify Raspberry Pi capacity. Keep the public profile disabled until you complete the gates below.

Use Node.js 24 and Docker Compose on the Docker host. Backup and restore use Docker directly, require the existing project-owned named volumes, and never read an environment file. Do not run maintenance from a remote Docker context: archive bind mounts must refer to the same host filesystem.

## Check the intended production host

Set runtime configuration privately, then run on the intended **64-bit Linux x86-64 or ARM64 host**:

```bash
npm run ops -- preflight --env-file .env
```

Preflight renders the base Compose configuration in memory and prints only hardware facts and redacted problems. It rejects the development override, host-published database/API/gateway/Mailpit ports, loopback or mismatched public origins, insecure cookies, placeholder database credentials, and incomplete sign-in configuration. `--development` exists to demonstrate rejection, not approve a development stack for production.

The current Java, Node, and PostgreSQL runtime tags publish Linux x86-64 and ARM64 images. Recheck upstream manifests when upgrading. A supported image is not a resource guarantee: Pi 2/3 production capacity remains unverified. Prefer a supported existing Linux server until the actual board, OS bitness, storage, and representative workload have passed measurement.

Before public use, record the actual host's RAM, available disk, architecture, Docker limits, idle and concurrent-use CPU/RAM, upload processing, finalization time, and backup duration. Leave room for PostgreSQL, the JVM, Node, image processing, operating-system caches, and recovery copies; do not infer a supported participant count from a successful startup. Configure reliable clock synchronization and disk/capacity alerts.

## Verify network and sign-in configuration

Use one free DDNS hostname you control. Point it at the actual public IP, configure automatic updates, and forward only TCP 80/443 to Caddy. Check the router and host firewall from outside the home network, including IPv6; never forward PostgreSQL, the gateway, Spring, Docker, or management ports.

Set `PUBLIC_HOSTNAME` to that hostname and `PUBLIC_BASE_URL` to exactly `https://` followed by the same hostname. Caddy issues the public certificate when DNS, forwarding, and certificate-authority access work. Verify HTTPS and HTTP-to-HTTPS redirection externally before inviting participants. Do not use the development override on a public host.

Register a Google web application with this exact redirect URI:

```text
https://YOUR_HOSTNAME/login/oauth2/code/google
```

Set the runtime Google client ID/secret, enable Google, and complete an actual sign-in and explicit identity-linking check. Changing the hostname requires updating both application configuration and the registered callback. Email addresses alone never merge accounts.

For email, configure the real sender, provider host, STARTTLS port, username, and runtime password/app password. Enable `SMTP_AUTH` and `SMTP_STARTTLS`; when STARTTLS is enabled, the application refuses a server that does not offer it before sending credentials or mail. Implicit-TLS port 465 is not configured. Verify actual inbox delivery, spam handling, provider quotas, link expiry, and confirmation from outside the network. Mailpit is not a production mail provider.

Do not paste credentials into command arguments, Git, screenshots, support logs, or this guide. Keep runtime configuration and its recovery copy protected independently of the application checkout. Preflight cannot verify provider authorization, mail delivery, DNS, firewall policy, certificate issuance, or independent backup storage.

After every gate passes, the base configuration can start the public edge:

```bash
docker compose -p glizzy-prod --env-file .env -f infra/compose.yaml --profile public up --build -d --wait
```

This command is a future operator action, not something the local rehearsal runs. Production services use bounded JSON logs: three files of at most 10 MiB per service. Check log rotation and storage monitoring on the selected host.

## Create a consistent backup

Choose a new directory outside the checkout, web roots, database, and media volume. Its parent must already exist. Backups contain private account identities, sessions, meal details, photos, and correction reasons.

```bash
npm run ops -- backup --project glizzy-prod --output /mnt/gauntlet-backups/manual-001
```

The tool locks maintenance for that Docker daemon/project, stops the originally running gateway and API, dumps PostgreSQL 17 in custom format, copies the entire media volume, and writes SHA-256 digests and image identities in `manifest.json`. The completion manifest appears only after both copies finish. Files are owner-only and backups inside the repository are refused.

Stopping the API also stops scheduled finalization and lets database transactions complete or roll back before the copies. This assumes no other process writes directly to the database or media volume. The site is briefly unavailable; unchanged mutation retries retain their normal idempotency guarantees.

After an ordinary command failure or success, the tool attempts to restart only services that were running before maintenance, API first. A failed/incomplete backup without a valid manifest is not a restore point. If restart fails, inspect health and recover manually; do not assume the website is available merely because the files exist.

Copy **all three files together** to independently stored, encrypted storage. The files are plaintext private data: owner-only permissions and corruption checks are not encryption or authenticity protection. Restore only trusted backups. A second folder on the same host/disk does not protect against host loss, theft, or disk failure. Configure an appropriate schedule/retention policy on your chosen storage and periodically rehearse a restore.

## Restore without overwriting existing data

Use a **different, empty Compose project** and the backed-up application revision. Keep both API and gateway stopped while restoring. Do not point the command at your existing production project or reuse populated database/media volumes.

```bash
docker compose -p glizzy-restore --env-file .env -f infra/compose.yaml build api gateway
docker compose -p glizzy-restore --env-file .env -f infra/compose.yaml create api gateway
docker compose -p glizzy-restore --env-file .env -f infra/compose.yaml up -d --wait db
npm run ops -- restore --project glizzy-restore --input /mnt/gauntlet-backups/manual-001
```

Restore verifies owner-only regular files, checksums, PostgreSQL major version, project/volume ownership, stopped writers, an empty database, and an empty media volume. It rejects archive traversal and link entries; only the application's regular UUID-named JPEGs are allowed. Media is extracted first, then PostgreSQL restores with a single transaction and no automatic schema/data deletion.

The target API/gateway remain stopped after success or failure. If extraction or database restore fails, leave that target offline and retry into another fresh project; the tool never deletes a partial restore to make a retry work. An image ID in the manifest is a recovery reference, not a promise that an older binary can read a newer schema.

Start only the recovered internal services for verification:

```bash
docker compose -p glizzy-restore --env-file .env -f infra/compose.yaml up -d --wait db api gateway
```

Verify health, account/session continuity, counts, source revisions, immutable result history, correction audit, and exact photo bytes before routing traffic. Test owner/member/anonymous access again. Use a private HTTPS endpoint with appropriate origin/provider configuration for real-data browser checks; do not disable Secure cookies or apply the development override to a production restore.

For a planned cutover, first stop the old gateway/API explicitly, then take the final backup. Backup preserves their originally stopped state, preventing writes after the snapshot. Keep the old stack offline while validating the recovered target. Switch DNS/edge routing only after verification, and never expose both writable copies of the same competition database.

Backups do not include runtime secrets, Caddy certificate state, Mailpit, or host/DDNS configuration. Keep a separate protected recovery record for those. Caddy can reissue certificates when the hostname remains valid, subject to certificate-authority limits.

## Recover interrupted maintenance

An abruptly killed process or host failure can leave writers stopped and a maintenance lock container behind. Do not remove a lock while another backup/restore is active.

```bash
docker ps -a --filter label=com.glizzygauntlet.maintenance=glizzy-prod
docker compose -p glizzy-prod --env-file .env -f infra/compose.yaml ps -a
```

After confirming no maintenance process is still running, remove only the displayed lock container by its exact ID. For an interrupted backup, discard the incomplete copy only after checking its manifest, then restore the original service state. Never start a failed restore target simply to clear maintenance.

## Upgrade and rollback

Pin and record the application commit/image identities and PostgreSQL major version. Stop writers, create an independent pre-upgrade backup, and verify it before upgrading. Keep base Compose volumes and runtime configuration intact; never use `down --volumes` on a production project as an upgrade step.

Flyway applies migrations when the API starts. An application rollback is safe only when the older binary supports the migrated schema. Otherwise restore the pre-upgrade database **and media together into fresh volumes** with its matching application revision, verify privately, then cut over. Do not automatically reverse migrations or mix an old database with newer photo files.

## Run the disposable recovery rehearsal

With an isolated loopback development stack running:

```bash
RECOVERY_TEST_DISPOSABLE=1 \
RECOVERY_SOURCE_PROJECT=YOUR_DISPOSABLE_PROJECT \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
MAILPIT_BASE_URL=http://127.0.0.1:8025 \
npm run test:recovery
```

This test creates synthetic accounts/meals/photos/results, shifts only its generated competition windows, backs up the source, and restores into a uniquely named project with new volumes. It rejects a corrupt backup and a populated restore target, verifies restored sessions, private access, exact photo bytes, recaps/audit, and mutation replay, then removes only its disposable target and private test backups. `RECOVERY_TARGET_PORT` overrides the target's default loopback port 3113.

Never run it against a real user database. CI runs it after the browser suite on its ephemeral stack. Passing a local rehearsal proves the tested recovery path, not production hardware capacity, external-provider readiness, or independent storage recovery.
