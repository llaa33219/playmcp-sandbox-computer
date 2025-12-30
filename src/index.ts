import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { cleanupAllContainers } from './container-manager.js';
import { getFileInfo, cleanupAllFiles, formatFileSize } from './file-manager.js';
import type { FileInfo } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

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

// ============== 파일 미리보기 관련 ==============

type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

/**
 * 파일 확장자와 MIME 타입을 기반으로 미리보기 타입을 결정합니다.
 */
function getPreviewType(mimeType: string, fileName: string): PreviewType {
  const ext = path.extname(fileName).toLowerCase();
  
  // 이미지
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif'];
  if (imageExts.includes(ext) || mimeType.startsWith('image/')) {
    return 'image';
  }
  
  // 비디오
  const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
  if (videoExts.includes(ext) || mimeType.startsWith('video/')) {
    return 'video';
  }
  
  // 오디오
  const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.m4a'];
  // .ogg는 비디오에서 먼저 체크되므로 오디오로 중복 체크 안 함
  if (audioExts.includes(ext) || mimeType.startsWith('audio/')) {
    return 'audio';
  }
  
  // PDF
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return 'pdf';
  }
  
  // 텍스트/코드
  const textExts = [
    '.txt', '.html', '.htm', '.css', '.js', '.ts', '.json', '.xml', '.csv', '.md',
    '.py', '.sh', '.jsx', '.tsx', '.yaml', '.yml', '.ini', '.conf', '.log', '.sql',
    '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.pl',
    '.swift', '.kt', '.scala', '.r', '.lua', '.vim', '.dockerfile', '.makefile',
    '.gitignore', '.env', '.toml', '.properties', '.bat', '.ps1', '.zsh', '.bash',
    '.fish', '.awk', '.sed', '.diff', '.patch'
  ];
  if (textExts.includes(ext) || mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
    return 'text';
  }
  
  return 'none';
}

/**
 * 확장자에 따른 highlight.js 언어 클래스를 반환합니다.
 */
function getLanguageClass(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const langMap: Record<string, string> = {
    '.js': 'javascript',
    '.ts': 'typescript',
    '.jsx': 'javascript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.fish': 'bash',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.json': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.sql': 'sql',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.lua': 'lua',
    '.pl': 'perl',
    '.ini': 'ini',
    '.toml': 'toml',
    '.dockerfile': 'dockerfile',
    '.makefile': 'makefile',
    '.diff': 'diff',
    '.patch': 'diff',
  };
  return langMap[ext] || 'plaintext';
}

/**
 * HTML 이스케이프
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 미리보기 페이지 HTML을 생성합니다.
 */
function generatePreviewPage(fileInfo: FileInfo, previewType: PreviewType, fileId: string): string {
  const downloadUrl = `/files/${fileId}/download`;
  const rawUrl = `/files/${fileId}/raw`;
  const escapedFileName = escapeHtml(fileInfo.fileName);
  const fileSize = formatFileSize(fileInfo.size);
  
  const commonStyles = `
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        background: #EEE;
        min-height: 100vh;
        color: #e4e4e4;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 30px;
        background: #444;
        border-radius: 16px;
        margin-bottom: 20px;
        border: none;
        box-shadow: 8px 8px 0px #000;
      }
      .file-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .file-name {
        font-size: 1.25rem;
        font-weight: 600;
        color: #fff;
        word-break: break-all;
      }
      .file-meta {
        font-size: 0.875rem;
        color: #a0a0a0;
      }
      .download-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 24px;
        background: #007BFF;
        color: white;
        text-decoration: none;
        border-radius: 12px;
        font-weight: 600;
        font-size: 1rem;
        transition: all 0.3s ease;
        box-shadow: 6px 6px 0px #009;
      }
      .download-btn:hover {
        transform: translateY(4px);
        box-shadow: 2px 2px 0px #009;
      }
      .download-btn svg {
        width: 20px;
        height: 20px;
      }
      .preview-container {
        background: #444;
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid #444;
        box-shadow: 8px 8px 0px #000;
      }
      .preview-title {
        padding: 15px 25px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        font-size: 1.1rem;
        color: #FFF;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .preview-content {
        padding: 20px;
      }
      /* 중앙 다운로드 (미리보기 불가) */
      .center-download {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: calc(100vh - 40px);
        text-align: center;
        gap: 20px;
      }
      .center-download .file-icon {
        width: 120px;
        height: 120px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 10px;
      }
      .center-download .file-icon svg {
        width: 60px;
        height: 60px;
        color: #667eea;
      }
      .center-download .file-name {
        font-size: 1.5rem;
        max-width: 500px;
      }
      .center-download .file-meta {
        font-size: 1rem;
      }
      .center-download .download-btn {
        padding: 16px 40px;
        font-size: 1.1rem;
        margin-top: 10px;
      }
      /* 이미지 미리보기 */
      .preview-image {
        max-width: 100%;
        max-height: 80vh;
        display: block;
        margin: 0 auto;
        border-radius: 8px;
      }
      /* 비디오 미리보기 */
      .preview-video {
        width: 100%;
        max-height: 80vh;
        border-radius: 8px;
        background: #000;
      }
      /* 오디오 미리보기 */
      .preview-audio {
        width: 100%;
        margin: 20px 0;
      }
      /* PDF 미리보기 */
      .preview-pdf {
        width: 100%;
        height: 85vh;
        border: none;
        border-radius: 8px;
      }
      /* 텍스트/코드 미리보기 */
      .preview-text {
        background: #1e1e1e;
        border-radius: 8px;
        overflow: auto;
        max-height: 80vh;
      }
      .preview-text pre {
        margin: 0;
        padding: 20px;
        font-family: 'JetBrains Mono', 'Fira Code', 'Source Code Pro', Consolas, Monaco, monospace;
        font-size: 14px;
        line-height: 1.6;
        overflow-x: auto;
      }
      .preview-text code {
        font-family: inherit;
      }
      /* hljs 커스텀 스타일 오버라이드 */
      .hljs {
        background: transparent !important;
        padding: 0 !important;
      }
      /* 로딩 스피너 */
      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 60px;
        color: #a0a0a0;
      }
      .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(255, 255, 255, 0.1);
        border-top-color: #667eea;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 15px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      /* 에러 메시지 */
      .error-message {
        padding: 40px;
        text-align: center;
        color: #ff6b6b;
      }
    </style>
  `;
  
  const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`;
  
  const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`;
  
  // 미리보기 불가능한 파일
  if (previewType === 'none') {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedFileName} - 다운로드</title>
  ${commonStyles}
</head>
<body>
  <div class="center-download">
    <div class="file-icon">${fileIcon}</div>
    <div class="file-name">${escapedFileName}</div>
    <div class="file-meta">${fileSize} · ${escapeHtml(fileInfo.mimeType)}</div>
    <a href="${downloadUrl}" download="${fileInfo.fileName}" class="download-btn">
      ${downloadIcon}
      다운로드
    </a>
  </div>
</body>
</html>`;
  }
  
  // 미리보기 가능한 파일
  let previewContent = '';
  
  switch (previewType) {
    case 'image':
      previewContent = `<img src="${rawUrl}" alt="${escapedFileName}" class="preview-image" />`;
      break;
      
    case 'video':
      previewContent = `<video controls class="preview-video">
        <source src="${rawUrl}" type="${fileInfo.mimeType}">
        브라우저가 비디오 재생을 지원하지 않습니다.
      </video>`;
      break;
      
    case 'audio':
      previewContent = `
        <div style="padding: 40px 20px; text-align: center;">
          <div style="font-size: 4rem; margin-bottom: 20px;">🎵</div>
          <div style="font-size: 1.2rem; margin-bottom: 30px; color: #fff;">${escapedFileName}</div>
          <audio controls class="preview-audio">
            <source src="${rawUrl}" type="${fileInfo.mimeType}">
            브라우저가 오디오 재생을 지원하지 않습니다.
          </audio>
        </div>`;
      break;
      
    case 'pdf':
      previewContent = `<iframe src="${rawUrl}" class="preview-pdf"></iframe>`;
      break;
      
    case 'text':
      const langClass = getLanguageClass(fileInfo.fileName);
      previewContent = `
        <div class="preview-text">
          <div class="loading" id="text-loading">
            <div class="spinner"></div>
            <span>파일 로딩 중...</span>
          </div>
          <pre><code class="language-${langClass}" id="code-content"></code></pre>
        </div>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
        <script>
          fetch('${rawUrl}')
            .then(response => response.text())
            .then(text => {
              document.getElementById('text-loading').style.display = 'none';
              const codeEl = document.getElementById('code-content');
              codeEl.textContent = text;
              hljs.highlightElement(codeEl);
            })
            .catch(error => {
              document.getElementById('text-loading').innerHTML = 
                '<div class="error-message">파일을 불러오는데 실패했습니다.<\/div>';
            });
        </script>`;
      break;
  }
  
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedFileName} - 미리보기</title>
  ${commonStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="file-info">
        <div class="file-name">${escapedFileName}</div>
        <div class="file-meta">${fileSize} · ${escapeHtml(fileInfo.mimeType)}</div>
      </div>
      <a href="${downloadUrl}" download="${fileInfo.fileName}" class="download-btn">
        ${downloadIcon}
        다운로드
      </a>
    </div>
    <div class="preview-container">
      <div class="preview-title">미리보기</div>
      <div class="preview-content">
        ${previewContent}
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * 파일 정보 확인 헬퍼 함수
 */
function validateFileAccess(fileId: string, res: express.Response): FileInfo | null {
  const fileInfo = getFileInfo(fileId);
  
  if (!fileInfo) {
    res.status(404).send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>파일을 찾을 수 없음</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #EEE; color: #FFF; }
    .error { text-align: center; background: #444; padding: 16px; brorder-radius: 16px; box-shadow: 8px 8px 0px #000; }
    h1 { font-size: 1.5rem; margin-bottom: 10px; }
    p { color: #a0a0a0; }
  </style>
</head>
<body>
  <div class="error">
    <h1>파일을 찾을 수 없습니다</h1>
    <p>파일이 존재하지 않거나 컨테이너가 파괴되어 삭제되었습니다.</p>
  </div>
</body>
</html>`);
    return null;
  }
  
  if (!fs.existsSync(fileInfo.localPath)) {
    res.status(404).send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>파일을 찾을 수 없음</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #EEE; color: #FFF; }
    .error { text-align: center; background: #444; padding: 16px; brorder-radius: 16px; box-shadow: 8px 8px 0px #000; }
    h1 { font-size: 1.5rem; margin-bottom: 10px; }
    p { color: #a0a0a0; }
  </style>
</head>
<body>
  <div class="error">
    <h1>파일을 찾을 수 없습니다</h1>
    <p>파일이 서버에서 삭제되었습니다.</p>
  </div>
</body>
</html>`);
    return null;
  }
  
  return fileInfo;
}

// 파일 다운로드 (더 구체적인 라우트를 먼저 정의)
app.get('/files/:fileId/download', (req, res) => {
  const { fileId } = req.params;
  const fileInfo = validateFileAccess(fileId, res);
  if (!fileInfo) return;
  
  // ASCII fallback 파일명 (비ASCII 문자는 언더스코어로 대체)
  const asciiFileName = fileInfo.fileName.replace(/[^\x20-\x7E]/g, '_');
  const encodedFileName = encodeURIComponent(fileInfo.fileName);
  
  // 강제 다운로드를 위한 헤더 설정
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 
    `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`);
  res.setHeader('Content-Length', fileInfo.size);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  const fileStream = fs.createReadStream(fileInfo.localPath);
  fileStream.pipe(res);
  
  fileStream.on('error', (error) => {
    console.error(`[File] 다운로드 오류: ${fileId}`, error);
    if (!res.headersSent) {
      res.status(500).send('파일 다운로드 중 오류가 발생했습니다.');
    }
  });
});

// 원본 파일 스트리밍 (미리보기용)
app.get('/files/:fileId/raw', (req, res) => {
  const { fileId } = req.params;
  const fileInfo = validateFileAccess(fileId, res);
  if (!fileInfo) return;
  
  res.setHeader('Content-Type', fileInfo.mimeType);
  res.setHeader('Content-Length', fileInfo.size);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // raw는 inline으로 표시 (다운로드 안 함)
  res.setHeader('Content-Disposition', 'inline');
  
  const fileStream = fs.createReadStream(fileInfo.localPath);
  fileStream.pipe(res);
  
  fileStream.on('error', (error) => {
    console.error(`[File] 전송 오류: ${fileId}`, error);
    if (!res.headersSent) {
      res.status(500).send('파일 전송 중 오류가 발생했습니다.');
    }
  });
});

// 파일 미리보기 페이지 (가장 일반적인 라우트는 마지막에)
app.get('/files/:fileId', (req, res) => {
  const { fileId } = req.params;
  const fileInfo = validateFileAccess(fileId, res);
  if (!fileInfo) return;
  
  const previewType = getPreviewType(fileInfo.mimeType, fileInfo.fileName);
  const html = generatePreviewPage(fileInfo, previewType, fileId);
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
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
