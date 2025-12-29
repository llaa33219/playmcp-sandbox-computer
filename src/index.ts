import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { registerPrompts } from './prompts.js';
import { cleanupAllContainers } from './container-manager.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// MCP 서버 인스턴스 생성
const mcpServer = new McpServer(
  {
    name: 'container-sandbox-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

// 도구 및 프롬프트 등록
registerTools(mcpServer);
registerPrompts(mcpServer);

// 세션별 트랜스포트 저장소
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

// MCP 엔드포인트 (POST)
app.post('/mcp', async (req, res) => {
  try {
    const isInitRequest = req.body?.method === 'initialize';
    let transport: StreamableHTTPServerTransport;

    if (isInitRequest) {
      // 새 세션 생성
      const sessionId = randomUUID();
      transport = new StreamableHTTPServerTransport({ sessionId });
      transports.set(sessionId, transport);
      
      // 서버 연결
      await mcpServer.connect(transport);
      
      console.log(`[MCP] 새 세션 생성: ${sessionId}`);
    } else {
      // 기존 세션 찾기
      const sessionId = req.headers['mcp-session-id'] as string;
      
      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: '유효하지 않거나 누락된 세션 ID입니다.' },
          id: null,
        });
        return;
      }
      
      transport = transports.get(sessionId)!;
    }

    // 요청 처리
    await transport.handleRequest(req, res, req.body);

    // 연결 종료 시 정리
    res.on('close', () => {
      const sessionId = (transport as StreamableHTTPServerTransport & { sessionId?: string }).sessionId;
      if (sessionId) {
        transports.delete(sessionId);
        console.log(`[MCP] 세션 종료: ${sessionId}`);
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
  console.log(`[Server] MCP 엔드포인트: http://localhost:${PORT}/mcp`);
  console.log(`[Server] 헬스체크: http://localhost:${PORT}/health`);
});

// 종료 시그널 처리
const gracefulShutdown = async (signal: string) => {
  console.log(`\n[Server] ${signal} 시그널 수신, 서버를 종료합니다...`);
  
  // 모든 컨테이너 정리
  await cleanupAllContainers();
  
  // 모든 트랜스포트 종료
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
      console.log(`[MCP] 트랜스포트 종료: ${sessionId}`);
    } catch (error) {
      console.error(`[MCP] 트랜스포트 종료 오류: ${sessionId}`, error);
    }
  }
  transports.clear();
  
  // HTTP 서버 종료
  server.close(() => {
    console.log('[Server] 서버가 정상적으로 종료되었습니다.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
