#!/bin/bash
#
# MCP Container Sandbox Server - HTTPS 설정 스크립트
# Nginx 리버스 프록시 + Let's Encrypt SSL 인증서 설정
#
# 사용법:
#   sudo bash deploy/setup-https.sh --domain playmcp-sandbox-computer.bloupla.net
#   sudo bash deploy/setup-https.sh --domain playmcp-sandbox-computer.bloupla.net --email admin@example.com
#

set -e

# ============================================================================
# 색상 및 출력 함수
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================================
# 설정 변수
# ============================================================================
DOMAIN=""
EMAIL=""
APP_PORT=3000
NGINX_CONF_DIR="/etc/nginx"
NGINX_SITES_AVAILABLE="$NGINX_CONF_DIR/sites-available"
NGINX_SITES_ENABLED="$NGINX_CONF_DIR/sites-enabled"
APP_DIR="/opt/mcp-container-server"

# 명령줄 인자 파싱
while [[ $# -gt 0 ]]; do
    case $1 in
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --email)
            EMAIL="$2"
            shift 2
            ;;
        --port)
            APP_PORT="$2"
            shift 2
            ;;
        *)
            log_error "알 수 없는 옵션: $1"
            exit 1
            ;;
    esac
done

# 도메인 필수 확인
if [ -z "$DOMAIN" ]; then
    log_error "도메인을 지정해야 합니다."
    echo "사용법: sudo bash $0 --domain your-domain.com [--email admin@example.com]"
    exit 1
fi

# 이메일 기본값 설정
if [ -z "$EMAIL" ]; then
    EMAIL="admin@${DOMAIN}"
fi

# ============================================================================
# Root 권한 확인
# ============================================================================
if [ "$EUID" -ne 0 ]; then
    log_error "이 스크립트는 root 권한으로 실행해야 합니다."
    exit 1
fi

# ============================================================================
# OS 감지
# ============================================================================
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="${ID}"
    else
        log_error "지원하지 않는 OS입니다."
        exit 1
    fi
}

# ============================================================================
# Nginx 설치
# ============================================================================
install_nginx() {
    if command -v nginx &> /dev/null; then
        log_info "Nginx가 이미 설치되어 있습니다: $(nginx -v 2>&1)"
        return 0
    fi
    
    log_info "Nginx 설치 중..."
    
    case $OS_ID in
        ubuntu|debian)
            apt-get update
            apt-get install -y nginx
            ;;
        fedora)
            dnf install -y nginx
            ;;
        centos|almalinux|rocky|rhel)
            dnf install -y nginx
            ;;
        *)
            log_error "이 OS에서 Nginx 자동 설치를 지원하지 않습니다."
            exit 1
            ;;
    esac
    
    systemctl enable nginx
    systemctl start nginx
    
    log_success "Nginx 설치 완료"
}

# ============================================================================
# Certbot 설치
# ============================================================================
install_certbot() {
    if command -v certbot &> /dev/null; then
        log_info "Certbot이 이미 설치되어 있습니다: $(certbot --version 2>&1)"
        return 0
    fi
    
    log_info "Certbot 설치 중..."
    
    case $OS_ID in
        ubuntu|debian)
            apt-get update
            apt-get install -y certbot python3-certbot-nginx
            ;;
        fedora)
            dnf install -y certbot python3-certbot-nginx
            ;;
        centos|almalinux|rocky|rhel)
            dnf install -y epel-release
            dnf install -y certbot python3-certbot-nginx
            ;;
        *)
            log_error "이 OS에서 Certbot 자동 설치를 지원하지 않습니다."
            exit 1
            ;;
    esac
    
    log_success "Certbot 설치 완료"
}

# ============================================================================
# Nginx 설정 생성
# ============================================================================
create_nginx_config() {
    log_info "Nginx 설정 생성 중..."
    
    # sites-available/sites-enabled 디렉토리 생성 (없으면)
    mkdir -p "$NGINX_SITES_AVAILABLE"
    mkdir -p "$NGINX_SITES_ENABLED"
    
    # Nginx 메인 설정에 sites-enabled include 추가 (없으면)
    if ! grep -q "sites-enabled" "$NGINX_CONF_DIR/nginx.conf"; then
        # http 블록 내에 include 추가
        sed -i '/http {/a \    include /etc/nginx/sites-enabled/*;' "$NGINX_CONF_DIR/nginx.conf" 2>/dev/null || true
    fi
    
    # 사이트 설정 파일 생성
    cat > "$NGINX_SITES_AVAILABLE/mcp-container" << EOF
# MCP Container Sandbox Server - Nginx Configuration
# 생성일: $(date)
# 도메인: $DOMAIN

# HTTP -> HTTPS 리다이렉트
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    
    # Let's Encrypt 인증용
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # 나머지 요청은 HTTPS로 리다이렉트
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# HTTPS 서버 (SSL 인증서 발급 후 활성화됨)
# server {
#     listen 443 ssl http2;
#     listen [::]:443 ssl http2;
#     server_name $DOMAIN;
#     
#     # SSL 설정 (certbot이 자동으로 추가)
#     ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
#     ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
#     include /etc/letsencrypt/options-ssl-nginx.conf;
#     ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
#     
#     # 보안 헤더
#     add_header X-Frame-Options "SAMEORIGIN" always;
#     add_header X-Content-Type-Options "nosniff" always;
#     add_header X-XSS-Protection "1; mode=block" always;
#     
#     # MCP 서버로 프록시
#     location / {
#         proxy_pass http://127.0.0.1:$APP_PORT;
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade \$http_upgrade;
#         proxy_set_header Connection 'upgrade';
#         proxy_set_header Host \$host;
#         proxy_set_header X-Real-IP \$remote_addr;
#         proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
#         proxy_set_header X-Forwarded-Proto \$scheme;
#         proxy_cache_bypass \$http_upgrade;
#         
#         # SSE 지원을 위한 설정
#         proxy_read_timeout 86400;
#         proxy_send_timeout 86400;
#         proxy_buffering off;
#         chunked_transfer_encoding on;
#     }
# }
EOF
    
    # 심볼릭 링크 생성
    ln -sf "$NGINX_SITES_AVAILABLE/mcp-container" "$NGINX_SITES_ENABLED/mcp-container"
    
    # 기본 사이트 비활성화
    rm -f "$NGINX_SITES_ENABLED/default" 2>/dev/null || true
    
    # Nginx 설정 테스트
    nginx -t
    
    # Nginx 재시작
    systemctl reload nginx
    
    log_success "Nginx 설정 완료"
}

# ============================================================================
# SSL 인증서 발급
# ============================================================================
obtain_ssl_certificate() {
    log_info "SSL 인증서 발급 중 (Let's Encrypt)..."
    
    # certbot으로 인증서 발급 및 Nginx 설정 자동 수정
    certbot --nginx \
        -d "$DOMAIN" \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --redirect
    
    log_success "SSL 인증서 발급 완료"
}

# ============================================================================
# 방화벽 설정
# ============================================================================
configure_firewall() {
    log_info "방화벽 설정 중..."
    
    if command -v firewall-cmd &> /dev/null; then
        firewall-cmd --permanent --add-service=http
        firewall-cmd --permanent --add-service=https
        firewall-cmd --reload
        log_success "firewalld 규칙 추가 완료"
    elif command -v ufw &> /dev/null; then
        ufw allow 'Nginx Full'
        log_success "ufw 규칙 추가 완료"
    else
        log_warn "방화벽이 감지되지 않았습니다."
    fi
}

# ============================================================================
# 애플리케이션 BASE_URL 업데이트
# ============================================================================
update_app_config() {
    log_info "애플리케이션 설정 업데이트 중..."
    
    if [ -f "$APP_DIR/.env" ]; then
        # BASE_URL 업데이트
        sed -i "s|^BASE_URL=.*|BASE_URL=https://$DOMAIN|" "$APP_DIR/.env"
        
        # 서비스 재시작
        systemctl restart mcp-container
        
        log_success "애플리케이션 설정 업데이트 완료"
    else
        log_warn "$APP_DIR/.env 파일을 찾을 수 없습니다. 수동으로 BASE_URL을 설정해주세요."
    fi
}

# ============================================================================
# 인증서 자동 갱신 설정
# ============================================================================
setup_auto_renewal() {
    log_info "인증서 자동 갱신 설정 중..."
    
    # certbot 타이머가 이미 설정되어 있는지 확인
    if systemctl is-enabled certbot.timer &> /dev/null; then
        log_info "인증서 자동 갱신이 이미 설정되어 있습니다."
    else
        # 수동으로 cron 작업 추가
        (crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * /usr/bin/certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
        log_success "인증서 자동 갱신 cron 작업 추가 완료"
    fi
}

# ============================================================================
# 완료 메시지
# ============================================================================
print_completion_message() {
    echo ""
    echo "============================================================"
    echo -e "${GREEN}✓ HTTPS 설정 완료!${NC}"
    echo "============================================================"
    echo ""
    echo "도메인: https://$DOMAIN"
    echo ""
    echo "MCP 클라이언트 설정:"
    echo '  {'
    echo '    "mcpServers": {'
    echo '      "container-sandbox": {'
    echo "        \"url\": \"https://$DOMAIN/\""
    echo '      }'
    echo '    }'
    echo '  }'
    echo ""
    echo "SSL 인증서:"
    echo "  - 인증서: /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    echo "  - 개인키: /etc/letsencrypt/live/$DOMAIN/privkey.pem"
    echo "  - 자동 갱신: 활성화됨"
    echo ""
    echo "유용한 명령어:"
    echo "  - Nginx 상태: systemctl status nginx"
    echo "  - 인증서 갱신 테스트: certbot renew --dry-run"
    echo "  - Nginx 설정 테스트: nginx -t"
    echo ""
    echo "============================================================"
}

# ============================================================================
# 메인 실행
# ============================================================================
main() {
    echo ""
    echo "============================================================"
    echo "  MCP Container Server - HTTPS 설정"
    echo "  도메인: $DOMAIN"
    echo "============================================================"
    echo ""
    
    detect_os
    install_nginx
    install_certbot
    create_nginx_config
    configure_firewall
    obtain_ssl_certificate
    update_app_config
    setup_auto_renewal
    print_completion_message
}

main "$@"
