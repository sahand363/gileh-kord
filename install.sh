#!/usr/bin/env bash
# =============================================================================
# GILEH KORD - Clean Top-Pinned SSH Manager & Credentials Utility
# =============================================================================

set -u

APP_NAME="gileh-kord"
SERVICE_NAME="gileh-kord.service"
REPO_URL="${GILEH_REPO_URL:-https://github.com/sahand363/gileh-kord.git}"
APP_DIR="/opt/gileh-kord"
DATA_DIR="/var/lib/gileh-kord"
CONFIG_DIR="/etc/gileh-kord"
CONFIG_FILE="${CONFIG_DIR}/config.env"
MANAGERS_FILE="${CONFIG_DIR}/managers.conf"

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
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

pause_return() {
  echo ""
  read -r -p "Press [Enter] to return to the menu..." _
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    log_error "Please run as root: sudo bash install.sh"
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
MANAGERS_FILE=${MANAGERS_FILE}
EOF
    chmod 640 "${CONFIG_FILE}"
  fi

  sed -i 's/^HOST=127\.0\.0\.1/HOST=0.0.0.0/' "${CONFIG_FILE}" 2>/dev/null || true
  grep -q "^ADMIN_USER=" "${CONFIG_FILE}" 2>/dev/null || echo "ADMIN_USER=${DEFAULT_ADMIN_USER}" >> "${CONFIG_FILE}"
  grep -q "^ADMIN_PASS=" "${CONFIG_FILE}" 2>/dev/null || echo "ADMIN_PASS=${DEFAULT_ADMIN_PASS}" >> "${CONFIG_FILE}"
  grep -q "^MANAGERS_FILE=" "${CONFIG_FILE}" 2>/dev/null || echo "MANAGERS_FILE=${MANAGERS_FILE}" >> "${CONFIG_FILE}"

  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
  if [[ "${DOMAIN:-_}" == "_" || -z "${DOMAIN:-}" ]]; then
    DOMAIN="${DEFAULT_DOMAIN}"
  fi

  if [[ ! -f "${MANAGERS_FILE}" ]]; then
    echo "${ADMIN_USER}:${ADMIN_PASS}" > "${MANAGERS_FILE}"
    chmod 600 "${MANAGERS_FILE}"
  fi
}

save_config_file() {
  cat > "${CONFIG_FILE}" <<EOF
PORT=${PORT}
HOST=0.0.0.0
DOMAIN=${DOMAIN}
GILEH_DATA_DIR=${DATA_DIR}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
MANAGERS_FILE=${MANAGERS_FILE}
EOF
  chmod 640 "${CONFIG_FILE}"
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
    echo -e "${GREEN}● RUNNING${NC}"
  else
    echo -e "${RED}○ STOPPED${NC}"
  fi
}

get_ssl_state() {
  load_or_init_config
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    echo -e "${GREEN}ACTIVE (HTTPS)${NC}"
  else
    echo -e "${YELLOW}HTTP ONLY${NC}"
  fi
}

get_managers_list() {
  if [[ -f "${MANAGERS_FILE}" ]]; then
    awk -F: 'NF>=2 {print $1}' "${MANAGERS_FILE}" | paste -sd ", " -
  else
    echo "${ADMIN_USER}"
  fi
}

install_cli_shortcut() {
  if [[ -f "${APP_DIR}/install.sh" ]]; then
    cp -f "${APP_DIR}/install.sh" "${CLI_SHORTCUT}"
    chmod +x "${CLI_SHORTCUT}"
  elif [[ -f "./install.sh" ]]; then
    cp -f "./install.sh" "${CLI_SHORTCUT}"
    chmod +x "${CLI_SHORTCUT}"
  fi
}

install_system_dependencies() {
  local need_apt=0
  for cmd in curl git nginx; do
    command -v "${cmd}" >/dev/null 2>&1 || need_apt=1
  done

  if [[ "${need_apt}" -eq 1 ]]; then
    log_info "Installing system packages (curl, git, nginx)..."
    DEBIAN_FRONTEND=noninteractive apt-get update -y -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates gnupg nginx dnsutils
  fi

  local install_node=0
  if ! command -v node >/dev/null 2>&1; then
    install_node=1
  else
    local node_major
    node_major=$(node -v | cut -d. -f1 | tr -d 'v')
    [[ "${node_major}" -lt 18 ]] && install_node=1
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
  log_info "Installing npm dependencies..."
  npm install --no-audit --no-fund --prefer-offline --loglevel=error
  log_info "Building frontend..."
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
  log_info "GILEH KORD installed and running!"
}

option_update() {
  require_root
  if [[ ! -d "${APP_DIR}" ]]; then
    log_error "Not installed yet. Run Option 1 first."
    return 1
  fi
  log_info "Updating from GitHub..."
  cd "${APP_DIR}" || return 1
  git fetch --depth 1 origin && git reset --hard origin/main
  build_frontend || return 1
  setup_nginx_proxy
  install_cli_shortcut
  systemctl restart "${SERVICE_NAME}"
  log_info "Application updated and restarted."
}

option_start()   { require_root; systemctl start "${SERVICE_NAME}"; log_info "Service started."; }
option_stop()    { require_root; systemctl stop "${SERVICE_NAME}"; log_info "Service stopped."; }
option_restart() { require_root; systemctl restart "${SERVICE_NAME}"; log_info "Service restarted."; }

option_status() {
  load_or_init_config
  systemctl status "${SERVICE_NAME}" --no-pager || true
  echo ""
  curl -fsS "http://127.0.0.1:${PORT}/api/health" && echo ""
}

option_logs() {
  journalctl -u "${SERVICE_NAME}" -n 40 --no-pager
}

# Dedicated Option 8: Add or Change Manager User & Password
option_manage_users() {
  require_root
  load_or_init_config

  echo -e "\n${CYAN}┌──────────────────────────────────────────────────────────┐${NC}"
  echo -e "${CYAN}│        MANAGER TAB — USER & PASSWORD CONFIGURATION       │${NC}"
  echo -e "${CYAN}└──────────────────────────────────────────────────────────┘${NC}"
  echo -e "  Current Manager Users : ${YELLOW}$(get_managers_list)${NC}"
  echo -e "  Primary Master User   : ${GREEN}${ADMIN_USER}${NC}"
  echo ""
  echo "  1) Add a new Manager user or change an existing password"
  echo "  2) Remove a Manager user"
  echo "  0) Back to main menu"
  echo ""
  read -r -p "Select action [0-2]: " U_ACT

  case "${U_ACT}" in
    1)
      read -r -p "Enter Manager Username [${ADMIN_USER}]: " NEW_USER
      NEW_USER="${NEW_USER:-$ADMIN_USER}"
      NEW_USER=$(echo "${NEW_USER}" | tr -d ' :')
      if [[ -z "${NEW_USER}" ]]; then
        log_error "Username cannot be empty."
        return 1
      fi

      read -r -p "Enter Password for '${NEW_USER}': " NEW_PASS
      if [[ -z "${NEW_PASS}" ]]; then
        log_error "Password cannot be empty."
        return 1
      fi

      # Update primary ADMIN_USER / ADMIN_PASS in config.env
      ADMIN_USER="${NEW_USER}"
      ADMIN_PASS="${NEW_PASS}"
      save_config_file

      # Also update or append in managers.conf for multi-user support
      touch "${MANAGERS_FILE}"
      grep -v "^${NEW_USER}:" "${MANAGERS_FILE}" > "${MANAGERS_FILE}.tmp" || true
      echo "${NEW_USER}:${NEW_PASS}" >> "${MANAGERS_FILE}.tmp"
      mv "${MANAGERS_FILE}.tmp" "${MANAGERS_FILE}"
      chmod 600 "${MANAGERS_FILE}"

      systemctl restart "${SERVICE_NAME}" 2>/dev/null || true
      log_info "Manager user '${NEW_USER}' saved and activated immediately!"
      ;;
    2)
      read -r -p "Enter Username to remove: " DEL_USER
      if [[ -z "${DEL_USER}" ]]; then
        return 0
      fi
      if [[ -f "${MANAGERS_FILE}" ]]; then
        grep -v "^${DEL_USER}:" "${MANAGERS_FILE}" > "${MANAGERS_FILE}.tmp" || true
        mv "${MANAGERS_FILE}.tmp" "${MANAGERS_FILE}"
        log_info "User '${DEL_USER}' removed."
        systemctl restart "${SERVICE_NAME}" 2>/dev/null || true
      fi
      ;;
    *)
      return 0
      ;;
  esac
}

option_configure_domain_port() {
  require_root
  load_or_init_config
  echo -e "\nCurrent Domain : ${CYAN}${DOMAIN}${NC}"
  echo -e "Current Port   : ${CYAN}${PORT}${NC}"
  read -r -p "Enter domain name [${DOMAIN}]: " NEW_DOMAIN
  read -r -p "Enter internal port [${PORT}]: " NEW_PORT

  DOMAIN="${NEW_DOMAIN:-$DOMAIN}"
  PORT="${NEW_PORT:-$PORT}"
  save_config_file

  setup_systemd_service
  setup_nginx_proxy
  configure_firewall
  systemctl restart "${SERVICE_NAME}"
  log_info "Domain and port settings updated."
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

option_ssl_status() {
  require_root
  certbot certificates || true
}

option_rebuild() {
  require_root
  build_frontend && systemctl restart "${SERVICE_NAME}"
  log_info "Frontend rebuilt and service restarted."
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
  log_info "Uninstalled. Data in ${DATA_DIR} preserved."
}

show_menu() {
  clear
  load_or_init_config
  local server_ip
  server_ip=$(get_server_ip)
  local status_badge
  status_badge=$(get_service_state)
  local ssl_badge
  ssl_badge=$(get_ssl_state)
  local managers_list
  managers_list=$(get_managers_list)

  echo -e "${GREEN}┌──────────────────────────────────────────────────────────────┐${NC}"
  echo -e "${GREEN}│${NC}              ${BOLD}GILEH KORD — SSH CONTROL PANEL${NC}                  ${GREEN}│${NC}"
  echo -e "${GREEN}├──────────────────────────────────────────────────────────────┤${NC}"
  echo -e "  Status       : ${status_badge}   ${DIM}|${NC}  SSL: ${ssl_badge}"
  echo -e "  HTTP IP Link : ${CYAN}${BOLD}http://${server_ip}${NC}"
  echo -e "  Direct Port  : ${CYAN}http://${server_ip}:${PORT}${NC}"
  echo -e "  Domain Link  : ${CYAN}https://${DOMAIN}${NC}"
  echo -e "  Manager User : ${YELLOW}${BOLD}${managers_list}${NC} ${DIM}(Change with Option 8)${NC}"
  echo -e "  Quick Command: ${GREEN}sudo gk${NC}"
  echo -e "${GREEN}├──────────────────────────────────────────────────────────────┤${NC}"
  echo -e "  ${BOLD}1)${NC} Install GILEH KORD          ${BOLD}8)${NC} ${YELLOW}Add / Change Manager User & Pass${NC}"
  echo -e "  ${BOLD}2)${NC} Update from GitHub          ${BOLD}9)${NC} Configure Domain & Port"
  echo -e "  ${BOLD}3)${NC} Start Application          ${BOLD}10)${NC} Issue Free Let's Encrypt SSL"
  echo -e "  ${BOLD}4)${NC} Stop Application           ${BOLD}11)${NC} Check SSL Status"
  echo -e "  ${BOLD}5)${NC} Restart Application        ${BOLD}12)${NC} Rebuild Frontend"
  echo -e "  ${BOLD}6)${NC} Check Status               ${BOLD}13)${NC} Uninstall Application"
  echo -e "  ${BOLD}7)${NC} View Logs                   ${BOLD}0)${NC} Exit"
  echo -e "${GREEN}└──────────────────────────────────────────────────────────────┘${NC}"
}

main() {
  if [[ "${1:-}" == "--auto" || "${1:-}" == "-y" ]]; then
    option_install
    exit 0
  fi

  while true; do
    show_menu
    read -r -p "Select an option [0-13]: " CHOICE
    case "${CHOICE}" in
      1)  option_install; pause_return ;;
      2)  option_update; pause_return ;;
      3)  option_start; pause_return ;;
      4)  option_stop; pause_return ;;
      5)  option_restart; pause_return ;;
      6)  option_status; pause_return ;;
      7)  option_logs; pause_return ;;
      8)  option_manage_users; pause_return ;;
      9)  option_configure_domain_port; pause_return ;;
      10) option_setup_ssl; pause_return ;;
      11) option_ssl_status; pause_return ;;
      12) option_rebuild; pause_return ;;
      13) option_uninstall; pause_return ;;
      0|14|q|Q) clear; log_info "Exited GILEH KORD menu."; exit 0 ;;
      *)  log_warn "Invalid option."; sleep 1 ;;
    esac
  done
}

main "$@"
