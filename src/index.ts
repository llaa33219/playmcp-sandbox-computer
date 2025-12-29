import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { cleanupAllContainers } from './container-manager.js';
import { getFileInfo, cleanupAllFiles } from './file-manager.js';
import * as fs from 'fs';

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

// MCP 엔드포인트 - 모든 HTTP 메서드 처리 (GET, POST, DELETE)
app.all('/', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  
  try {
    // GET: SSE 스트리밍 또는 서버 정보
    if (req.method === 'GET') {
      if (sessionId && sessions.has(sessionId)) {
        // 기존 세션의 SSE 스트림 처리
        const sessionInfo = sessions.get(sessionId)!;
        await sessionInfo.transport.handleRequest(req, res);
      } else {
        // 세션 없이 GET 요청 시 서버 정보 반환
        res.json({
          name: 'container-sandbox-mcp',
          version: '1.0.0',
          description: 'MCP 컨테이너 샌드박스 서버',
          status: 'running',
          activeSessions: sessions.size,
        });
      }
      return;
    }
    
    // DELETE: 세션 종료
    if (req.method === 'DELETE') {
      if (sessionId && sessions.has(sessionId)) {
        const sessionInfo = sessions.get(sessionId)!;
        await sessionInfo.transport.close();
        sessions.delete(sessionId);
        console.log(`[MCP] 세션 삭제: ${sessionId}`);
        res.status(200).json({ message: '세션이 종료되었습니다.' });
      } else {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: '세션을 찾을 수 없습니다.' },
          id: null,
        });
      }
      return;
    }
    
    // POST: MCP JSON-RPC 메시지 처리
    if (req.method === 'POST') {
      const isInitRequest = req.body?.method === 'initialize';
      let sessionInfo: SessionInfo;

      if (isInitRequest) {
        // 새 세션 생성
        const newSessionId = randomUUID();
        
        // 새로운 MCP 서버 인스턴스 생성
        const server = createMcpServer();
        
        // 새로운 트랜스포트 생성
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
        });
        
        // 서버와 트랜스포트 연결
        await server.connect(transport);
        
        // 세션 정보 저장
        sessionInfo = { server, transport };
        sessions.set(newSessionId, sessionInfo);
        
        console.log(`[MCP] 새 세션 생성: ${newSessionId}`);
      } else {
        // 기존 세션 찾기
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
      return;
    }
    
    // 지원하지 않는 메서드
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: `지원하지 않는 HTTP 메서드: ${req.method}` },
      id: null,
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

// 파일 서빙 엔드포인트
app.get('/files/:fileId', (req, res) => {
  const { fileId } = req.params;
  const fileInfo = getFileInfo(fileId);
  
  if (!fileInfo) {
    res.status(404).json({
      error: '파일을 찾을 수 없습니다.',
      message: '파일이 존재하지 않거나 컨테이너가 파괴되어 삭제되었습니다.',
    });
    return;
  }
  
  // 파일 존재 확인
  if (!fs.existsSync(fileInfo.localPath)) {
    res.status(404).json({
      error: '파일을 찾을 수 없습니다.',
      message: '파일이 서버에서 삭제되었습니다.',
    });
    return;
  }
  
  // Content-Type 및 Content-Disposition 헤더 설정
  res.setHeader('Content-Type', fileInfo.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileInfo.fileName)}"`);
  res.setHeader('Content-Length', fileInfo.size);
  
  // 파일 스트림 전송
  const fileStream = fs.createReadStream(fileInfo.localPath);
  fileStream.pipe(res);
  
  fileStream.on('error', (error) => {
    console.error(`[File] 전송 오류: ${fileId}`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다.' });
    }
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
  
  // 모든 파일 정리
  await cleanupAllFiles();
  
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
