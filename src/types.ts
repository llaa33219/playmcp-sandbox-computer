/**
 * 컨테이너 정보 타입
 */
export interface ContainerInfo {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'running' | 'stopped' | 'creating';
}

/**
 * 명령어 실행 결과 타입
 */
export interface CommandResult {
  success: boolean;
  output: string;
  isAsync: boolean;
  exitCode?: number;
}

/**
 * 컨테이너 생성 결과 타입
 */
export interface CreateContainerResult {
  success: boolean;
  containerId?: string;
  message: string;
}

/**
 * 컨테이너 상태 확인 결과 타입
 */
export interface ContainerStatusResult {
  success: boolean;
  exists: boolean;
  status?: string;
  output?: string;
  message: string;
}

/**
 * 컨테이너 삭제 결과 타입
 */
export interface DestroyContainerResult {
  success: boolean;
  message: string;
}

/**
 * 파일 정보 타입
 */
export interface FileInfo {
  id: string;
  containerId: string;
  originalPath: string;
  localPath: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

/**
 * 파일 URL 생성 결과 타입
 */
export interface GetFileUrlResult {
  success: boolean;
  fileId?: string;
  url?: string;
  fileName?: string;
  size?: number;
  message: string;
}
