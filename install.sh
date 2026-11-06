#!/usr/bin/env bash
# =============================================================================
# GILEH KORD - Ubuntu SSH Deployment, Master Credentials & SSL Management Menu
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
DEFAULT_ADMIN_USER="admin"
DEFAULT_ADMIN_PASS="admin1234"

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
ADMIN_USER=${DEFAULT_ADMIN_USER}
ADMIN_PASS=${DEFAULT_ADMIN_PASS}
EOF
    chmod 640 "${CONFIG_FILE}"
  fi
  sed -i 's/^HOST=127\.0\.0\.1/HOST=0.0.0.0/' "${CONFIG_FILE}" 2>/dev/null || true
  if ! grep -q "^ADMIN_USER=" "${CONFIG_FILE}" 2>/dev/null; then
    echo "ADMIN_USER=${DEFAULT_ADMIN_USER}" >> "${CONFIG_FILE}"
  fi
  if ! grep -q "^ADMIN_PASS=" "${CONFIG_FILE}" 2>/dev/null; then
    echo "ADMIN_PASS=${DEFAULT_ADMIN_PASS}" >> "${CONFIG_FILE}"
  fi
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
    echo -e "${YELLOW}NOT CONFIGURED (HTTP IP Active)${NC}"
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
      systemctl stop "${svc}" 2>/dev/null || true
      systemctl disable "${svc}" 2>/dev/null || true
    fi
  done
}

configure_firewall() {
  load_or_init_config
  if command -v ufw >/dev/null 2>&1; then
    if ufw status 2>/dev/null | grep -q "Status: active"; then
      ufw allow 80/tcp >/dev/null 2>&1 || true
      ufw allow 443/tcp >/dev/null 2>&1 || true
      ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
    fi
  fi
}

setup_systemd_service() {
  load_or_init_config
  cat > "/etc/systemd/system/${SERVICE_NAME}" <<EOF
[Unit]
Description=GILEH KORD Restaurant Management Web App
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

setup_nginx_proxy() {
  load_or_init_config
  resolve_port80_conflicts
  rm -f "${LEGACY_NGINX_ENABLED}" /etc/nginx/sites-enabled/default

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

  if nginx -t >/dev/null 2>&1; then
    systemctl enable nginx >/dev/null 2>&1 || true
    systemctl reload nginx || systemctl restart nginx
  fi
}

build_frontend() {
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Directory ${APP_DIR} not found. Run option 1 first."
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
    cd "${APP_DIR}" && git fetch --depth 1 origin && git reset --hard origin/main
  else
    rm -rf "${APP_DIR}"
    git clone --depth 1 "${REPO_URL}" "${APP_DIR}"
  fi

  build_frontend || return 1
  setup_systemd_service
  setup_nginx_proxy
  configure_firewall
  install_cli_shortcut
  systemctl restart "${SERVICE_NAME}"
  log_info "Installation complete!"
}

option_update() {
  require_root
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Application is not installed in ${APP_DIR}. Choose option 1 first."
    return 1
  fi
  cd "${APP_DIR}" || return 1
  git fetch --depth 1 origin && git reset --hard origin/main
  build_frontend || return 1
  setup_nginx_proxy
  install_cli_shortcut
  systemctl restart "${SERVICE_NAME}"
  log_info "Application updated and restarted."
}

option_start()   { require_root; systemctl start "${SERVICE_NAME}"; log_info "Started."; }
option_stop()    { require_root; systemctl stop "${SERVICE_NAME}"; log_info "Stopped."; }
option_restart() { require_root; systemctl restart "${SERVICE_NAME}"; log_info "Restarted."; }

option_status() {
  load_or_init_config
  systemctl status "${SERVICE_NAME}" --no-pager || true
  curl -fsS "http://127.0.0.1:${PORT}/api/health" && echo ""
}

option_logs() {
  journalctl -u "${SERVICE_NAME}" -n 50 --no-pager
}

option_configure_access() {
  require_root
  load_or_init_config
  echo -e "\nCurrent Domain     : ${CYAN}${DOMAIN}${NC}"
  echo -e "Current Port       : ${CYAN}${PORT}${NC}"
  echo -e "Master Admin User  : ${CYAN}${ADMIN_USER}${NC}"
  read -r -p "Enter domain name [${DOMAIN}]: " NEW_DOMAIN
  read -r -p "Enter internal port [${PORT}]: " NEW_PORT
  read -r -p "Enter Master Admin Username [${ADMIN_USER}]: " NEW_ADMIN_USER
  read -r -p "Enter Master Admin Password [keep current]: " NEW_ADMIN_PASS

  DOMAIN="${NEW_DOMAIN:-$DOMAIN}"
  PORT="${NEW_PORT:-$PORT}"
  ADMIN_USER="${NEW_ADMIN_USER:-$ADMIN_USER}"
  ADMIN_PASS="${NEW_ADMIN_PASS:-$ADMIN_PASS}"

  cat > "${CONFIG_FILE}" <<EOF
PORT=${PORT}
HOST=0.0.0.0
DOMAIN=${DOMAIN}
GILEH_DATA_DIR=${DATA_DIR}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
EOF
  chmod 640 "${CONFIG_FILE}"

  setup_systemd_service
  setup_nginx_proxy
  configure_firewall
  systemctl restart "${SERVICE_NAME}"
  log_info "Master credentials, domain, and port updated."
}

option_setup_ssl() {
  require_root
  load_or_init_config
  if ! command -v certbot >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  fi
  mkdir -p /var/www/html
  setup_nginx_proxy
  if certbot certonly --webroot -w /var/www/html -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email; then
    setup_nginx_proxy
    log_info "SSL active at https://${DOMAIN}"
  else
    log_error "Certbot failed. Verify DNS A record for ${DOMAIN}."
  fi
}

option_ssl_status_and_renew() {
  require_root
  certbot certificates || true
}

option_rebuild() {
  require_root
  build_frontend && systemctl restart "${SERVICE_NAME}"
}

option_uninstall() {
  require_root
  read -r -p "Uninstall GILEH KORD application files? [y/N]: " CONFIRM
  [[ ! "${CONFIRM}" =~ ^[Yy]$ ]] && return 0
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}" "${CLI_SHORTCUT}"
  systemctl daemon-reload
  rm -rf "${APP_DIR}"
  log_info "Uninstalled."
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
  echo -e "   ${BOLD}GILEH KORD - SSH Deployment, Master Auth & SSL Manager${NC}"
  echo -e "${GREEN}==============================================================${NC}"
  echo -e "  App Status  : ${status_badge}"
  echo -e "  HTTP IP URL : ${CYAN}${BOLD}http://${server_ip}${NC}"
  echo -e "  Direct Port : ${CYAN}http://${server_ip}:${PORT}${NC}"
  echo -e "  Domain URL  : ${CYAN}${BOLD}https://${DOMAIN}${NC}"
  echo -e "  Master User : ${YELLOW}${ADMIN_USER}${NC} (Configure in Option 8)"
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
  echo "   8) Configure Master Username/Password, Domain & Port"
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
      13) log_info "Exiting."; exit 0 ;;
      *) log_warn "Enter a number between 1 and 13." ;;
    esac
  done
}

main "$@"
