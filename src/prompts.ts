import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * MCP 서버에 프롬프트들을 등록합니다.
 * 프롬프트는 AI가 특정 작업을 수행할 때 참고할 수 있는 가이드라인입니다.
 */
export function registerPrompts(server: McpServer): void {
  // 컴퓨터/터미널 사용 프롬프트
  server.prompt(
    'use_computer',
    '컴퓨터 사용, 터미널 사용, CLI 사용, CMD 사용, 명령어 실행 등의 요청을 처리하는 방법을 안내합니다.',
    {},
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `당신은 사용자를 위해 리눅스 컨테이너에서 명령어를 실행할 수 있습니다.

## 사용 가능한 도구

1. **create_container**: 새로운 샌드박스 컨테이너를 생성합니다.
2. **execute_command**: 컨테이너에서 명령어를 실행합니다.
3. **check_container**: 컨테이너 상태를 확인합니다.
4. **destroy_container**: 컨테이너를 파괴합니다.

## 사용 순서

사용자가 "컴퓨터 사용", "터미널 사용", "CLI 사용", "CMD 사용", "명령어 실행" 등을 요청하면:

1. 먼저 **create_container**를 호출하여 새 컨테이너를 생성하세요.
2. 반환된 container_id를 사용하여 **execute_command**로 명령어를 실행하세요.
3. 작업이 끝나면 **destroy_container**로 컨테이너를 정리할 수 있습니다 (선택사항, 2시간 후 자동 파괴됨).

## 주의사항

- 명령어 실행이 3초 이상 걸리면 비동기 모드로 전환됩니다.
- 비동기 모드에서는 잠시 기다린 후 check_container 또는 execute_command로 결과를 확인하세요.
- 컨테이너는 Alpine Linux 기반이며, 인터넷 연결이 가능합니다.
- 필요한 패키지는 'apk add <패키지명>'으로 설치할 수 있습니다.`,
            },
          },
        ],
      };
    }
  );

  // 터미널 프롬프트 (별칭)
  server.prompt(
    'terminal',
    '터미널/CLI/CMD 사용 요청 시 컨테이너 도구 사용 방법을 안내합니다.',
    {},
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `사용자가 터미널, CLI, CMD, 명령줄 사용을 요청했습니다.

다음 단계를 따라주세요:

1. **create_container** 도구를 호출하여 새 리눅스 컨테이너를 생성하세요.
2. 생성된 container_id를 사용하여 **execute_command** 도구로 원하는 명령어를 실행하세요.

예시:
- 파일 목록 보기: execute_command(container_id, "ls -la")
- 패키지 설치: execute_command(container_id, "apk add curl")
- 네트워크 테스트: execute_command(container_id, "ping -c 3 google.com")
- 파일 생성: execute_command(container_id, "echo 'hello' > test.txt")

컨테이너는 격리된 샌드박스 환경이므로 안전하게 다양한 명령어를 실행할 수 있습니다.`,
            },
          },
        ],
      };
    }
  );

  // 코드 실행 프롬프트
  server.prompt(
    'run_code',
    '코드 실행 요청 시 컨테이너에서 실행하는 방법을 안내합니다.',
    {},
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `사용자가 코드 실행을 요청했습니다.

컨테이너에서 코드를 실행하는 방법:

1. **create_container**로 컨테이너 생성
2. 필요한 런타임 설치 (예: apk add python3, apk add nodejs)
3. **execute_command**로 코드 실행

Python 예시:
\`\`\`
execute_command(container_id, "apk add python3")
execute_command(container_id, "python3 -c 'print(1+1)'")
\`\`\`

Node.js 예시:
\`\`\`
execute_command(container_id, "apk add nodejs")
execute_command(container_id, "node -e 'console.log(1+1)'")
\`\`\`

Shell 스크립트 예시:
\`\`\`
execute_command(container_id, "echo '#!/bin/sh\\necho Hello' > script.sh && sh script.sh")
\`\`\``,
            },
          },
        ],
      };
    }
  );
}
