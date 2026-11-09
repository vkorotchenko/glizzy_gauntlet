#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

usage() {
  cat <<'EOF'
Usage: bash ops/install-ubuntu.sh --interactive [--configure-only]
       bash ops/install-ubuntu.sh --domain HOSTNAME [--ssh-port PORT]

Run from a checkout on a fresh 64-bit Ubuntu server as a non-root sudo user.
Installs Docker/Compose and Node.js 24, installs locked Node dependencies, and
creates a private .env if none exists. Unattended runs preserve existing .env.
Public deployment remains manual.

--interactive     Prompt for server, SMTP/Google, firewall, and DHCP guidance.
--configure-only  Run the wizard without installing or updating host packages.
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

prompt() {
  local label=$1 default=${2:-} secret=${3:-false}
  printf '%s' "$label" >&2
  if [[ -n "$default" && "$secret" == false ]]; then printf ' [%s]' "$default" >&2; fi
  printf ': ' >&2
  if [[ "$secret" == true ]]; then
    IFS= read -r -s answer || fail "Input ended; setup cancelled."
    printf '\n' >&2
  else
    IFS= read -r answer || fail "Input ended; setup cancelled."
  fi
  answer=${answer:-$default}
  [[ "$answer" != *$'\r'* ]] || fail "Carriage returns are not supported in settings."
}

confirm() {
  while true; do
    prompt "$1 (y/N)" N
    case "$answer" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) printf 'Answer yes or no.\n' >&2 ;;
    esac
  done
}

valid_hostname() {
  local pattern='^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$'
  [[ ${#1} -le 253 && "$1" =~ $pattern ]] || return 1
  case "$1" in *.localhost|*.local|*.test|*.invalid|*.example) return 1 ;; esac
}

valid_port() {
  [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && (( $1 <= 65535 ))
}

valid_ssh_port() {
  local connection=${SSH_CONNECTION:-}
  valid_port "$1" &&
    [[ -z "$connection" || "${connection##* }" == "$1" ]]
}

write_setting() {
  local encoded=$2
  encoded=${encoded//\\/\\\\}
  encoded=${encoded//\"/\\\"}
  encoded=${encoded//\$/\$\$}
  printf '%s="%s"\n' "$1" "$encoded"
}

dhcp_guidance() {
  local route='' interface='' address='' gateway='' mac='' index
  local fields=()
  printf '\nDHCP reservations are created on your router or DHCP server, not this Ubuntu host.\n'
  if command -v ip >/dev/null 2>&1; then
    route=$(ip -4 route get 1.1.1.1 2>/dev/null || true)
    if [[ -n "$route" ]]; then
      read -r -a fields <<< "$route"
      for (( index=0; index+1<${#fields[@]}; index++ )); do
        case "${fields[index]}" in
          dev) interface=${fields[index+1]} ;;
          src) address=${fields[index+1]} ;;
          via) gateway=${fields[index+1]} ;;
        esac
      done
    fi
    if [[ -n "$interface" ]]; then
      route=$(ip -o link show dev "$interface" 2>/dev/null || true)
      if [[ -n "$route" ]]; then
        read -r -a fields <<< "$route"
        for (( index=0; index+1<${#fields[@]}; index++ )); do
          if [[ "${fields[index]}" == link/ether ]]; then mac=${fields[index+1]}; fi
        done
      fi
    fi
  fi
  if [[ -z "$interface" || -z "$address" || -z "$mac" ]]; then
    printf 'Could not discover an Ethernet/Wi-Fi IPv4 interface. Check ip -4 route and ip link on the server.\n'
    printf 'Use those details in your router DHCP reservation/static lease page; no reservation has been made.\n'
    return
  fi
  printf 'Interface: %s\nCurrent LAN IPv4: %s\nMAC address: %s\nGateway: %s\n' \
    "$interface" "$address" "$mac" "${gateway:-not reported}"
  printf 'In your router DHCP reservation/static lease page, reserve %s for %s.\n' "$address" "$mac"
  printf 'Use the DHCP client identifier instead if your router requires it; Ubuntu may use a DUID.\n'
  printf 'Check for conflicts and save the reservation. Do not assign a different address during this SSH session.\n'
  printf 'On a cloud server, use the provider reserved-IP feature instead of changing guest networking.\n'
  if confirm "Have you saved the reservation on the router/DHCP server"; then
    printf 'Reservation reported saved by the operator; it has not been verified through a router API.\n'
  else
    printf 'Reservation remains pending. Complete it on your router before relying on a stable LAN address.\n'
  fi
  printf 'No IP, Netplan configuration, DHCP lease, or interface was changed or renewed.\n'
  printf 'Public DNS still needs your public/WAN IP; forward TCP 80/443 to the reserved LAN IP if behind NAT.\n'
}

domain=''
ssh_port=''
interactive=false
configure_only=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain|--ssh-port)
      [[ $# -ge 2 && -n "$2" ]] || fail "$1 requires a value."
      if [[ "$1" == --domain ]]; then domain=$2; else ssh_port=$2; fi
      shift 2
      ;;
    --interactive) interactive=true; shift ;;
    --configure-only) configure_only=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1. Use --help." ;;
  esac
done

[[ "$configure_only" == false || "$interactive" == true ]] ||
  fail "--configure-only requires --interactive."
domain=$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')
[[ "$interactive" == true ]] || valid_hostname "$domain" ||
  fail "Supply --domain with a public DNS hostname, not a URL."
if [[ -n "$ssh_port" ]]; then
  valid_ssh_port "$ssh_port" ||
    fail "--ssh-port must be 1-65535 and match the current SSH session; firewall unchanged."
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

update_config=false
smtp_host='' smtp_port='' smtp_from='' smtp_username='' smtp_password=''
google_id='' google_secret='' media_bytes='' guide_dhcp=false
if [[ "$interactive" == true ]]; then
  while true; do
    prompt "Public hostname (no scheme or path)" "${domain:-glizzy-gauntlet.com}"
    domain=$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')
    if valid_hostname "$domain"; then break; fi
    printf 'Enter a public DNS hostname, not a URL or reserved local name.\n' >&2
  done
  if [[ ! -e .env ]] || confirm "Update public/provider settings in existing .env, preserving the database password"; then
    update_config=true
    if confirm "Configure authenticated STARTTLS SMTP now (No keeps existing settings)"; then
      while true; do
        prompt "SMTP server hostname or IPv4 address"
        smtp_host=$answer
        if [[ "$smtp_host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] &&
          [[ "$smtp_host" != localhost && "$smtp_host" != 127.* ]]; then break; fi
        printf 'Enter a non-loopback provider hostname or IPv4 address, not a URL.\n' >&2
      done
      while true; do
        prompt "SMTP STARTTLS port (implicit TLS/465 is unsupported)" 587
        smtp_port=$answer
        if valid_port "$smtp_port" && [[ "$smtp_port" != 465 ]]; then break; fi
        printf 'Enter a STARTTLS port from 1-65535 other than 465.\n' >&2
      done
      while true; do
        prompt "Sender email address" "noreply@$domain"
        smtp_from=$answer
        if [[ "$smtp_from" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then break; fi
        printf 'Enter a bare sender email address.\n' >&2
      done
      while [[ -z "$smtp_username" ]]; do prompt "SMTP username"; smtp_username=$answer; done
      while [[ -z "$smtp_password" ]]; do prompt "SMTP password/app password (hidden)" '' true; smtp_password=$answer; done
    fi
    if confirm "Configure Google sign-in now (No keeps existing settings)"; then
      while true; do
        prompt "Google Web client ID"
        google_id=$answer
        if [[ "$google_id" == *.apps.googleusercontent.com ]]; then break; fi
        printf 'Enter the registered Google Web client ID.\n' >&2
      done
      while [[ -z "$google_secret" ]]; do prompt "Google client secret (hidden)" '' true; google_secret=$answer; done
    fi
    while true; do
      prompt "Photo budget in MiB (blank keeps existing/default budget)"
      if [[ -z "$answer" ]]; then break; fi
      if [[ "$answer" =~ ^[1-9][0-9]{0,6}$ ]]; then media_bytes=$(( answer * 1048576 )); break; fi
      printf 'Enter a positive whole number of MiB.\n' >&2
    done
  fi
  if [[ -z "$ssh_port" ]] && confirm "Configure and enable the UFW firewall"; then
    connection=${SSH_CONNECTION:-}
    while true; do
      prompt "Actual SSH port" "${connection##* }"
      ssh_port=${answer:-22}
      if valid_ssh_port "$ssh_port"; then break; fi
      printf 'Enter a valid port matching the current SSH session.\n' >&2
    done
  fi
  if confirm "Show router-side DHCP reservation guidance"; then guide_dhcp=true; fi
fi

temporary=$(mktemp -d "$repo/.env.install.XXXXXX")
trap 'rm -f -- "$temporary/docker.asc" "$temporary/nodesource.asc" "$temporary/nodesource.gpg" "$temporary/environment" "$temporary/original"; rmdir -- "$temporary"' EXIT

install_packages() {
  sudo -v
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg git make nano openssl ufw iproute2
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
}
if [[ "$configure_only" == false ]]; then install_packages; fi

if [[ "$guide_dhcp" == true ]]; then dhcp_guidance; fi

existing_config=false
if [[ -e .env || -L .env ]]; then existing_config=true; fi
if [[ "$existing_config" == true && "$update_config" == false ]]; then
  printf 'Existing .env preserved without reading or changing it; verify its hostname and permissions.\n'
else
  if [[ "$existing_config" == true ]]; then
    [[ -f .env && ! -L .env && -O .env ]] || fail "Configuration changed during setup."
    cp -- .env "$temporary/original"
    cat -- "$temporary/original" > "$temporary/environment"
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
  fi
  if [[ "$update_config" == true ]]; then
    {
      printf '\n# Interactive installer overrides (last definition wins).\n'
      write_setting PUBLIC_HOSTNAME "$domain"
      write_setting PUBLIC_BASE_URL "https://$domain"
      if [[ -n "$smtp_host" ]]; then
        printf 'EMAIL_ENABLED=true\nSMTP_AUTH=true\nSMTP_STARTTLS=true\n'
        write_setting MAIL_FROM "$smtp_from"
        write_setting SMTP_HOST "$smtp_host"
        write_setting SMTP_PORT "$smtp_port"
        write_setting SMTP_USERNAME "$smtp_username"
        write_setting SMTP_PASSWORD "$smtp_password"
      fi
      if [[ -n "$google_id" ]]; then
        printf 'GOOGLE_ENABLED=true\n'
        write_setting GOOGLE_CLIENT_ID "$google_id"
        write_setting GOOGLE_CLIENT_SECRET "$google_secret"
      fi
      if [[ -n "$media_bytes" ]]; then write_setting MEDIA_MAX_BYTES "$media_bytes"; fi
    } >> "$temporary/environment"
    chmod 600 "$temporary/environment"
    sudo docker compose --env-file "$temporary/environment" -f infra/compose.yaml --profile public config --quiet \
      >/dev/null 2>&1 || fail "Compose rejected the candidate configuration; existing .env is unchanged."
  fi
  if [[ "$existing_config" == true ]]; then
    [[ -f .env && ! -L .env && -O .env ]] && cmp -s .env "$temporary/original" ||
      fail "Configuration changed during setup; no update written."
    mv -T -- "$temporary/environment" .env
    printf 'Updated owner-only .env; database password and original settings preserved.\n'
  else
    # A hard link publishes the complete private file without replacing a racing writer.
    ln -T -- "$temporary/environment" .env
    printf 'Created owner-only .env with a generated database password; no credentials printed.\n'
  fi
fi
unset smtp_password google_secret

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

Setup complete; the public application has NOT been deployed.
Log out and reconnect before using Docker without sudo. Docker-group membership
grants root-equivalent access; grant it only to trusted administrators.

Next, from this checkout:
  chmod 600 .env
  nano .env

Verify at least one real sign-in provider and actual email delivery before launch.
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
