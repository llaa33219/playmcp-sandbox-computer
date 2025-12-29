# Computer Use MCP Server

AI가 리눅스 컨테이너를 생성하고 관리할 수 있는 MCP(Model Context Protocol) 서버입니다.

## 기능

이 MCP 서버는 AI에게 4가지 도구를 제공합니다:

### 1. `create_container` - 컨테이너 생성
- 샌드박스 환경의 가벼운 Alpine Linux 컨테이너를 생성합니다
- 고유 ID를 반환합니다
- 생성 후 2시간이 지나면 자동으로 파괴됩니다
- 인터넷 연결이 가능합니다

### 2. `check_container` - 컨테이너 확인
- 특정 ID의 컨테이너 상태를 확인합니다
- 실행 상태, 생성 시간, 남은 시간 등의 정보를 반환합니다

### 3. `execute_command` - 명령어 실행
- 특정 ID의 컨테이너에서 쉘 명령어를 실행합니다
- 실행이 3초 이상 소요되면 비동기 모드로 전환됩니다
  - 타임아웃 회피를 위해 성공 메시지와 함께 나중에 다시 확인하라는 안내를 제공합니다
- 3초 미만이면 명령어 실행 결과를 즉시 반환합니다

### 4. `destroy_container` - 컨테이너 파괴
- 특정 ID의 컨테이너를 즉시 파괴합니다
- 잘못 설정된 컨테이너를 정리할 때 사용합니다

## 기술 사양

- **컨테이너 이미지**: Alpine Linux (가벼움)
- **자원 제한**:
  - 메모리: 128MB
  - CPU: 50%
  - 프로세스 수: 50개
- **자동 만료**: 생성 후 2시간
- **네트워크**: 인터넷 연결 가능 (bridge 모드)

## 설치 및 실행

### 로컬 개발

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 프로덕션 빌드
npm run build

# 프로덕션 실행
npm start
```

### Docker 실행

```bash
# 이미지 빌드
docker build -t computer-use-mcp .

# 컨테이너 실행 (Docker 소켓 마운트 필요)
docker run -d \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  computer-use-mcp
```

### Railway 배포

1. Railway 프로젝트에 이 저장소를 연결합니다
2. **중요**: Railway에서 Docker-in-Docker를 사용하려면 별도의 설정이 필요합니다:
   - Railway의 Docker 빌더를 사용합니다 (`railway.toml` 설정 포함)
   - Docker 소켓 접근 권한이 필요합니다

## API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/mcp` | POST | MCP 프로토콜 엔드포인트 (Streamable HTTP) |
| `/mcp` | DELETE | 세션 종료 |
| `/health` | GET | 서버 상태 확인 |
| `/` | GET | 서버 정보 |

## MCP 클라이언트 설정 예시

```json
{
  "mcpServers": {
    "computer-use": {
      "url": "https://your-railway-url.railway.app/mcp",
      "transport": "streamable-http"
    }
  }
}
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | 3000 | 서버 포트 |

## 라이선스

MIT
