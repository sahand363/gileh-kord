#!/usr/bin/env bash
# =============================================================================
# GILEH KORD (گیله‌کُرد) — Ubuntu SSH Deployment & Management Menu
# =============================================================================

set -u

APP_NAME="gileh-kord"
SERVICE_NAME="gileh-kord.service"
REPO_URL="${GILEH_REPO_URL:-https://github.com/sahand363/gileh-kord.git}"
APP_DIR="/opt/gileh-kord"
DATA_DIR="/var/lib/gileh-kord"
CONFIG_DIR="/etc/gileh-kord"
CONFIG_FILE="${CONFIG_DIR}/config.env"
NGINX_AVAILABLE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}"

DEFAULT_PORT="3000"
DEFAULT_DOMAIN="_"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
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
HOST=127.0.0.1
DOMAIN=${DEFAULT_DOMAIN}
GILEH_DATA_DIR=${DATA_DIR}
EOF
    chmod 640 "${CONFIG_FILE}"
  fi
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
}

install_system_dependencies() {
  log_info "Checking Ubuntu packages and Node.js runtime..."
  apt-get update -y
  apt-get install -y curl git ca-certificates gnupg nginx

  if ! command -v node >/dev/null 2>&1; then
    log_info "Installing Node.js 20.x LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d 'v')
    if [[ "${NODE_MAJOR}" -lt 18 ]]; then
      log_warn "Node.js version is older than 18. Upgrading to Node.js 20.x LTS..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
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
  systemctl enable "${SERVICE_NAME}"
}

setup_nginx_proxy() {
  load_or_init_config
  log_info "Configuring Nginx reverse proxy for domain '${DOMAIN}' -> 127.0.0.1:${PORT}..."
  cat > "${NGINX_AVAILABLE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

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

  ln -sf "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
  if [[ "${DOMAIN}" == "_" && -f /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
  fi

  if nginx -t; then
    systemctl reload nginx
  else
    log_error "Nginx configuration test failed. Please inspect ${NGINX_AVAILABLE}."
    return 1
  fi
}

build_frontend() {
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Application directory ${APP_DIR} does not exist. Run option 1 (Install) first."
    return 1
  fi
  cd "${APP_DIR}" || return 1
  log_info "Installing npm dependencies..."
  npm install
  log_info "Building production frontend bundle..."
  npm run build
}

get_server_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP"
}

option_install() {
  require_root
  install_system_dependencies
  load_or_init_config

  if [[ -d "${APP_DIR}/.git" ]]; then
    log_info "Existing repository found in ${APP_DIR}. Pulling latest changes..."
    cd "${APP_DIR}" && git pull --ff-only
  elif [[ -f "./package.json" && -f "./server.mjs" ]]; then
    log_info "Copying project files from current directory into ${APP_DIR}..."
    mkdir -p "${APP_DIR}"
    cp -r ./* "${APP_DIR}/"
  else
    log_info "Cloning repository from ${REPO_URL} into ${APP_DIR}..."
    git clone "${REPO_URL}" "${APP_DIR}"
  fi

  build_frontend || return 1
  setup_systemd_service
  setup_nginx_proxy
  systemctl restart "${SERVICE_NAME}"

  SERVER_IP=$(get_server_ip)
  log_info "GILEH KORD installed and started!"
  if [[ "${DOMAIN}" != "_" ]]; then
    echo -e "${CYAN}Access URL:${NC} http://${DOMAIN}"
  else
    echo -e "${CYAN}Access URL:${NC} http://${SERVER_IP}"
  fi
}

option_update() {
  require_root
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Application is not installed in ${APP_DIR}. Choose option 1 first."
    return 1
  fi
  log_info "Updating GILEH KORD source code (preserving ${DATA_DIR} and ${CONFIG_FILE})..."
  cd "${APP_DIR}" || return 1
  if [[ -d ".git" ]]; then
    git pull --ff-only || {
      log_error "git pull failed. Resolve local changes in ${APP_DIR} and retry."
      return 1
    }
  fi
  build_frontend || return 1
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
  log_info "Showing recent logs for ${SERVICE_NAME} (Press Ctrl+C to exit)..."
  journalctl -u "${SERVICE_NAME}" -n 50 --no-pager
}

option_configure_access() {
  require_root
  load_or_init_config
  echo -e "\nCurrent Domain: ${CYAN}${DOMAIN}${NC}"
  echo -e "Current Internal Node Port: ${CYAN}${PORT}${NC}"
  read -r -p "Enter domain name (or '_' for default IP access) [${DOMAIN}]: " NEW_DOMAIN
  read -r -p "Enter internal Node.js port [${PORT}]: " NEW_PORT

  DOMAIN="${NEW_DOMAIN:-$DOMAIN}"
  PORT="${NEW_PORT:-$PORT}"

  cat > "${CONFIG_FILE}" <<EOF
PORT=${PORT}
HOST=127.0.0.1
DOMAIN=${DOMAIN}
GILEH_DATA_DIR=${DATA_DIR}
EOF

  setup_systemd_service
  setup_nginx_proxy
  systemctl restart "${SERVICE_NAME}"
  log_info "Domain and access configuration updated."
}

option_rebuild() {
  require_root
  build_frontend && systemctl restart "${SERVICE_NAME}"
  log_info "Frontend rebuilt and service restarted."
}

option_uninstall() {
  require_root
  read -r -p "Are you sure you want to uninstall GILEH KORD application files? [y/N]: " CONFIRM
  if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
    log_info "Uninstall cancelled."
    return 0
  fi

  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}"
  systemctl daemon-reload

  rm -f "${NGINX_ENABLED}" "${NGINX_AVAILABLE}"
  systemctl reload nginx 2>/dev/null || true

  rm -rf "${APP_DIR}"
  log_info "Application source (${APP_DIR}) and service removed."
  log_warn "User data (${DATA_DIR}) and config (${CONFIG_DIR}) were preserved."
}

show_menu() {
  echo -e "\n${GREEN}=====================================================${NC}"
  echo -e "${GREEN}   GILEH KORD (گیله‌کُرد) — SSH Management Menu      ${NC}"
  echo -e "${GREEN}=====================================================${NC}"
  echo "  1) Install GILEH KORD"
  echo "  2) Update application"
  echo "  3) Start application"
  echo "  4) Stop application"
  echo "  5) Restart application"
  echo "  6) Check application status"
  echo "  7) View application logs"
  echo "  8) Configure domain and access settings"
  echo "  9) Rebuild frontend"
  echo " 10) Uninstall application"
  echo " 11) Exit"
  echo -e "${GREEN}-----------------------------------------------------${NC}"
}

main() {
  while true; do
    show_menu
    read -r -p "Select an option [1-11]: " CHOICE
    case "${CHOICE}" in
      1) option_install ;;
      2) option_update ;;
      3) option_start ;;
      4) option_stop ;;
      5) option_restart ;;
      6) option_status ;;
      7) option_logs ;;
      8) option_configure_access ;;
      9) option_rebuild ;;
      10) option_uninstall ;;
      11) log_info "Exiting GILEH KORD manager."; exit 0 ;;
      *) log_warn "Invalid selection. Please enter a number between 1 and 11." ;;
    esac
  done
}

main "$@"
