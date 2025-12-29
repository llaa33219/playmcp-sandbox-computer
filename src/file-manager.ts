import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileInfo, GetFileUrlResult } from './types.js';

const execAsync = promisify(exec);

/**
 * 파일 저장 디렉토리
 */
const FILES_DIR = '/tmp/mcp-files';

/**
 * 활성 파일 저장소 (fileId -> FileInfo)
 */
const activeFiles: Map<string, FileInfo> = new Map();

/**
 * 컨테이너별 파일 목록 (containerId -> Set<fileId>)
 */
const containerFiles: Map<string, Set<string>> = new Map();

/**
 * 파일 저장 디렉토리 초기화
 */
async function ensureFilesDir(): Promise<void> {
  try {
    await fs.mkdir(FILES_DIR, { recursive: true });
  } catch (error) {
    // 이미 존재하면 무시
  }
}

/**
 * 컨테이너에서 파일을 복사하고 접속 URL을 생성합니다.
 */
export async function getFileUrl(
  containerId: string,
  filePath: string,
  baseUrl: string
): Promise<GetFileUrlResult> {
  // 경로 유효성 검사 (path traversal 방지)
  if (!filePath.startsWith('/') || filePath.includes('..')) {
    return {
      success: false,
      message: '유효하지 않은 파일 경로입니다. 절대 경로를 사용하고 ".."는 포함할 수 없습니다.',
    };
  }
  
  // 컨테이너 존재 여부 확인 (podman inspect 직접 호출 - 순환 참조 방지)
  try {
    await execAsync(`podman inspect --format '{{.State.Status}}' ${containerId}`, { timeout: 10000 });
  } catch (error) {
    return {
      success: false,
      message: `컨테이너 ${containerId}가 존재하지 않습니다.`,
    };
  }
  
  try {
    await ensureFilesDir();
    
    // 고유 파일 ID 생성
    const fileId = uuidv4().slice(0, 12);
    const originalName = path.basename(filePath);
    const extension = path.extname(originalName);
    const localFileName = `${fileId}${extension}`;
    const localPath = path.join(FILES_DIR, localFileName);
    
    // podman cp로 컨테이너에서 파일 복사
    const copyCmd = `podman cp ${containerId}:${filePath} ${localPath}`;
    await execAsync(copyCmd, { timeout: 30000 });
    
    // 파일 존재 확인
    const stats = await fs.stat(localPath);
    
    // 파일 정보 저장
    const fileInfo: FileInfo = {
      id: fileId,
      containerId,
      originalPath: filePath,
      localPath,
      fileName: originalName,
      mimeType: getMimeType(extension),
      size: stats.size,
      createdAt: new Date(),
    };
    
    activeFiles.set(fileId, fileInfo);
    
    // 컨테이너별 파일 목록에 추가
    if (!containerFiles.has(containerId)) {
      containerFiles.set(containerId, new Set());
    }
    containerFiles.get(containerId)!.add(fileId);
    
    // URL 생성
    const fileUrl = `${baseUrl}/files/${fileId}`;
    
    console.log(`[File] 생성됨: ${fileId} (${originalName}) from ${containerId}`);
    
    return {
      success: true,
      fileId,
      url: fileUrl,
      fileName: originalName,
      size: stats.size,
      message: `파일 URL이 생성되었습니다: ${fileUrl}\n파일명: ${originalName}\n크기: ${formatFileSize(stats.size)}\n\n⚠️ 이 URL은 컨테이너가 파괴되면 (최대 2시간 후) 더 이상 접근할 수 없습니다.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // 파일이 존재하지 않는 경우
    if (errorMessage.includes('No such file') || errorMessage.includes('could not find')) {
      return {
        success: false,
        message: `파일을 찾을 수 없습니다: ${filePath}`,
      };
    }
    
    console.error(`[File] URL 생성 실패: ${errorMessage}`);
    
    return {
      success: false,
      message: `파일 URL 생성 실패: ${errorMessage}`,
    };
  }
}

/**
 * 파일 ID로 파일 정보 조회
 */
export function getFileInfo(fileId: string): FileInfo | undefined {
  return activeFiles.get(fileId);
}

/**
 * 특정 컨테이너의 모든 파일 삭제
 */
export async function cleanupContainerFiles(containerId: string): Promise<void> {
  const fileIds = containerFiles.get(containerId);
  if (!fileIds) return;
  
  for (const fileId of fileIds) {
    await deleteFile(fileId);
  }
  
  containerFiles.delete(containerId);
  console.log(`[File] 컨테이너 ${containerId}의 모든 파일 정리 완료`);
}

/**
 * 단일 파일 삭제
 */
export async function deleteFile(fileId: string): Promise<void> {
  const fileInfo = activeFiles.get(fileId);
  if (!fileInfo) return;
  
  try {
    await fs.unlink(fileInfo.localPath);
    console.log(`[File] 삭제됨: ${fileId}`);
  } catch (error) {
    // 파일이 이미 없으면 무시
  }
  
  activeFiles.delete(fileId);
}

/**
 * 모든 파일 정리 (서버 종료 시)
 */
export async function cleanupAllFiles(): Promise<void> {
  console.log('[File] 모든 파일 정리 중...');
  
  for (const fileId of activeFiles.keys()) {
    await deleteFile(fileId);
  }
  
  containerFiles.clear();
  
  // 파일 디렉토리 정리
  try {
    await fs.rm(FILES_DIR, { recursive: true, force: true });
  } catch (error) {
    // 무시
  }
  
  console.log('[File] 모든 파일 정리 완료');
}

/**
 * MIME 타입 추정
 */
function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.py': 'text/x-python',
    '.sh': 'text/x-shellscript',
  };
  
  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * 파일 크기 포맷
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
