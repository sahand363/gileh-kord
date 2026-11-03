#!/usr/bin/env bash
# =============================================================================
# GILEH KORD - Ubuntu SSH Deployment & Management Menu
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
CLI_SHORTCUT="/usr/local/bin/gk"

DEFAULT_PORT="3000"
DEFAULT_DOMAIN="_"

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
  # Ensure HOST is 0.0.0.0 so direct port access always works alongside Nginx
  sed -i 's/^HOST=127\.0\.0\.1/HOST=0.0.0.0/' "${CONFIG_FILE}" 2>/dev/null || true
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
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
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates gnupg nginx
  else
    log_info "System packages (curl, git, nginx) already installed. Skipping apt update."
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
  else
    log_info "Node.js $(node -v) already installed."
  fi
}

resolve_port80_conflicts() {
  # Stop conflicting web servers occupying port 80 so Nginx can bind cleanly
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
      log_info "Opening ports 80/tcp and ${PORT}/tcp in UFW firewall..."
      ufw allow 80/tcp >/dev/null 2>&1 || true
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

setup_nginx_proxy() {
  load_or_init_config
  resolve_port80_conflicts
  log_info "Configuring Nginx reverse proxy (Port 80 -> 127.0.0.1:${PORT})..."
  cat > "${NGINX_AVAILABLE}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
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
  rm -f /etc/nginx/sites-enabled/default

  if nginx -t >/dev/null 2>&1; then
    systemctl enable nginx >/dev/null 2>&1 || true
    systemctl restart nginx
  else
    log_error "Nginx configuration test failed. Check ${NGINX_AVAILABLE}."
    return 1
  fi
}

build_frontend() {
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Directory ${APP_DIR} not found. Run option 1 (Install) first."
    return 1
  fi
  cd "${APP_DIR}" || return 1
  log_info "Installing npm packages (fast mode)..."
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

  log_info "Installation complete! Tip: Type 'sudo gk' anytime to open this menu."
}

option_update() {
  require_root
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Application is not installed in ${APP_DIR}. Choose option 1 first."
    return 1
  fi
  log_info "Pulling latest updates from GitHub..."
  cd "${APP_DIR}" || return 1
  if [[ -d ".git" ]]; then
    git fetch --depth 1 origin && git reset --hard origin/main
  fi
  build_frontend || return 1
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
  read -r -p "Enter domain name (or '_' for IP access) [${DOMAIN}]: " NEW_DOMAIN
  read -r -p "Enter application port [${PORT}]: " NEW_PORT

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
  log_info "Access settings updated."
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

  rm -f "${NGINX_ENABLED}" "${NGINX_AVAILABLE}"
  systemctl reload nginx 2>/dev/null || true

  rm -rf "${APP_DIR}"
  log_info "Application removed. Data in ${DATA_DIR} was preserved."
}

show_menu() {
  load_or_init_config
  local server_ip
  server_ip=$(get_server_ip)
  local status_badge
  status_badge=$(get_service_state)
  local main_url="http://${server_ip}"
  if [[ "${DOMAIN}" != "_" && -n "${DOMAIN}" ]]; then
    main_url="http://${DOMAIN}"
  fi

  echo -e "\n${GREEN}=========================================================${NC}"
  echo -e "   ${BOLD}GILEH KORD - SSH Deployment & Management Menu${NC}"
  echo -e "${GREEN}=========================================================${NC}"
  echo -e "  Status     : ${status_badge}"
  echo -e "  App Link   : ${CYAN}${BOLD}${main_url}${NC}"
  echo -e "  Direct Port: ${CYAN}http://${server_ip}:${PORT}${NC}"
  echo -e "  Shortcut   : ${YELLOW}sudo gk${NC}"
  echo -e "${GREEN}---------------------------------------------------------${NC}"
  echo "   1) Install GILEH KORD (Fast Auto-Setup)"
  echo "   2) Update application from GitHub"
  echo "   3) Start application"
  echo "   4) Stop application"
  echo "   5) Restart application"
  echo "   6) Check application status"
  echo "   7) View application logs"
  echo "   8) Configure domain and port settings"
  echo "   9) Rebuild frontend"
  echo "  10) Uninstall application"
  echo "  11) Exit"
  echo -e "${GREEN}=========================================================${NC}"
}

main() {
  if [[ "${1:-}" == "--auto" || "${1:-}" == "-y" ]]; then
    option_install
    exit 0
  fi

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
      11) log_info "Exiting menu."; exit 0 ;;
      *) log_warn "Invalid option. Enter a number between 1 and 11." ;;
    esac
  done
}

main "$@"
