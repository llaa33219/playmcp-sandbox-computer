# GitHub Actions CI/CD 설정 가이드

이 문서는 GitHub Actions를 사용하여 main 브랜치에 푸시할 때 자동으로 Hostinger VPS에 배포하는 방법을 설명합니다.

## 개요

```
[GitHub Push] → [GitHub Actions] → [SSH to VPS] → [Pull & Build] → [Restart Service] → [Health Check]
```

## 1. VPS 초기 설정

### 1.1 서버에 Git 저장소 클론

먼저 VPS에 SSH로 접속하여 초기 설정을 완료합니다:

```bash
# SSH 접속
ssh root@YOUR_VPS_IP

# 프로젝트 설치 (최초 1회)
cd /opt
git clone https://github.com/llaa33219/playmcp-sandbox-computer.git mcp-container-server
cd mcp-container-server

# 초기 설치 실행
sudo bash deploy/setup.sh
```

### 1.2 SSH 키 생성 (배포용)

VPS에서 GitHub Actions용 SSH 키를 생성합니다:

```bash
# VPS에서 실행
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy -N ""

# 공개키를 authorized_keys에 추가
cat ~/.ssh/github_actions_deploy.pub >> ~/.ssh/authorized_keys

# 개인키 내용 확인 (이 내용을 GitHub Secrets에 추가)
cat ~/.ssh/github_actions_deploy
```

## 2. GitHub Secrets 설정

GitHub 저장소에서 다음 Secrets를 추가합니다:

1. **저장소** → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** 클릭

### 필수 Secrets

| Secret 이름 | 설명 | 예시 |
|-------------|------|------|
| `VPS_HOST` | VPS IP 또는 도메인 | `playmcp-sandbox-computer.bloupla.net` 또는 `123.45.67.89` |
| `VPS_USER` | SSH 사용자명 | `root` |
| `VPS_SSH_KEY` | SSH 개인키 전체 내용 | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

### 선택 Secrets

| Secret 이름 | 설명 | 기본값 |
|-------------|------|--------|
| `VPS_PORT` | SSH 포트 | `22` |

### SSH 키 추가 방법

1. VPS에서 생성한 개인키 내용을 복사:
   ```bash
   cat ~/.ssh/github_actions_deploy
   ```

2. GitHub에서 `VPS_SSH_KEY` Secret 생성 시 전체 내용 붙여넣기:
   ```
   -----BEGIN OPENSSH PRIVATE KEY-----
   b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
   ...
   -----END OPENSSH PRIVATE KEY-----
   ```

## 3. 워크플로우 동작

### 트리거 조건

- `main` 브랜치에 푸시할 때 자동 실행
- GitHub Actions 탭에서 수동 실행 가능 (workflow_dispatch)

### 배포 프로세스

1. **코드 체크아웃**: 최신 코드 가져오기
2. **SSH 연결 설정**: Secrets에서 SSH 키 로드
3. **VPS 배포**:
   - 기존 버전 백업
   - `git pull`로 최신 코드 가져오기
   - `npm ci` 의존성 설치
   - `npm run build` 빌드
   - `systemctl restart` 서비스 재시작
4. **헬스체크**: 서버 응답 확인
5. **롤백**: 헬스체크 실패 시 자동 롤백

### 롤백 정책

- 헬스체크 10회 실패 시 자동 롤백
- 최근 3개의 백업만 유지
- 백업 위치: `/opt/mcp-container-server-backup-YYYYMMDDHHMMSS`

## 4. 수동 배포

GitHub Actions 탭에서 수동으로 배포할 수 있습니다:

1. **Actions** 탭 클릭
2. **Deploy to VPS** 워크플로우 선택
3. **Run workflow** 버튼 클릭
4. 브랜치 선택 후 **Run workflow** 클릭

## 5. 로그 확인

### GitHub Actions 로그

1. **Actions** 탭에서 실행 중인 워크플로우 클릭
2. 각 단계별 로그 확인

### VPS 서버 로그

```bash
# 서비스 로그
journalctl -u mcp-container -f

# 최근 배포 로그
journalctl -u mcp-container --since "1 hour ago"
```

## 6. 문제 해결

### SSH 연결 실패

```bash
# VPS에서 SSH 설정 확인
cat /etc/ssh/sshd_config | grep -E "^(PermitRootLogin|PubkeyAuthentication)"

# 권한 확인
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 헬스체크 실패

```bash
# VPS에서 직접 헬스체크
curl http://localhost:3000/health

# 서비스 상태 확인
systemctl status mcp-container

# 로그 확인
journalctl -u mcp-container -n 50
```

### 빌드 실패

```bash
# VPS에서 수동 빌드 테스트
cd /opt/mcp-container-server
npm ci
npm run build
```

## 7. 보안 권장사항

1. **전용 SSH 키 사용**: 배포 전용 SSH 키를 별도로 생성
2. **IP 제한**: 가능하면 GitHub Actions IP만 SSH 허용
3. **정기적 키 교체**: SSH 키를 주기적으로 교체
4. **최소 권한**: 가능하면 root 대신 전용 사용자 사용

### GitHub Actions IP 대역 (선택적 IP 제한)

GitHub Actions의 IP 대역은 변경될 수 있으므로, 필요시 API로 확인:
```bash
curl -s https://api.github.com/meta | jq '.actions'
```

## 8. 알림 설정 (선택)

### Slack 알림

`.github/workflows/deploy.yml`에 Slack 알림 추가:

```yaml
- name: Notify Slack on Success
  if: success()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {"text": "✅ 배포 성공: ${{ github.repository }}"}
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Discord 알림

```yaml
- name: Notify Discord
  if: always()
  uses: sarisia/actions-status-discord@v1
  with:
    webhook: ${{ secrets.DISCORD_WEBHOOK }}
    status: ${{ job.status }}
```
