# Self-hosting operations

These tools prepare a single-host deployment; they do not provision a hostname, configure your router, register Google credentials, send a provider test email, or certify Raspberry Pi capacity. Keep the public profile disabled until you complete the gates below.

Use Node.js 24 and Docker Compose on the Docker host. Backup and restore use Docker directly, require the existing project-owned named volumes, and never read an environment file. Do not run maintenance from a remote Docker context: archive bind mounts must refer to the same host filesystem.

## Bootstrap a fresh Ubuntu server

Run these commands **on the server**, as a non-root user with sudo access. The installer supports Ubuntu 22.04, 24.04, 26.04, and 26.10 on x86-64 or ARM64. It is a fresh-host bootstrap, not a production upgrade procedure. Apply Ubuntu security updates and any required reboot separately.

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/vkorotchenko/glizzy_gauntlet.git
cd glizzy_gauntlet
bash ops/install-ubuntu.sh --interactive
```

The script installs Docker Engine/Compose and Node.js 24 from signed package repositories, enables Docker at boot, adds the current user to the Docker group, and runs `npm ci`. Docker-group membership grants root-equivalent access; only trusted administrators should receive it. Log out and reconnect before using Docker without sudo.

The wizard prompts for the public hostname, authenticated STARTTLS SMTP server/port, sender, username, hidden password, optional Google Web client credentials, photo-storage budget, firewall configuration, and DHCP reservation guidance. SMTP uses authentication and required STARTTLS; port 465 is rejected because implicit TLS is not configured. Register your sender/domain with the provider and verify real inbox delivery separately.

It creates an owner-only `.env` from `.env.example` and generates a random database password without printing it or passing it in command arguments. Passwords and Google secrets are read without terminal echo, shell tracing is disabled, and entered values are escaped for Compose, including dollar signs, quotes, and backslashes.

On an existing host, rerun **only configuration**, without reinstalling/upgrading packages:

```bash
bash ops/install-ubuntu.sh --interactive --configure-only
```

Changing an existing `.env` requires explicit consent. The wizard preserves the original contents and database password, appends selected overrides (last definition wins), validates the private candidate with Compose without printing it, and replaces the file atomically with owner-only permissions. An observed concurrent edit aborts the replacement. Original values, including superseded credentials, remain in earlier sections; remove retired credentials privately when appropriate. Declining a provider prompt keeps its existing settings rather than disabling it. No provider is enabled by default in a new file.

For unattended bootstrap, the original interface remains available:

```bash
bash ops/install-ubuntu.sh --domain glizzy-gauntlet.com
```

Unattended runs never read or change existing `.env` files or their permissions. Symlinked or foreign-owned configuration is rejected in all modes. Rerunning bootstrap can update installed packages, so use configuration-only mode or the upgrade procedure below for an existing production host.

Firewall settings are unchanged unless selected in the wizard or explicitly requested by flag. To allow your SSH port and HTTP/HTTPS, then enable UFW:

```bash
bash ops/install-ubuntu.sh --domain glizzy-gauntlet.com --ssh-port 2222
```

Replace `2222` with the actual SSH port. A mismatch with an available `SSH_CONNECTION` is rejected before host changes. Keep your current connection open and verify a second SSH connection. Existing UFW rules are retained, so review them; this is not a firewall audit. Docker-published ports can bypass UFW. Configure the provider/router firewall separately, restrict SSH, and publish only Caddy's TCP 80/443.

The DHCP step discovers the default-route interface, current LAN IPv4 address, MAC address, and gateway, then explains how to add that address as a reservation/static lease on your router or DHCP server. It distinguishes operator confirmation from verified reservation status. Ubuntu may use a DHCP client ID/DUID rather than the MAC; follow your router's requirements. Missing network details leave the reservation explicitly pending.

**A DHCP reservation cannot be created generically from the Ubuntu server.** This wizard does not collect router credentials, call a router API, edit Netplan, assign a static IP, renew a lease, or restart networking. Save the reservation in your router, check for conflicts, and keep the current address during SSH setup. On cloud hosts, use the provider's reserved-IP feature. LAN reservation does not reserve a public/WAN IP: DNS still points to the public address, and a home router must forward TCP 80/443 to the reserved LAN address.

The installer **does not deploy the site**, configure DNS, verify provider authorization, or send a test email. Complete the launch gates below. For Google, register `https://glizzy-gauntlet.com/login/oauth2/code/google`.

After verifying providers, capacity, external networking, and recovery preparation:

```bash
make preflight ENV_FILE=.env
make deploy ENV_FILE=.env PROD_PROJECT=glizzy-prod
make deploy-status ENV_FILE=.env PROD_PROJECT=glizzy-prod
```

If moving existing users, restore PostgreSQL and media together into empty volumes before starting writers. Bootstrap your first Admin as described in the root README, using the production project and base Compose file, not the development override.

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

After preparing recovery and checking CI for the intended release, run from a clean server checkout on `main`:

```bash
make deploy-latest ENV_FILE=/private/glizzy.env PROD_PROJECT=glizzy-prod
make deploy-status ENV_FILE=/private/glizzy.env PROD_PROJECT=glizzy-prod
```

The target fetches `origin/main`, refuses staged/unstaged/untracked changes and local commits ahead of or diverged from the fetched revision, then fast-forwards the current branch without resetting or discarding files. Detached checkouts and other branches are refused. `DEPLOY_BRANCH` selects another branch if needed; both the checkout and remote must have that branch. The fetched commit is printed before locked Node dependencies are refreshed and the updated Makefile's `deploy` target is invoked. It does not check CI, back up data, update Ubuntu packages, or automatically roll back.

Deployment runs production preflight and builds API/gateway images before replacing containers. If dependency installation, preflight, or image building fails, existing containers are not replaced; the checkout may already contain the new revision. API startup applies migrations and can still fail after replacement, so retain the backup and previous image identities. If writers were stopped for a final backup, leave them stopped until the intended revision is ready.

Flyway applies migrations when the API starts. An application rollback is safe only when the older binary supports the migrated schema. Otherwise restore the pre-upgrade database **and media together into fresh volumes** with its matching application revision, verify privately, then cut over. Do not automatically reverse migrations or mix an old database with newer photo files.

### Downtime boundaries

The current deployment is **not zero-downtime**: there is one gateway and one API, and Compose replaces them before the new instances are ready. Building first keeps a running site available during image compilation, but container replacement, JVM startup, migrations, and consistent backups can still interrupt requests. Budget memory and disk for a build alongside the running stack.

Zero-downtime application updates would require a separately implemented blue/green deployment: start and health-check a second gateway/API pair, switch Caddy routing without stopping the edge, drain in-flight requests, then stop the old pair. Both revisions must support the shared database, sessions, and media; migrations must follow an expand/contract strategy compatible with both versions, and scheduled jobs/storage concurrency must be safe with two APIs running. Merely scaling Compose or switching images cannot guarantee this. PostgreSQL upgrades and the current stop-writers backup procedure need their own availability strategy.

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
