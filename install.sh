#!/usr/bin/env bash
# =============================================================================
# GILEH KORD - Ubuntu SSH Deployment, Dual HTTP/HTTPS & SSL Management Menu
# =============================================================================

set -u

APP_NAME="gileh-kord"
SERVICE_NAME="gileh-kord.service"
REPO_URL="${GILEH_REPO_URL:-https://github.com/sahand363/gileh-kord.git}"
APP_DIR="/opt/gileh-kord"
DATA_DIR="/var/lib/gileh-kord"
CONFIG_DIR="/etc/gileh-kord"
CONFIG_FILE="${CONFIG_DIR}/config.env"

NGINX_IP_AVAILABLE="/etc/nginx/sites-available/${APP_NAME}-ip"
NGINX_IP_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}-ip"
NGINX_DOMAIN_AVAILABLE="/etc/nginx/sites-available/${APP_NAME}-domain"
NGINX_DOMAIN_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}-domain"
LEGACY_NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}"
CLI_SHORTCUT="/usr/local/bin/gk"

DEFAULT_PORT="3000"
DEFAULT_DOMAIN="gilehkord.modesehramiz.ir"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    log_error "Please run this script as root or with sudo: sudo bash install.sh"
    exit 1
  fi
}

load_or_init_config() {
  mkdir -p "${CONFIG_DIR}" "${DATA_DIR}"
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    cat > "${CONFIG_FILE}" <<EOF
PORT=${DEFAULT_PORT}
HOST=0.0.0.0
DOMAIN=${DEFAULT_DOMAIN}
GILEH_DATA_DIR=${DATA_DIR}
EOF
    chmod 640 "${CONFIG_FILE}"
  fi
  sed -i 's/^HOST=127\.0\.0\.1/HOST=0.0.0.0/' "${CONFIG_FILE}" 2>/dev/null || true
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
  if [[ "${DOMAIN:-_}" == "_" || -z "${DOMAIN:-}" ]]; then
    DOMAIN="${DEFAULT_DOMAIN}"
  fi
}

get_server_ip() {
  local ip=""
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [[ -z "${ip}" ]]; then
    ip=$(curl -4 -fsSL --max-time 2 ifconfig.me 2>/dev/null || echo "YOUR_SERVER_IP")
  fi
  echo "${ip}"
}

get_service_state() {
  if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    echo -e "${GREEN}RUNNING${NC}"
  else
    echo -e "${RED}STOPPED${NC}"
  fi
}

get_ssl_state() {
  load_or_init_config
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    echo -e "${GREEN}ACTIVE (https://${DOMAIN})${NC}"
  else
    echo -e "${YELLOW}NOT CONFIGURED (HTTP IP & HTTP Domain Active)${NC}"
  fi
}

install_cli_shortcut() {
  if [[ -f "${APP_DIR}/install.sh" ]]; then
    cp -f "${APP_DIR}/install.sh" "${CLI_SHORTCUT}"
    chmod +x "${CLI_SHORTCUT}"
  fi
}

install_system_dependencies() {
  local need_apt=0
  for cmd in curl git nginx; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
      need_apt=1
    fi
  done

  if [[ "${need_apt}" -eq 1 ]]; then
    log_info "Installing required system packages (curl, git, nginx)..."
    DEBIAN_FRONTEND=noninteractive apt-get update -y -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates gnupg nginx dnsutils
  else
    log_info "Core system packages (curl, git, nginx) already installed."
  fi

  local install_node=0
  if ! command -v node >/dev/null 2>&1; then
    install_node=1
  else
    local node_major
    node_major=$(node -v | cut -d. -f1 | tr -d 'v')
    if [[ "${node_major}" -lt 18 ]]; then
      install_node=1
    fi
  fi

  if [[ "${install_node}" -eq 1 ]]; then
    log_info "Installing Node.js 20.x LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
  fi
}

resolve_port80_conflicts() {
  for svc in caddy apache2 lighttpd; do
    if systemctl is-active --quiet "${svc}" 2>/dev/null; then
      log_warn "Stopping conflicting web server (${svc}) on port 80..."
      systemctl stop "${svc}" 2>/dev/null || true
      systemctl disable "${svc}" 2>/dev/null || true
    fi
  done
}

configure_firewall() {
  load_or_init_config
  if command -v ufw >/dev/null 2>&1; then
    if ufw status 2>/dev/null | grep -q "Status: active"; then
      log_info "Ensuring ports 80, 443, and ${PORT} are open in UFW..."
      ufw allow 80/tcp >/dev/null 2>&1 || true
      ufw allow 443/tcp >/dev/null 2>&1 || true
      ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
    fi
  fi
}

setup_systemd_service() {
  load_or_init_config
  log_info "Configuring systemd service (${SERVICE_NAME})..."
  cat > "/etc/systemd/system/${SERVICE_NAME}" <<EOF
[Unit]
Description=GILEH KORD Restaurant Purchase Management Web App
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${CONFIG_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/server.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
}

# Configures dual Nginx blocks so HTTP IP access NEVER redirects to HTTPS,
# while the configured domain works on HTTP and (if SSL cert exists) HTTPS.
setup_nginx_proxy() {
  load_or_init_config
  resolve_port80_conflicts
  rm -f "${LEGACY_NGINX_ENABLED}" /etc/nginx/sites-enabled/default

  log_info "Configuring Nginx IP block (http://$(get_server_ip) -> 127.0.0.1:${PORT}, NO HTTPS redirect)..."
  cat > "${NGINX_IP_AVAILABLE}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf "${NGINX_IP_AVAILABLE}" "${NGINX_IP_ENABLED}"

  if [[ -n "${DOMAIN}" && "${DOMAIN}" != "_" ]]; then
    if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" && -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]]; then
      log_info "SSL certificate found for ${DOMAIN}. Configuring HTTPS domain block..."
      cat > "${NGINX_DOMAIN_AVAILABLE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
    else
      log_info "Configuring HTTP domain block for ${DOMAIN} (SSL not issued yet)..."
      cat > "${NGINX_DOMAIN_AVAILABLE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    fi
    ln -sf "${NGINX_DOMAIN_AVAILABLE}" "${NGINX_DOMAIN_ENABLED}"
  fi

  if nginx -t; then
    systemctl enable nginx >/dev/null 2>&1 || true
    systemctl reload nginx || systemctl restart nginx
  else
    log_error "Nginx configuration test failed. Inspect ${NGINX_IP_AVAILABLE} and ${NGINX_DOMAIN_AVAILABLE}."
    return 1
  fi
}

build_frontend() {
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Directory ${APP_DIR} not found. Run option 1 (Install) first."
    return 1
  fi
  cd "${APP_DIR}" || return 1
  log_info "Installing npm packages..."
  npm install --no-audit --no-fund --prefer-offline --loglevel=error
  log_info "Building production frontend bundle..."
  npm run build
}

option_install() {
  require_root
  install_system_dependencies
  load_or_init_config

  if [[ -d "${APP_DIR}/.git" ]]; then
    log_info "Updating existing repository in ${APP_DIR}..."
    cd "${APP_DIR}" && git fetch --depth 1 origin && git reset --hard origin/main
  elif [[ -f "./package.json" && -f "./server.mjs" ]]; then
    log_info "Copying project files into ${APP_DIR}..."
    mkdir -p "${APP_DIR}"
    cp -r ./* "${APP_DIR}/"
  else
    log_info "Cloning repository into ${APP_DIR}..."
    rm -rf "${APP_DIR}"
    git clone --depth 1 "${REPO_URL}" "${APP_DIR}"
  fi

  build_frontend || return 1
  setup_systemd_service
  setup_nginx_proxy
  configure_firewall
  install_cli_shortcut
  systemctl restart "${SERVICE_NAME}"

  log_info "Installation complete! Both HTTP IP and Domain configs are ready."
}

option_update() {
  require_root
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Application is not installed in ${APP_DIR}. Choose option 1 first."
    return 1
  fi
  log_info "Pulling latest updates from GitHub (preserving user data)..."
  cd "${APP_DIR}" || return 1
  if [[ -d ".git" ]]; then
    git fetch --depth 1 origin && git reset --hard origin/main
  fi
  build_frontend || return 1
  setup_nginx_proxy
  install_cli_shortcut
  systemctl restart "${SERVICE_NAME}"
  log_info "Application updated and restarted."
}

option_start() {
  require_root
  systemctl start "${SERVICE_NAME}"
  log_info "Service ${SERVICE_NAME} started."
}

option_stop() {
  require_root
  systemctl stop "${SERVICE_NAME}"
  log_info "Service ${SERVICE_NAME} stopped."
}

option_restart() {
  require_root
  systemctl restart "${SERVICE_NAME}"
  log_info "Service ${SERVICE_NAME} restarted."
}

option_status() {
  load_or_init_config
  echo -e "\n${CYAN}--- Systemd Service Status ---${NC}"
  systemctl status "${SERVICE_NAME}" --no-pager || true
  echo -e "\n${CYAN}--- Local Health Endpoint Check ---${NC}"
  if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
    echo ""
  else
    log_warn "Health endpoint on port ${PORT} did not respond."
  fi
}

option_logs() {
  log_info "Showing recent logs for ${SERVICE_NAME}..."
  journalctl -u "${SERVICE_NAME}" -n 50 --no-pager
}

option_configure_access() {
  require_root
  load_or_init_config
  echo -e "\nCurrent Domain: ${CYAN}${DOMAIN}${NC}"
  echo -e "Current Port:   ${CYAN}${PORT}${NC}"
  read -r -p "Enter domain name [${DOMAIN}]: " NEW_DOMAIN
  read -r -p "Enter application internal port [${PORT}]: " NEW_PORT

  DOMAIN="${NEW_DOMAIN:-$DOMAIN}"
  PORT="${NEW_PORT:-$PORT}"

  cat > "${CONFIG_FILE}" <<EOF
PORT=${PORT}
HOST=0.0.0.0
DOMAIN=${DOMAIN}
GILEH_DATA_DIR=${DATA_DIR}
EOF

  setup_systemd_service
  setup_nginx_proxy
  configure_firewall
  systemctl restart "${SERVICE_NAME}"
  log_info "Domain and port configuration updated. HTTP IP access remains active."
}

option_setup_ssl() {
  require_root
  load_or_init_config
  local server_ip
  server_ip=$(get_server_ip)

  echo -e "\n${CYAN}--- Optional Let's Encrypt SSL Setup for ${DOMAIN} ---${NC}"
  read -r -p "Domain to issue SSL certificate for [${DOMAIN}]: " INPUT_DOMAIN
  DOMAIN="${INPUT_DOMAIN:-$DOMAIN}"

  cat > "${CONFIG_FILE}" <<EOF
PORT=${PORT}
HOST=0.0.0.0
DOMAIN=${DOMAIN}
GILEH_DATA_DIR=${DATA_DIR}
EOF

  log_info "Step 1: Checking DNS resolution for ${DOMAIN}..."
  local resolved_ip=""
  resolved_ip=$(getent ahosts "${DOMAIN}" 2>/dev/null | awk '/STREAM/ {print $1; exit}')
  if [[ -z "${resolved_ip}" ]]; then
    log_error "DNS lookup failed: '${DOMAIN}' does not resolve to any IP address yet."
    echo -e "Please create an ${BOLD}A Record${NC} in your DNS panel:"
    echo -e "  Host/Name : ${CYAN}${DOMAIN}${NC}"
    echo -e "  Value/IP  : ${CYAN}${server_ip}${NC}"
    echo -e "Wait 5-10 minutes for DNS propagation, then run Option 9 again."
    echo -e "Note: Your HTTP IP link (http://${server_ip}) continues to work normally."
    return 1
  fi

  if [[ "${resolved_ip}" != "${server_ip}" ]]; then
    log_warn "Domain ${DOMAIN} resolves to ${resolved_ip}, while this server's IP is ${server_ip}."
    echo -e "If you are using Cloudflare proxy, turn off the orange cloud (set to DNS Only) during certificate issuance."
    read -r -p "Continue anyway? [y/N]: " FORCE_CONT
    if [[ ! "${FORCE_CONT}" =~ ^[Yy]$ ]]; then
      return 1
    fi
  else
    log_info "DNS verified: ${DOMAIN} -> ${resolved_ip}"
  fi

  log_info "Step 2: Checking firewall and Nginx on port 80 & 443..."
  configure_firewall
  mkdir -p /var/www/html
  setup_nginx_proxy || return 1

  log_info "Step 3: Installing Certbot..."
  if ! command -v certbot >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  fi

  read -r -p "Enter email for Let's Encrypt expiry notices (or press Enter to skip): " LE_EMAIL
  local email_arg="--register-unsafely-without-email"
  if [[ -n "${LE_EMAIL}" ]]; then
    email_arg="--email ${LE_EMAIL}"
  fi

  log_info "Step 4: Requesting Let's Encrypt certificate for ${DOMAIN}..."
  # Use webroot so Certbot does not overwrite our dual IP/Domain Nginx structure
  if certbot certonly --webroot -w /var/www/html -d "${DOMAIN}" --non-interactive --agree-tos ${email_arg}; then
    log_info "Certificate obtained! Updating Nginx domain block for HTTPS..."
    setup_nginx_proxy
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/usr/bin/env bash
systemctl reload nginx
HOOK
    chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    log_info "SSL active at: https://${DOMAIN}"
    log_info "HTTP IP access remains active at: http://${server_ip}"
  else
    log_error "Certbot failed to issue a certificate. Check DNS A record and ensure port 80 is not blocked by your ISP/VPS."
    log_info "HTTP IP access (http://${server_ip}) is still active and unaffected."
    return 1
  fi
}

option_ssl_status_and_renew() {
  require_root
  load_or_init_config
  echo -e "\n${CYAN}--- SSL Certificate Status (${DOMAIN}) ---${NC}"
  if command -v certbot >/dev/null 2>&1; then
    certbot certificates || true
    echo ""
    read -r -p "Run a certificate renewal test (certbot renew --dry-run)? [y/N]: " DO_RENEW
    if [[ "${DO_RENEW}" =~ ^[Yy]$ ]]; then
      certbot renew --dry-run
    fi
  else
    log_warn "Certbot is not installed yet. Run Option 9 to configure SSL."
  fi
}

option_rebuild() {
  require_root
  build_frontend && systemctl restart "${SERVICE_NAME}"
  log_info "Frontend rebuilt and service restarted."
}

option_uninstall() {
  require_root
  read -r -p "Uninstall GILEH KORD application files? [y/N]: " CONFIRM
  if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
    log_info "Uninstall cancelled."
    return 0
  fi

  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}" "${CLI_SHORTCUT}"
  systemctl daemon-reload

  rm -f "${NGINX_IP_ENABLED}" "${NGINX_IP_AVAILABLE}" "${NGINX_DOMAIN_ENABLED}" "${NGINX_DOMAIN_AVAILABLE}"
  systemctl reload nginx 2>/dev/null || true

  rm -rf "${APP_DIR}"
  log_info "Application removed. User data in ${DATA_DIR} and SSL certs were preserved."
}

show_menu() {
  load_or_init_config
  local server_ip
  server_ip=$(get_server_ip)
  local status_badge
  status_badge=$(get_service_state)
  local ssl_badge
  ssl_badge=$(get_ssl_state)

  echo -e "\n${GREEN}==============================================================${NC}"
  echo -e "   ${BOLD}GILEH KORD - SSH Deployment, HTTP/HTTPS & SSL Manager${NC}"
  echo -e "${GREEN}==============================================================${NC}"
  echo -e "  App Status  : ${status_badge}"
  echo -e "  HTTP IP URL : ${CYAN}${BOLD}http://${server_ip}${NC} (Always Active)"
  echo -e "  Direct Port : ${CYAN}http://${server_ip}:${PORT}${NC}"
  echo -e "  Domain URL  : ${CYAN}${BOLD}https://${DOMAIN}${NC}"
  echo -e "  SSL Status  : ${ssl_badge}"
  echo -e "  Shortcut    : ${YELLOW}sudo gk${NC}"
  echo -e "${GREEN}--------------------------------------------------------------${NC}"
  echo "   1) Install GILEH KORD (Fast Auto-Setup)"
  echo "   2) Update application from GitHub"
  echo "   3) Start application"
  echo "   4) Stop application"
  echo "   5) Restart application"
  echo "   6) Check application status"
  echo "   7) View application logs"
  echo "   8) Configure domain and port settings"
  echo "   9) Setup / Issue Free Let's Encrypt SSL (Optional)"
  echo "  10) Check SSL status & test certificate renewal"
  echo "  11) Rebuild frontend"
  echo "  12) Uninstall application"
  echo "  13) Exit"
  echo -e "${GREEN}==============================================================${NC}"
}

main() {
  if [[ "${1:-}" == "--auto" || "${1:-}" == "-y" ]]; then
    option_install
    exit 0
  fi

  while true; do
    show_menu
    read -r -p "Select an option [1-13]: " CHOICE
    case "${CHOICE}" in
      1) option_install ;;
      2) option_update ;;
      3) option_start ;;
      4) option_stop ;;
      5) option_restart ;;
      6) option_status ;;
      7) option_logs ;;
      8) option_configure_access ;;
      9) option_setup_ssl ;;
      10) option_ssl_status_and_renew ;;
      11) option_rebuild ;;
      12) option_uninstall ;;
      13) log_info "Exiting menu."; exit 0 ;;
      *) log_warn "Invalid option. Enter a number between 1 and 13." ;;
    esac
  done
}

main "$@"
