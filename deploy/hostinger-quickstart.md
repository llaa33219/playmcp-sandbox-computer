# Hostinger VPS 빠른 시작 가이드

**도메인**: `playmcp-sandbox-computer.bloupla.net`

## 목차
1. [VPS 준비](#1-hostinger-vps-준비)
2. [원클릭 설치](#2-원클릭-설치)
3. [방화벽 설정](#3-hostinger-방화벽-설정)
4. [도메인 연결 + HTTPS](#4-도메인-연결--https-설정)
5. [GitHub Actions 자동 배포](#5-github-actions-자동-배포-설정)
6. [확인 및 테스트](#6-확인-및-테스트)
7. [문제 해결](#7-문제-해결)

---

## 1. Hostinger VPS 준비

### VPS 플랜 선택
- **최소 권장**: VPS 1 (1 vCPU, 4GB RAM)
- **권장**: VPS 2 (2 vCPU, 8GB RAM)
- **OS**: Ubuntu 22.04 또는 AlmaLinux 9 선택

### VPS 접속
Hostinger 대시보드에서:
1. VPS 관리 페이지로 이동
2. SSH 접속 정보 확인 (IP, 포트, 비밀번호)
3. SSH 클라이언트로 접속

```bash
ssh root@YOUR_VPS_IP
```

---

## 2. 원클릭 설치

### 방법 A: 프로젝트 업로드 후 설치 (권장)

```bash
# 프로젝트를 서버에 업로드 (scp, sftp, git clone 등)
# 예: scp -r ./프로젝트폴더 root@YOUR_VPS_IP:/root/

cd /root/프로젝트폴더

# 원클릭 설치
sudo bash deploy/setup.sh
```

### 방법 B: 커스텀 설정

```bash
# 포트 8080 사용
sudo bash deploy/setup.sh --port 8080

# 도메인 연결 (HTTPS 사용 시)
sudo bash deploy/setup.sh --domain mcp.example.com
```

---

## 3. Hostinger 방화벽 설정

Hostinger VPS 대시보드에서도 방화벽을 설정해야 합니다:

1. **VPS 대시보드** → **방화벽** 탭
2. **새 규칙 추가**:
   - 프로토콜: TCP
   - 포트: 3000 (또는 설정한 포트)
   - 소스: 모든 IP (0.0.0.0/0) 또는 특정 IP
3. **저장**

---

## 4. 도메인 연결 + HTTPS 설정

### A. DNS 설정 (Hostinger 또는 Cloudflare)

1. DNS 관리 페이지로 이동
2. A 레코드 추가:
   - **이름**: `playmcp-sandbox-computer` (또는 전체 서브도메인)
   - **IPv4 주소**: VPS IP 주소
   - **TTL**: 14400 (또는 Auto)

### B. HTTPS 원클릭 설정 (권장)

```bash
# HTTPS 자동 설정 스크립트 실행
sudo bash deploy/setup-https.sh --domain playmcp-sandbox-computer.bloupla.net
```

이 스크립트가 자동으로:
- Nginx 설치 및 설정
- Let's Encrypt SSL 인증서 발급
- HTTPS 리다이렉트 설정
- BASE_URL 업데이트
- 인증서 자동 갱신 설정

### C. 수동 HTTPS 설정 (선택)

```bash
# Nginx 및 Certbot 설치
sudo apt install -y nginx certbot python3-certbot-nginx

# SSL 인증서 발급
sudo certbot --nginx -d playmcp-sandbox-computer.bloupla.net

# BASE_URL 업데이트
sudo sed -i 's|BASE_URL=.*|BASE_URL=https://playmcp-sandbox-computer.bloupla.net|' /opt/mcp-container-server/.env
sudo systemctl restart mcp-container
```

---

## 5. GitHub Actions 자동 배포 설정

GitHub에 코드를 푸시하면 자동으로 VPS에 배포됩니다.

### A. SSH 키 생성 (VPS에서)

```bash
# 배포용 SSH 키 생성
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions -N ""

# 공개키 등록
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys

# 개인키 확인 (GitHub Secrets에 추가할 내용)
cat ~/.ssh/github_actions
```

### B. GitHub Secrets 설정

GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 이름 | 값 |
|-------------|----|
| `VPS_HOST` | `playmcp-sandbox-computer.bloupla.net` (또는 VPS IP) |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | SSH 개인키 전체 내용 |
| `VPS_PORT` | `22` (선택사항) |

### C. 자동 배포 테스트

1. 코드 변경 후 `main` 브랜치에 푸시
2. **Actions** 탭에서 배포 상태 확인
3. 배포 완료 후 헬스체크 자동 실행

자세한 내용은 [CICD-SETUP.md](./CICD-SETUP.md) 참조

---

## 6. 확인 및 테스트

### 서비스 상태 확인

```bash
# 서비스 상태
systemctl status mcp-container

# 실시간 로그
journalctl -u mcp-container -f
```

### API 테스트

```bash
# 헬스체크
curl http://YOUR_VPS_IP:3000/health

# 서버 정보
curl http://YOUR_VPS_IP:3000/
```

### MCP 클라이언트 연결

Claude Desktop 또는 다른 MCP 클라이언트에서:

```json
{
  "mcpServers": {
    "container-sandbox": {
      "url": "https://playmcp-sandbox-computer.bloupla.net/"
    }
  }
}
```

---

## 7. 문제 해결

### Podman 권한 오류

```bash
# Podman 스토리지 재설정
sudo rm -rf /var/lib/containers/storage
sudo mkdir -p /var/lib/containers/storage
sudo systemctl restart mcp-container
```

### 포트 충돌

```bash
# 사용 중인 포트 확인
sudo netstat -tlnp | grep 3000

# 다른 포트로 변경
sudo sed -i 's/PORT=3000/PORT=8080/' /opt/mcp-container-server/.env
sudo systemctl restart mcp-container
```

### 메모리 부족

```bash
# 스왑 추가 (2GB)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 서비스 재시작

```bash
sudo systemctl restart mcp-container
```

### 완전 재설치

```bash
# 제거 후 재설치
sudo bash deploy/setup.sh --uninstall
sudo bash deploy/setup.sh
```

---

## 8. 유용한 명령어

| 작업 | 명령어 |
|------|--------|
| 서비스 시작 | `sudo systemctl start mcp-container` |
| 서비스 중지 | `sudo systemctl stop mcp-container` |
| 서비스 재시작 | `sudo systemctl restart mcp-container` |
| 서비스 상태 | `sudo systemctl status mcp-container` |
| 로그 확인 | `journalctl -u mcp-container -f` |
| 환경변수 편집 | `sudo nano /opt/mcp-container-server/.env` |
| 완전 제거 | `sudo bash deploy/setup.sh --uninstall` |

---

## 9. 보안 권장사항

1. **SSH 키 인증 사용**: 비밀번호 대신 SSH 키 사용
2. **방화벽 설정**: 필요한 포트만 개방
3. **정기 업데이트**: `sudo apt update && sudo apt upgrade -y`
4. **fail2ban 설치**: SSH 브루트포스 방지

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```
