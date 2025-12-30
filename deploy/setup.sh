#!/bin/bash
#
# MCP Container Sandbox Server - Hostinger VPS 설치 스크립트
# 지원 OS: Ubuntu 20.04+, Debian 11+, Fedora 38+, CentOS Stream 9+, AlmaLinux 9+, Rocky Linux 9+
#
# 사용법:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/deploy/setup.sh | sudo bash
#   또는
#   wget -qO- https://raw.githubusercontent.com/YOUR_REPO/main/deploy/setup.sh | sudo bash
#
# 옵션:
#   --uninstall    설치 제거 (롤백)
#   --port PORT    사용할 포트 (기본: 3000)
#   --domain DOMAIN  도메인 설정 (선택사항)
#   --repo URL       Git 저장소 URL (로컬 소스 없을 때 사용)
#

set -e

# ============================================================================
# 색상 및 출력 함수
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================================
# 설정 변수
# ============================================================================
APP_NAME="mcp-container-server"
APP_DIR="/opt/$APP_NAME"
SERVICE_NAME="mcp-container"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BACKUP_DIR="/opt/${APP_NAME}-backup-$(date +%Y%m%d%H%M%S)"
DEFAULT_PORT=3000
REPO_URL=""  # Git 저장소 URL (선택사항, 로컬 설치 시 불필요)

# 명령줄 인자 파싱
PORT=$DEFAULT_PORT
DOMAIN=""
UNINSTALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --repo)
            REPO_URL="$2"
            shift 2
            ;;
        *)
            log_error "알 수 없는 옵션: $1"
            exit 1
            ;;
    esac
done

# ============================================================================
# OS 감지
# ============================================================================
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="${ID}"
        OS_VERSION="${VERSION_ID}"
        OS_NAME="${PRETTY_NAME}"
    else
        log_error "지원하지 않는 OS입니다. /etc/os-release를 찾을 수 없습니다."
        exit 1
    fi
    
    log_info "감지된 OS: $OS_NAME"
}

# ============================================================================
# 패키지 매니저 감지
# ============================================================================
detect_package_manager() {
    if command -v dnf &> /dev/null; then
        PKG_MGR="dnf"
        PKG_INSTALL="dnf install -y"
        PKG_UPDATE="dnf update -y"
    elif command -v apt-get &> /dev/null; then
        PKG_MGR="apt"
        PKG_INSTALL="apt-get install -y"
        PKG_UPDATE="apt-get update"
    elif command -v yum &> /dev/null; then
        PKG_MGR="yum"
        PKG_INSTALL="yum install -y"
        PKG_UPDATE="yum update -y"
    else
        log_error "지원하는 패키지 매니저를 찾을 수 없습니다."
        exit 1
    fi
    
    log_info "패키지 매니저: $PKG_MGR"
}

# ============================================================================
# 공개 IP 가져오기
# ============================================================================
get_public_ip() {
    PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "")
    if [ -z "$PUBLIC_IP" ]; then
        PUBLIC_IP=$(hostname -I | awk '{print $1}')
    fi
}

# ============================================================================
# 기존 설치 확인
# ============================================================================
check_existing_installation() {
    if [ -d "$APP_DIR" ]; then
        log_warn "기존 설치가 감지되었습니다: $APP_DIR"
        return 0
    fi
    return 1
}

# ============================================================================
# 백업 생성
# ============================================================================
create_backup() {
    if [ -d "$APP_DIR" ]; then
        log_info "기존 설치 백업 중: $BACKUP_DIR"
        cp -r "$APP_DIR" "$BACKUP_DIR"
        log_success "백업 완료: $BACKUP_DIR"
    fi
}

# ============================================================================
# 롤백 (설치 제거)
# ============================================================================
uninstall() {
    log_info "MCP Container Server 제거 중..."
    
    # 서비스 중지 및 제거
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "서비스 중지 중..."
        systemctl stop "$SERVICE_NAME"
    fi
    
    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "서비스 비활성화 중..."
        systemctl disable "$SERVICE_NAME"
    fi
    
    if [ -f "$SERVICE_FILE" ]; then
        log_info "서비스 파일 제거 중..."
        rm -f "$SERVICE_FILE"
        systemctl daemon-reload
    fi
    
    # 앱 디렉토리 제거
    if [ -d "$APP_DIR" ]; then
        log_info "애플리케이션 제거 중..."
        rm -rf "$APP_DIR"
    fi
    
    # 방화벽 규칙 제거
    if command -v firewall-cmd &> /dev/null; then
        firewall-cmd --permanent --remove-port=${PORT}/tcp 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
    elif command -v ufw &> /dev/null; then
        ufw delete allow ${PORT}/tcp 2>/dev/null || true
    fi
    
    log_success "제거 완료!"
    log_info "백업이 있다면 다음 위치에서 찾을 수 있습니다: /opt/${APP_NAME}-backup-*"
    exit 0
}

# ============================================================================
# Podman 설치
# ============================================================================
install_podman() {
    if command -v podman &> /dev/null; then
        log_info "Podman이 이미 설치되어 있습니다: $(podman --version)"
        return 0
    fi
    
    log_info "Podman 설치 중..."
    
    case $OS_ID in
        ubuntu|debian)
            $PKG_UPDATE
            $PKG_INSTALL podman
            ;;
        fedora)
            $PKG_INSTALL podman
            ;;
        centos|almalinux|rocky|rhel)
            $PKG_INSTALL podman
            ;;
        *)
            log_error "이 OS에서 Podman 자동 설치를 지원하지 않습니다: $OS_ID"
            log_info "수동으로 Podman을 설치한 후 다시 실행해주세요."
            exit 1
            ;;
    esac
    
    log_success "Podman 설치 완료: $(podman --version)"
}

# ============================================================================
# Node.js 설치
# ============================================================================
install_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1 | tr -d 'v')
        
        if [ "$NODE_MAJOR" -ge 20 ]; then
            log_info "Node.js가 이미 설치되어 있습니다: $NODE_VERSION"
            return 0
        else
            log_warn "Node.js 버전이 낮습니다 ($NODE_VERSION). Node.js 20+ 설치 중..."
        fi
    fi
    
    log_info "Node.js 20 LTS 설치 중..."
    
    case $OS_ID in
        ubuntu|debian)
            # NodeSource 저장소 사용
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            $PKG_INSTALL nodejs
            ;;
        fedora)
            $PKG_INSTALL nodejs npm
            ;;
        centos|almalinux|rocky|rhel)
            # NodeSource 저장소 사용
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
            $PKG_INSTALL nodejs
            ;;
        *)
            log_error "이 OS에서 Node.js 자동 설치를 지원하지 않습니다: $OS_ID"
            exit 1
            ;;
    esac
    
    log_success "Node.js 설치 완료: $(node --version)"
}

# ============================================================================
# Git 설치
# ============================================================================
install_git() {
    if command -v git &> /dev/null; then
        log_info "Git이 이미 설치되어 있습니다: $(git --version)"
        return 0
    fi
    
    log_info "Git 설치 중..."
    $PKG_INSTALL git
    log_success "Git 설치 완료: $(git --version)"
}

# ============================================================================
# 애플리케이션 설치
# ============================================================================
install_application() {
    log_info "애플리케이션 설치 중..."
    
    # 디렉토리 생성
    mkdir -p "$APP_DIR"
    
    # 현재 디렉토리에서 복사하거나 Git에서 클론
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    
    if [ -f "$PROJECT_DIR/package.json" ] && grep -q "mcp-container-server" "$PROJECT_DIR/package.json" 2>/dev/null; then
        log_info "프로젝트 디렉토리에서 복사 중: $PROJECT_DIR"
        cp -r "$PROJECT_DIR/"* "$APP_DIR/"
        cp -r "$PROJECT_DIR/".* "$APP_DIR/" 2>/dev/null || true
    elif [ -f "package.json" ] && grep -q "mcp-container-server" package.json 2>/dev/null; then
        log_info "현재 디렉토리에서 복사 중..."
        cp -r . "$APP_DIR/"
    elif [ -n "$REPO_URL" ]; then
        log_info "Git 저장소에서 클론 중: $REPO_URL"
        git clone "$REPO_URL" "$APP_DIR"
    else
        log_error "소스를 찾을 수 없습니다."
        log_info ""
        log_info "다음 방법 중 하나를 사용하세요:"
        log_info "  1. 프로젝트 디렉토리에서 이 스크립트 실행:"
        log_info "     cd /path/to/project && sudo bash deploy/setup.sh"
        log_info ""
        log_info "  2. Git 저장소 URL을 인자로 전달:"
        log_info "     sudo bash setup.sh --repo https://github.com/user/repo.git"
        exit 1
    fi
    
    cd "$APP_DIR"
    
    # 의존성 설치
    log_info "NPM 의존성 설치 중..."
    npm install
    
    # TypeScript 빌드
    log_info "TypeScript 빌드 중..."
    npm run build
    
    # 프로덕션 의존성만 유지
    npm prune --omit=dev
    
    log_success "애플리케이션 설치 완료"
}

# ============================================================================
# 환경 설정 파일 생성
# ============================================================================
create_env_file() {
    log_info "환경 설정 파일 생성 중..."
    
    get_public_ip
    
    if [ -n "$DOMAIN" ]; then
        BASE_URL="https://$DOMAIN"
    else
        BASE_URL="http://$PUBLIC_IP:$PORT"
    fi
    
    cat > "$APP_DIR/.env" << EOF
# MCP Container Server 환경 설정
# 생성일: $(date)

# 서버 포트
PORT=$PORT

# 공개 URL (파일 URL 생성에 사용)
BASE_URL=$BASE_URL

# Node.js 환경
NODE_ENV=production
EOF
    
    chmod 600 "$APP_DIR/.env"
    log_success "환경 설정 파일 생성 완료: $APP_DIR/.env"
}

# ============================================================================
# Podman 스토리지 설정
# ============================================================================
configure_podman_storage() {
    log_info "Podman 스토리지 설정 중..."
    
    # VFS 스토리지 드라이버 설정 (권한 문제 방지)
    mkdir -p /etc/containers
    
    if [ ! -f /etc/containers/storage.conf ] || ! grep -q "driver = \"vfs\"" /etc/containers/storage.conf; then
        cat > /etc/containers/storage.conf << 'EOF'
[storage]
driver = "vfs"
graphroot = "/var/lib/containers/storage"
EOF
        log_success "Podman 스토리지 설정 완료"
    else
        log_info "Podman 스토리지가 이미 설정되어 있습니다"
    fi
    
    # 스토리지 디렉토리 생성
    mkdir -p /var/lib/containers/storage
}

# ============================================================================
# systemd 서비스 설정
# ============================================================================
setup_systemd_service() {
    log_info "systemd 서비스 설정 중..."
    
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=MCP Container Sandbox Server
Documentation=https://github.com/YOUR_USERNAME/YOUR_REPO
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/dist/index.js
Restart=always
RestartSec=10

# 보안 설정
NoNewPrivileges=false
ProtectSystem=false
PrivateTmp=false

# 로깅
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# 리소스 제한
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF
    
    # systemd 재로드 및 서비스 활성화
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl start "$SERVICE_NAME"
    
    # 서비스 상태 확인
    sleep 2
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "서비스가 성공적으로 시작되었습니다"
    else
        log_error "서비스 시작 실패. 로그를 확인하세요: journalctl -u $SERVICE_NAME -f"
        exit 1
    fi
}

# ============================================================================
# 방화벽 설정
# ============================================================================
configure_firewall() {
    log_info "방화벽 설정 중..."
    
    if command -v firewall-cmd &> /dev/null; then
        # Firewalld (Fedora, CentOS, RHEL)
        firewall-cmd --permanent --add-port=${PORT}/tcp
        firewall-cmd --reload
        log_success "firewalld 규칙 추가 완료: 포트 $PORT"
    elif command -v ufw &> /dev/null; then
        # UFW (Ubuntu, Debian)
        ufw allow ${PORT}/tcp
        log_success "ufw 규칙 추가 완료: 포트 $PORT"
    else
        log_warn "방화벽이 감지되지 않았습니다. 수동으로 포트 $PORT를 열어주세요."
    fi
}

# ============================================================================
# Alpine 이미지 미리 다운로드
# ============================================================================
pull_alpine_image() {
    log_info "Alpine Linux 이미지 다운로드 중 (최초 컨테이너 생성 속도 향상)..."
    podman pull docker.io/library/alpine:latest || true
    log_success "Alpine 이미지 다운로드 완료"
}

# ============================================================================
# 설치 완료 메시지
# ============================================================================
print_completion_message() {
    get_public_ip
    
    echo ""
    echo "============================================================"
    echo -e "${GREEN}✓ MCP Container Sandbox Server 설치 완료!${NC}"
    echo "============================================================"
    echo ""
    echo "서버 정보:"
    echo "  - 포트: $PORT"
    echo "  - 공개 IP: $PUBLIC_IP"
    if [ -n "$DOMAIN" ]; then
        echo "  - 도메인: $DOMAIN"
        echo "  - MCP 엔드포인트: https://$DOMAIN/"
    else
        echo "  - MCP 엔드포인트: http://$PUBLIC_IP:$PORT/"
    fi
    echo "  - 헬스체크: http://$PUBLIC_IP:$PORT/health"
    echo ""
    echo "유용한 명령어:"
    echo "  - 서비스 상태: systemctl status $SERVICE_NAME"
    echo "  - 로그 확인: journalctl -u $SERVICE_NAME -f"
    echo "  - 서비스 재시작: systemctl restart $SERVICE_NAME"
    echo "  - 서비스 중지: systemctl stop $SERVICE_NAME"
    echo ""
    echo "제거 방법:"
    echo "  sudo bash deploy/setup.sh --uninstall"
    echo ""
    echo "============================================================"
}

# ============================================================================
# 메인 실행
# ============================================================================
main() {
    echo ""
    echo "============================================================"
    echo "  MCP Container Sandbox Server - Hostinger VPS 설치"
    echo "============================================================"
    echo ""
    
    # Root 권한 확인
    if [ "$EUID" -ne 0 ]; then
        log_error "이 스크립트는 root 권한으로 실행해야 합니다."
        log_info "다음 명령어로 실행하세요: sudo bash $0"
        exit 1
    fi
    
    # 제거 모드
    if [ "$UNINSTALL" = true ]; then
        uninstall
    fi
    
    # OS 및 패키지 매니저 감지
    detect_os
    detect_package_manager
    
    # 기존 설치 확인 및 백업
    if check_existing_installation; then
        create_backup
        log_info "기존 서비스 중지 중..."
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    fi
    
    # 의존성 설치
    log_info "시스템 패키지 업데이트 중..."
    $PKG_UPDATE || true
    
    install_git
    install_podman
    install_nodejs
    
    # Podman 설정
    configure_podman_storage
    
    # 애플리케이션 설치
    install_application
    
    # 환경 설정
    create_env_file
    
    # 서비스 설정
    setup_systemd_service
    
    # 방화벽 설정
    configure_firewall
    
    # Alpine 이미지 다운로드
    pull_alpine_image
    
    # 헬스체크 검증
    verify_health_check
    
    # 완료 메시지
    print_completion_message
}

# ============================================================================
# 헬스체크 검증
# ============================================================================
verify_health_check() {
    log_info "서버 헬스체크 검증 중..."
    
    local max_attempts=10
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "http://localhost:$PORT/health" | grep -q '"status":"ok"'; then
            log_success "헬스체크 통과! 서버가 정상적으로 응답합니다."
            return 0
        fi
        
        log_info "서버 시작 대기 중... ($attempt/$max_attempts)"
        sleep 2
        attempt=$((attempt + 1))
    done
    
    log_warn "헬스체크 타임아웃. 서버가 아직 시작 중일 수 있습니다."
    log_info "수동으로 확인하세요: curl http://localhost:$PORT/health"
}

# 스크립트 실행
main "$@"
