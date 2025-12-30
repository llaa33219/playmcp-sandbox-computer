import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createContainer,
  checkContainer,
  executeCommand,
  destroyContainer,
  checkAsyncCommandStatus,
} from './container-manager.js';
import { getFileUrl } from './file-manager.js';

/**
 * MCP 서버에 도구들을 등록합니다.
 */
export function registerTools(server: McpServer): void {
  // 1. 컨테이너 생성 도구
  server.tool(
    'create_container',
    '새로운 리눅스 컨테이너를 생성합니다. 사용자가 "컴퓨터 사용", "터미널 사용", "CLI 사용", "CMD 사용", "명령어 실행", "코드 실행" 등을 요청하면 먼저 이 도구를 호출하세요. 가벼운 Alpine Linux 기반의 샌드박스 환경이 제공되며, 인터넷 연결이 가능합니다. 생성된 컨테이너는 2시간 후 자동으로 파괴됩니다.',
    {},
    async () => {
      const result = await createContainer();
      
      return {
        content: [
          {
            type: 'text' as const,
            text: result.message,
          },
        ],
        isError: !result.success,
      };
    }
  );

  // 2. 컨테이너 상태 확인 도구
  server.tool(
    'check_container',
    '특정 컨테이너의 상태를 확인합니다. 컨테이너가 실행 중인지, 생성 시간, 만료 시간 등의 정보를 확인할 수 있습니다.',
    {
      container_id: z.string().describe('확인할 컨테이너의 ID'),
    },
    async ({ container_id }) => {
      const result = await checkContainer(container_id);
      
      return {
        content: [
          {
            type: 'text' as const,
            text: result.message,
          },
        ],
        isError: !result.success,
      };
    }
  );

  // 3. 명령어 실행 도구
  server.tool(
    'execute_command',
    '컨테이너에서 쉘 명령어를 실행합니다. 터미널/CLI/CMD 명령어, 코드 실행, 파일 작업 등을 수행할 수 있습니다. 반드시 create_container로 먼저 컨테이너를 생성한 후 사용하세요. 명령어 실행이 3초 이상 소요되면 비동기 모드로 전환됩니다.',
    {
      container_id: z.string().describe('명령어를 실행할 컨테이너의 ID'),
      command: z.string().describe('실행할 쉘 명령어'),
    },
    async ({ container_id, command }) => {
      const result = await executeCommand(container_id, command);
      
      let responseText = result.output;
      if (result.isAsync) {
        responseText = `[비동기 모드] ${result.output}`;
      } else if (result.exitCode !== undefined && result.exitCode !== 0) {
        responseText = `[종료 코드: ${result.exitCode}]\n${result.output}`;
      }
      
      return {
        content: [
          {
            type: 'text' as const,
            text: responseText,
          },
        ],
        isError: !result.success && !result.isAsync,
      };
    }
  );

  // 4. 비동기 명령어 상태 확인 도구
  server.tool(
    'check_command_status',
    '마지막으로 실행한 비동기 명령어가 아직 실행 중인지 확인합니다. execute_command에서 비동기 모드로 전환된 명령어의 실행 상태와 현재까지의 출력을 확인할 수 있습니다. 명령어가 완료된 경우 종료 코드와 전체 출력 결과를 반환합니다.',
    {
      container_id: z.string().describe('확인할 컨테이너의 ID'),
    },
    async ({ container_id }) => {
      const result = checkAsyncCommandStatus(container_id);
      
      return {
        content: [
          {
            type: 'text' as const,
            text: result.message,
          },
        ],
        isError: !result.success,
      };
    }
  );

  // 5. 컨테이너 파괴 도구
  server.tool(
    'destroy_container',
    '컨테이너를 파괴합니다. 잘못된 설정이나 문제가 있는 컨테이너를 정리할 때 사용합니다. 파괴된 컨테이너는 복구할 수 없습니다.',
    {
      container_id: z.string().describe('파괴할 컨테이너의 ID'),
    },
    async ({ container_id }) => {
      const result = await destroyContainer(container_id);
      
      return {
        content: [
          {
            type: 'text' as const,
            text: result.message,
          },
        ],
        isError: !result.success,
      };
    }
  );

  // 6. 파일 URL 생성 도구
  server.tool(
    'get_file_url',
    '컨테이너 내부의 파일에 접근할 수 있는 URL을 생성합니다. 생성된 파일, 다운로드한 파일, 스크립트 결과물 등을 외부에서 접근할 수 있게 합니다. 주의: 이 URL은 컨테이너가 파괴되면 (최대 2시간 후) 더 이상 접근할 수 없습니다.',
    {
      container_id: z.string().describe('파일이 있는 컨테이너의 ID'),
      file_path: z.string().describe('컨테이너 내부의 파일 경로 (예: /root/output.txt, /tmp/result.png)'),
    },
    async ({ container_id, file_path }) => {
      // base URL 추출 (MCP 요청에서 얻거나 환경변수 사용)
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      
      const result = await getFileUrl(container_id, file_path, baseUrl);
      
      return {
        content: [
          {
            type: 'text' as const,
            text: result.message,
          },
        ],
        isError: !result.success,
      };
    }
  );
}
