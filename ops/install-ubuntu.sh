#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: bash ops/install-ubuntu.sh --domain HOSTNAME [--ssh-port PORT]

Run from a checkout on a fresh 64-bit Ubuntu server as a non-root sudo user.
Installs Docker/Compose and Node.js 24, installs locked Node dependencies, and
creates a private .env if none exists. Existing configuration is not read or
changed. Sign-in credentials and public deployment remain manual.

--domain HOSTNAME  Canonical public hostname, without a scheme or path.
--ssh-port PORT    Explicitly configure and enable UFW for this SSH port and
                   HTTP/HTTPS. Omit to leave all firewall settings unchanged.
--help            Show this help without changing the host.
EOF
}

fail() {
  printf 'Installer: %s\n' "$*" >&2
  exit 1
}

domain=''
ssh_port=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain|--ssh-port)
      [[ $# -ge 2 && -n "$2" ]] || fail "$1 requires a value."
      if [[ "$1" == --domain ]]; then domain=$2; else ssh_port=$2; fi
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1. Use --help." ;;
  esac
done

domain=$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')
hostname_pattern='^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$'
[[ ${#domain} -le 253 && "$domain" =~ $hostname_pattern ]] ||
  fail "Supply --domain with a public DNS hostname, not a URL."
case "$domain" in
  *.localhost|*.local|*.test|*.invalid|*.example)
    fail "Use a real public DNS hostname."
    ;;
esac
if [[ -n "$ssh_port" ]]; then
  [[ "$ssh_port" =~ ^[1-9][0-9]{0,4}$ ]] && (( ssh_port <= 65535 )) ||
    fail "--ssh-port must be an integer from 1 to 65535."
  if [[ -n "${SSH_CONNECTION:-}" && "${SSH_CONNECTION##* }" != "$ssh_port" ]]; then
    fail "--ssh-port does not match the current SSH session; firewall unchanged."
  fi
fi

[[ "$(uname -s)" == Linux ]] || fail "Run on the intended Ubuntu server, not your local workstation."
[[ "$(id -u)" != 0 ]] || fail "Run as a non-root user with sudo access, not sudo bash."
os_id=$(awk -F= '$1 == "ID" {gsub(/"/, "", $2); print $2}' /etc/os-release)
codename=$(awk -F= '$1 == "VERSION_CODENAME" {gsub(/"/, "", $2); print $2}' /etc/os-release)
[[ "$os_id" == ubuntu ]] || fail "Only Ubuntu is supported."
case "$codename" in
  jammy|noble|resolute|stonking) ;;
  *) fail "Use a supported Ubuntu release: 22.04, 24.04, 26.04, or 26.10." ;;
esac
architecture=$(dpkg --print-architecture)
case "$architecture" in
  amd64|arm64) ;;
  *) fail "A 64-bit x86-64 or ARM64 host is required." ;;
esac

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd -- "$repo"
[[ -f .env.example && -f package-lock.json && -f infra/compose.yaml ]] ||
  fail "Run the installer from a complete Glizzy Gauntlet checkout."
if [[ -e .env || -L .env ]]; then
  [[ -f .env && ! -L .env && -O .env ]] ||
    fail "Existing .env must be a regular file owned by the current user, not a symlink."
fi

temporary=$(mktemp -d "$repo/.env.install.XXXXXX")
trap 'rm -f -- "$temporary/docker.asc" "$temporary/nodesource.asc" "$temporary/nodesource.gpg" "$temporary/environment"; rmdir -- "$temporary"' EXIT

sudo -v
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git make nano openssl ufw
sudo install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$temporary/docker.asc"
sudo install -m 0644 "$temporary/docker.asc" /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codename
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF

curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  -o "$temporary/nodesource.asc"
gpg --batch --yes --dearmor -o "$temporary/nodesource.gpg" "$temporary/nodesource.asc"
sudo install -m 0644 "$temporary/nodesource.gpg" /etc/apt/keyrings/nodesource.gpg
printf '%s\n' \
  'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' \
  | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' \
  | sudo tee /etc/apt/preferences.d/nodejs >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin nodejs
[[ "$(node --version)" == v24.* ]] || fail "Node.js 24 is required; check the package repositories."
sudo systemctl enable --now docker
sudo docker info >/dev/null
sudo docker compose version
sudo usermod -aG docker "$(id -un)"
npm ci

if [[ -e .env || -L .env ]]; then
  printf 'Existing .env preserved without reading or changing it; verify its hostname and permissions.\n'
else
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      POSTGRES_PASSWORD=*)
        printf 'POSTGRES_PASSWORD='
        openssl rand -hex 32
        ;;
      PUBLIC_HOSTNAME=*) printf 'PUBLIC_HOSTNAME=%s\n' "$domain" ;;
      PUBLIC_BASE_URL=*) printf 'PUBLIC_BASE_URL=https://%s\n' "$domain" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.example > "$temporary/environment"
  # A hard link publishes the complete private file without replacing a racing writer.
  ln -T -- "$temporary/environment" .env
  printf 'Created owner-only .env with a generated database password; no credentials printed.\n'
fi

if [[ -n "$ssh_port" ]]; then
  sudo ufw allow "$ssh_port/tcp"
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw --force enable
else
  printf 'Firewall unchanged. Configure SSH and TCP 80/443 before deployment.\n'
fi

cat <<EOF

Host bootstrap complete; the public application has NOT been deployed.
Log out and reconnect before using Docker without sudo. Docker-group membership
grants root-equivalent access; grant it only to trusted administrators.

Next, from this checkout:
  chmod 600 .env
  nano .env

Configure at least one real sign-in provider; both remain disabled in a new .env.
For Google, register https://$domain/login/oauth2/code/google
Point DNS at this server, check provider/router firewalls, and retain SSH access.
Docker-published ports can bypass UFW; publish only Caddy's TCP 80/443.

After provider setup and the operations guide's launch gates:
  make preflight ENV_FILE=.env
  make deploy ENV_FILE=.env PROD_PROJECT=glizzy-prod
  make deploy-status ENV_FILE=.env PROD_PROJECT=glizzy-prod

If migrating existing users, restore PostgreSQL AND media into empty volumes
before deployment. Arrange encrypted off-server backups and a restore rehearsal.
Do not use the development stack targets on this server. See ops/README.md.
EOF
