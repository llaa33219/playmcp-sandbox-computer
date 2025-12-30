# Hostinger VPS 빠른 시작 가이드

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

## 4. 도메인 연결 (선택사항)

### A. Hostinger DNS 설정

1. **도메인** → **DNS 관리**
2. A 레코드 추가:
   - 이름: `mcp` (또는 원하는 서브도메인)
   - IPv4 주소: VPS IP 주소
   - TTL: 14400

### B. Nginx + Let's Encrypt HTTPS 설정

```bash
# Nginx 설치
sudo apt install -y nginx certbot python3-certbot-nginx

# Nginx 설정
sudo tee /etc/nginx/sites-available/mcp-container << 'EOF'
server {
    listen 80;
    server_name mcp.example.com;  # 실제 도메인으로 변경

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

# 사이트 활성화
sudo ln -s /etc/nginx/sites-available/mcp-container /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# SSL 인증서 발급
sudo certbot --nginx -d mcp.example.com

# BASE_URL 업데이트
sudo sed -i 's|BASE_URL=.*|BASE_URL=https://mcp.example.com|' /opt/mcp-container-server/.env
sudo systemctl restart mcp-container
```

---

## 5. 확인 및 테스트

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
      "url": "http://YOUR_VPS_IP:3000/"
    }
  }
}
```

---

## 6. 문제 해결

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

## 7. 유용한 명령어

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

## 8. 보안 권장사항

1. **SSH 키 인증 사용**: 비밀번호 대신 SSH 키 사용
2. **방화벽 설정**: 필요한 포트만 개방
3. **정기 업데이트**: `sudo apt update && sudo apt upgrade -y`
4. **fail2ban 설치**: SSH 브루트포스 방지

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```
