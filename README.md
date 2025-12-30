# MCP 컨테이너 샌드박스 서버

AI가 리눅스 컨테이너를 생성하고 명령어를 실행할 수 있는 MCP (Model Context Protocol) 서버입니다.

## 주요 기능

- **컨테이너 생성**: 격리된 Alpine Linux 샌드박스 환경 제공
- **명령어 실행**: 컨테이너 내에서 쉘 명령어 실행
- **파일 URL 생성**: 컨테이너 내부 파일에 대한 외부 접근 URL 생성
- **자동 정리**: 2시간 후 컨테이너 자동 파괴

## MCP 도구

| 도구 | 설명 |
|------|------|
| `create_container` | 새로운 리눅스 컨테이너 생성 |
| `execute_command` | 컨테이너에서 명령어 실행 |
| `check_container` | 컨테이너 상태 확인 |
| `destroy_container` | 컨테이너 파괴 |
| `get_file_url` | 컨테이너 파일에 대한 접근 URL 생성 |

## 보안 설정

컨테이너는 다음 보안 옵션으로 실행됩니다:

- `--memory=256m`: 메모리 256MB 제한
- `--cpus=0.5`: CPU 50% 제한
- `--pids-limit=100`: 프로세스 100개 제한 (fork bomb 방지)
- `--cap-drop=ALL`: 모든 Linux capabilities 제거
- `--security-opt=no-new-privileges`: 권한 상승 방지

## 배포

### VPS 배포 (Hostinger, Vultr, DigitalOcean 등)

VPS에 직접 배포하면 Container-in-Container 보안 제한 없이 완전한 제어권을 가질 수 있습니다.

**라이브 서버**: `https://playmcp-sandbox-computer.bloupla.net/`

#### 원클릭 설치 (권장)

프로젝트를 서버에 클론한 후:

```bash
# 프로젝트를 서버에 업로드 후
cd /path/to/project
sudo bash deploy/setup.sh
```

또는 옵션과 함께:

```bash
# 커스텀 포트 사용
sudo bash deploy/setup.sh --port 8080

# 도메인 설정 (HTTPS용)
sudo bash deploy/setup.sh --domain example.com
```

#### 지원 OS

- Ubuntu 20.04+
- Debian 11+
- Fedora 38+
- CentOS Stream 9+
- AlmaLinux 9+
- Rocky Linux 9+

#### 설치 후 확인

```bash
# 서비스 상태 확인
systemctl status mcp-container

# 로그 확인
journalctl -u mcp-container -f

# 헬스체크
curl http://YOUR_SERVER_IP:3000/health
```

#### 제거 (롤백)

```bash
sudo bash deploy/setup.sh --uninstall
```

#### 수동 설치

원클릭 설치가 작동하지 않는 경우:

```bash
# 1. 의존성 설치 (Ubuntu/Debian)
sudo apt update
sudo apt install -y podman nodejs npm git

# 또는 (Fedora/CentOS)
sudo dnf install -y podman nodejs npm git

# 2. 프로젝트 설정
# 프로젝트 파일을 /opt/mcp-container-server에 복사
cp -r /path/to/project /opt/mcp-container-server
cd /opt/mcp-container-server
npm install
npm run build

# 3. 환경변수 설정
cat > .env << EOF
PORT=3000
BASE_URL=http://YOUR_SERVER_IP:3000
NODE_ENV=production
EOF

# 4. systemd 서비스 설정
sudo cp deploy/mcp-container.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mcp-container
sudo systemctl start mcp-container

# 5. 방화벽 설정
sudo ufw allow 3000/tcp  # Ubuntu
# 또는
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload  # Fedora/CentOS
```

#### HTTPS 설정

```bash
# 도메인 연결 후 HTTPS 자동 설정
sudo bash deploy/setup-https.sh --domain your-domain.com
```

---

### GitHub Actions 자동 배포 (CI/CD)

main 브랜치에 푸시하면 자동으로 VPS에 배포됩니다.

1. VPS에서 배포용 SSH 키 생성:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions -N ""
   cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
   ```

2. GitHub Secrets 설정 (Settings → Secrets → Actions):
   - `VPS_HOST`: VPS IP 또는 도메인
   - `VPS_USER`: `root`
   - `VPS_SSH_KEY`: SSH 개인키 내용

자세한 내용은 [deploy/CICD-SETUP.md](deploy/CICD-SETUP.md) 참조

---

### Railway 배포 (제한적)

> ⚠️ **주의**: Railway는 Container-in-Container를 보안상 제한할 수 있습니다. VPS 배포를 권장합니다.

#### 1. Railway 프로젝트 생성

```bash
# Railway CLI 설치
npm install -g @railway/cli

# 로그인 및 배포
railway login
railway init
railway up
```

#### 2. 환경변수 설정

Railway 대시보드에서 다음 환경변수를 설정하세요:

| 환경변수 | 설명 | 예시 |
|----------|------|------|
| `BASE_URL` | 서버 공개 URL | `https://your-app.up.railway.app` |
| `PORT` | 포트 (자동 설정됨) | `3000` |

#### 3. Volume 설정 (권장)

성능 향상을 위해 Railway 대시보드에서 Volume을 추가하세요:

1. Settings → Volumes → Add Volume
2. 마운트 경로: `/var/lib/containers/storage`

Volume을 추가하면 컨테이너 이미지가 캐싱되어 생성 속도가 향상됩니다.

**참고**: 컨테이너가 root가 아닌 사용자로 실행되면 환경변수 `RAILWAY_RUN_UID=0`을 설정하세요.

## 로컬 개발

### 요구사항

- Node.js 20+
- Podman

### 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start
```

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 서버 정보 또는 SSE 스트림 |
| POST | `/` | MCP JSON-RPC 메시지 처리 |
| DELETE | `/` | 세션 종료 |
| GET | `/health` | 헬스체크 |
| GET | `/files/:fileId` | 파일 다운로드 |

## 사용 예시

### 1. 컨테이너 생성 및 명령어 실행

```
사용자: "터미널 사용해서 현재 날짜 알려줘"

AI:
1. create_container 호출 → container_id 받음
2. execute_command(container_id, "date") 호출
3. 결과 반환
```

### 2. 파일 생성 및 URL 공유

```
사용자: "Hello World를 파일로 만들어서 공유해줘"

AI:
1. create_container 호출
2. execute_command(container_id, "echo 'Hello World' > /tmp/hello.txt")
3. get_file_url(container_id, "/tmp/hello.txt") 호출
4. 파일 URL 반환
```

## 제한사항

- 컨테이너는 생성 후 **2시간** 뒤 자동 파괴됩니다
- 명령어 실행이 **3초** 이상 소요되면 비동기 모드로 전환됩니다
- 파일 URL은 컨테이너 파괴 시 더 이상 접근할 수 없습니다

## 기술 스택

- **Runtime**: Node.js + TypeScript
- **MCP SDK**: @modelcontextprotocol/sdk
- **컨테이너**: Podman (VFS 스토리지 드라이버)
- **HTTP 서버**: Express
- **배포**: Railway (Docker)

## 라이선스

MIT
