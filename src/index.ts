import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { cleanupAllContainers } from './container-manager.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 세션 정보 인터페이스
interface SessionInfo {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

// 세션별 서버 및 트랜스포트 저장소
const sessions: Map<string, SessionInfo> = new Map();

/**
 * 새로운 MCP 서버 인스턴스를 생성하고 도구를 등록합니다.
 */
function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'container-sandbox-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // 도구 등록
  registerTools(server);
  
  return server;
}

// MCP 엔드포인트 (POST) - 루트 경로
app.post('/', async (req, res) => {
  try {
    const isInitRequest = req.body?.method === 'initialize';
    let sessionInfo: SessionInfo;

    if (isInitRequest) {
      // 새 세션 생성
      const sessionId = randomUUID();
      
      // 새로운 MCP 서버 인스턴스 생성
      const server = createMcpServer();
      
      // 새로운 트랜스포트 생성
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });
      
      // 서버와 트랜스포트 연결
      await server.connect(transport);
      
      // 세션 정보 저장
      sessionInfo = { server, transport };
      sessions.set(sessionId, sessionInfo);
      
      console.log(`[MCP] 새 세션 생성: ${sessionId}`);
    } else {
      // 기존 세션 찾기
      const sessionId = req.headers['mcp-session-id'] as string;
      
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: '유효하지 않거나 누락된 세션 ID입니다.' },
          id: null,
        });
        return;
      }
      
      sessionInfo = sessions.get(sessionId)!;
    }

    // 요청 처리
    await sessionInfo.transport.handleRequest(req, res, req.body);

    // 연결 종료 시 정리
    res.on('close', () => {
      // 세션 ID는 헤더에서 가져옴
      const closedSessionId = req.headers['mcp-session-id'] as string;
      if (closedSessionId && sessions.has(closedSessionId)) {
        sessions.delete(closedSessionId);
        console.log(`[MCP] 세션 종료: ${closedSessionId}`);
      }
    });
  } catch (error) {
    console.error('[MCP] 요청 처리 오류:', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: '내부 서버 오류' },
        id: null,
      });
    }
  }
});

// 헬스체크 엔드포인트
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'container-sandbox-mcp',
    version: '1.0.0',
  });
});

// 서버 시작
const server = app.listen(PORT, () => {
  console.log(`[Server] MCP 컨테이너 샌드박스 서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`[Server] MCP 엔드포인트: http://localhost:${PORT}/`);
  console.log(`[Server] 헬스체크: http://localhost:${PORT}/health`);
});

// 종료 시그널 처리
const gracefulShutdown = async (signal: string) => {
  console.log(`\n[Server] ${signal} 시그널 수신, 서버를 종료합니다...`);
  
  // 모든 컨테이너 정리
  await cleanupAllContainers();
  
  // 모든 세션 종료
  for (const [sessionId, sessionInfo] of sessions) {
    try {
      await sessionInfo.transport.close();
      console.log(`[MCP] 세션 종료: ${sessionId}`);
    } catch (error) {
      console.error(`[MCP] 세션 종료 오류: ${sessionId}`, error);
    }
  }
  sessions.clear();
  
  // HTTP 서버 종료
  server.close(() => {
    console.log('[Server] 서버가 정상적으로 종료되었습니다.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
