import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import type {
  ContainerInfo,
  CommandResult,
  CreateContainerResult,
  ContainerStatusResult,
  DestroyContainerResult,
  AsyncCommandStatusResult,
} from './types.js';
import { cleanupContainerFiles } from './file-manager.js';

const execAsync = promisify(exec);

/**
 * 컨테이너 자동 만료 시간 (2시간)
 */
const CONTAINER_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * 명령어 실행 타임아웃 (3초) - 초과 시 비동기 모드로 전환
 */
const COMMAND_TIMEOUT_MS = 3000;

/**
 * 기본 이미지 (가벼운 Alpine Linux)
 */
const DEFAULT_IMAGE = 'docker.io/library/alpine:latest';

/**
 * 컨테이너 리소스 제한 설정
 */
const CONTAINER_LIMITS = {
  MEMORY: '256m',      // 메모리 제한 (256MB)
  CPUS: '0.5',         // CPU 제한 (50%)
  PIDS: 100,           // 최대 프로세스 수 (fork bomb 방지)
};

/**
 * 활성 컨테이너 저장소
 */
const activeContainers: Map<string, ContainerInfo> = new Map();

/**
 * 비동기 명령어 정보 타입
 */
interface AsyncProcessInfo {
  process: ChildProcess;
  command: string;
  startedAt: Date;
  output: string;
  exitCode: number | null;
  isRunning: boolean;
}

/**
 * 컨테이너별 마지막 비동기 명령어 저장소
 */
const runningAsyncProcesses: Map<string, AsyncProcessInfo> = new Map();

/**
 * 명령어와 패키지 이름이 다른 경우의 매핑 테이블
 * Alpine Linux(apk) 기준
 */
const COMMAND_TO_PACKAGE: Record<string, string> = {
  python: 'python3',
  python3: 'python3',
  pip: 'py3-pip',
  pip3: 'py3-pip',
  node: 'nodejs',
  npm: 'nodejs npm',
  git: 'git',
  curl: 'curl',
  wget: 'wget',
  vim: 'vim',
  nano: 'nano',
  jq: 'jq',
  make: 'make',
  gcc: 'gcc',
  'g++': 'g++',
  bash: 'bash',
  zsh: 'zsh',
  ssh: 'openssh-client',
  scp: 'openssh-client',
  rsync: 'rsync',
  tar: 'tar',
  zip: 'zip',
  unzip: 'unzip',
  gzip: 'gzip',
  htop: 'htop',
  netcat: 'netcat-openbsd',
  nc: 'netcat-openbsd',
  nmap: 'nmap',
  ping: 'iputils',
  dig: 'bind-tools',
  nslookup: 'bind-tools',
  ffmpeg: 'ffmpeg',
  imagemagick: 'imagemagick',
  convert: 'imagemagick',
  ruby: 'ruby',
  gem: 'ruby',
  go: 'go',
  rustc: 'rust',
  cargo: 'cargo',
  java: 'openjdk11',
  javac: 'openjdk11',
  perl: 'perl',
  php: 'php',
  lua: 'lua',
  sqlite3: 'sqlite',
  psql: 'postgresql-client',
  mysql: 'mysql-client',
  'redis-cli': 'redis',
  mongosh: 'mongodb-tools',
};

/**
 * 명령어 실행 결과에서 패키지 누락 오류를 감지하고 설치 안내 메시지를 생성합니다.
 */
function detectMissingPackage(output: string, exitCode: number | null): string | null {
  if (exitCode === 0) return null;
  
  // 패키지 누락 오류 패턴들
  const patterns = [
    /sh: ([\w.-]+): not found/i,
    /bash: ([\w.-]+): command not found/i,
    /([\w.-]+): command not found/i,
    /([\w.-]+): No such file or directory/i,
    /-sh: ([\w.-]+): not found/i,
  ];
  
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      const missingCommand = match[1];
      const packageName = COMMAND_TO_PACKAGE[missingCommand] || missingCommand;
      
      return `\n\n💡 **패키지 누락 감지**: \`${missingCommand}\` 명령어를 찾을 수 없습니다.\n` +
        `다음 명령어로 패키지를 설치한 후 다시 시도하세요:\n\n` +
        `\`\`\`\napk add ${packageName}\n\`\`\`\n\n` +
        `execute_command로 위 설치 명령어를 먼저 실행한 다음, 원래 명령어를 다시 실행하세요.`;
    }
  }
  
  return null;
}

/**
 * 컨테이너 자동 파괴 타이머 저장소
 */
const containerTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * 새 컨테이너 생성
 * - Alpine Linux 기반의 가벼운 컨테이너 생성
 * - 인터넷 연결 가능
 * - 2시간 후 자동 파괴
 */
export async function createContainer(): Promise<CreateContainerResult> {
  const containerId = `mcp-${uuidv4().slice(0, 8)}`;
  
  try {
    // Podman으로 컨테이너 생성 및 실행 (보안 강화 옵션 포함)
    // --memory: 메모리 사용량 제한
    // --cpus: CPU 사용량 제한
    // --pids-limit: 프로세스 수 제한 (fork bomb 방지)
    // --cap-drop=ALL: 모든 Linux capabilities 제거 (권한 최소화)
    // --security-opt=no-new-privileges: 권한 상승 방지 (setuid 등 차단)
    const createCmd = [
      'podman run -d',
      `--name ${containerId}`,
      `--memory=${CONTAINER_LIMITS.MEMORY}`,
      `--cpus=${CONTAINER_LIMITS.CPUS}`,
      `--pids-limit=${CONTAINER_LIMITS.PIDS}`,
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      DEFAULT_IMAGE,
      'sleep infinity',
    ].join(' ');
    
    await execAsync(createCmd, { timeout: 30000 });
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CONTAINER_TTL_MS);
    
    const containerInfo: ContainerInfo = {
      id: containerId,
      createdAt: now,
      expiresAt,
      status: 'running',
    };
    
    activeContainers.set(containerId, containerInfo);
    
    // 2시간 후 자동 파괴 타이머 설정
    const timer = setTimeout(() => {
      destroyContainer(containerId).catch(console.error);
    }, CONTAINER_TTL_MS);
    
    containerTimers.set(containerId, timer);
    
    console.log(`[Container] 생성됨: ${containerId}, 만료 시간: ${expiresAt.toISOString()}`);
    
    return {
      success: true,
      containerId,
      message: `컨테이너가 생성되었습니다. ID: ${containerId}. 이 컨테이너는 ${expiresAt.toISOString()}에 자동으로 파괴됩니다.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Container] 생성 실패: ${errorMessage}`);
    
    return {
      success: false,
      message: `컨테이너 생성 실패: ${errorMessage}`,
    };
  }
}

/**
 * 컨테이너 상태 확인
 * - 터미널 출력 확인
 */
export async function checkContainer(containerId: string): Promise<ContainerStatusResult> {
  try {
    // 컨테이너 존재 여부 확인
    const { stdout: statusOutput } = await execAsync(
      `podman inspect --format '{{.State.Status}}' ${containerId}`,
      { timeout: 10000 }
    );
    
    const status = statusOutput.trim();
    const containerInfo = activeContainers.get(containerId);
    
    let message = `컨테이너 ${containerId} 상태: ${status}`;
    if (containerInfo) {
      message += `\n생성 시간: ${containerInfo.createdAt.toISOString()}`;
      message += `\n만료 시간: ${containerInfo.expiresAt.toISOString()}`;
    }
    
    return {
      success: true,
      exists: true,
      status,
      message,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // 컨테이너가 존재하지 않는 경우
    if (errorMessage.includes('no such container') || errorMessage.includes('Error: ')) {
      return {
        success: true,
        exists: false,
        message: `컨테이너 ${containerId}가 존재하지 않습니다.`,
      };
    }
    
    return {
      success: false,
      exists: false,
      message: `컨테이너 상태 확인 실패: ${errorMessage}`,
    };
  }
}

/**
 * 컨테이너에서 명령어 실행
 * - 3초 이상 소요 시 비동기 모드로 전환
 */
export async function executeCommand(
  containerId: string,
  command: string
): Promise<CommandResult> {
  // 컨테이너 존재 여부 먼저 확인
  const containerStatus = await checkContainer(containerId);
  if (!containerStatus.exists) {
    return {
      success: false,
      output: `컨테이너 ${containerId}가 존재하지 않습니다.`,
      isAsync: false,
    };
  }
  
  return new Promise((resolve) => {
    let output = '';
    let isResolved = false;
    
    // Podman exec 실행
    const child = spawn('podman', ['exec', containerId, 'sh', '-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    // 비동기 프로세스 정보 초기화
    const asyncInfo: AsyncProcessInfo = {
      process: child,
      command,
      startedAt: new Date(),
      output: '',
      exitCode: null,
      isRunning: true,
    };
    
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      asyncInfo.output += text;
    });
    
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      asyncInfo.output += text;
    });
    
    child.on('close', (exitCode) => {
      asyncInfo.isRunning = false;
      asyncInfo.exitCode = exitCode;
      
      if (!isResolved) {
        isResolved = true;
        
        let finalOutput = output || '(출력 없음)';
        
        // 패키지 누락 오류 감지 및 설치 안내 추가
        const packageHint = detectMissingPackage(output, exitCode);
        if (packageHint) {
          finalOutput += packageHint;
        }
        
        resolve({
          success: exitCode === 0,
          output: finalOutput,
          isAsync: false,
          exitCode: exitCode ?? undefined,
        });
      }
    });
    
    child.on('error', (error) => {
      asyncInfo.isRunning = false;
      
      if (!isResolved) {
        isResolved = true;
        resolve({
          success: false,
          output: `명령어 실행 오류: ${error.message}`,
          isAsync: false,
        });
      }
    });
    
    // 타임아웃 타이머 설정
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        
        // 비동기 프로세스로 저장 (타임아웃 시에만)
        runningAsyncProcesses.set(containerId, asyncInfo);
        
        resolve({
          success: true,
          output: `⏳ 명령어가 백그라운드에서 실행 중입니다.

이 명령어는 시간이 오래 걸리는 작업이라 비동기 모드로 전환되었습니다.

사용자에게 다음과 같이 안내하세요.
"현재 작업은 실행 시간이 오래 걸려 비동기 모드로 전환되었습니다.
일정 시간 기다린 후 **결과를 확인해 달라고 요청하라**고 알려주세요."

사용자가 결과를 확인해 달라고 말하였다면, check_command_status 도구를 사용하여 명령어의 실행 상태를 확인하세요.`,
          isAsync: true,
        });
      }
    }, COMMAND_TIMEOUT_MS);
  });
}

/**
 * 비동기 명령어 상태 확인
 * - 마지막으로 실행한 비동기 명령어가 아직 실행 중인지 확인
 */
export function checkAsyncCommandStatus(containerId: string): AsyncCommandStatusResult {
  const asyncInfo = runningAsyncProcesses.get(containerId);
  
  if (!asyncInfo) {
    return {
      success: true,
      hasAsyncCommand: false,
      isRunning: false,
      message: `컨테이너 ${containerId}에서 추적 중인 비동기 명령어가 없습니다.`,
    };
  }
  
  if (asyncInfo.isRunning) {
    const elapsedMs = Date.now() - asyncInfo.startedAt.getTime();
    const elapsedSec = Math.floor(elapsedMs / 1000);
    
    return {
      success: true,
      hasAsyncCommand: true,
      isRunning: true,
      command: asyncInfo.command,
      startedAt: asyncInfo.startedAt,
      output: asyncInfo.output || '(아직 출력 없음)',
      message: `명령어가 아직 실행 중입니다. (경과 시간: ${elapsedSec}초)\n명령어: ${asyncInfo.command}\n\n현재까지의 출력:\n${asyncInfo.output || '(아직 출력 없음)'}`,
    };
  }
  
  // 명령어가 완료된 경우
  const result: AsyncCommandStatusResult = {
    success: true,
    hasAsyncCommand: true,
    isRunning: false,
    command: asyncInfo.command,
    startedAt: asyncInfo.startedAt,
    output: asyncInfo.output || '(출력 없음)',
    exitCode: asyncInfo.exitCode ?? undefined,
    message: `명령어가 완료되었습니다. (종료 코드: ${asyncInfo.exitCode})\n명령어: ${asyncInfo.command}\n\n출력 결과:\n${asyncInfo.output || '(출력 없음)'}`,
  };
  
  // 완료된 명령어 정보 제거
  runningAsyncProcesses.delete(containerId);
  
  return result;
}

/**
 * 컨테이너 파괴
 */
export async function destroyContainer(containerId: string): Promise<DestroyContainerResult> {
  try {
    // 타이머 정리
    const timer = containerTimers.get(containerId);
    if (timer) {
      clearTimeout(timer);
      containerTimers.delete(containerId);
    }
    
    // 비동기 프로세스 정리
    const asyncInfo = runningAsyncProcesses.get(containerId);
    if (asyncInfo && asyncInfo.isRunning) {
      asyncInfo.process.kill();
    }
    runningAsyncProcesses.delete(containerId);
    
    // 컨테이너 관련 파일 정리
    await cleanupContainerFiles(containerId);
    
    // 컨테이너 강제 종료 및 삭제
    await execAsync(`podman rm -f ${containerId}`, { timeout: 30000 });
    
    // 활성 컨테이너 목록에서 제거
    activeContainers.delete(containerId);
    
    console.log(`[Container] 파괴됨: ${containerId}`);
    
    return {
      success: true,
      message: `컨테이너 ${containerId}가 성공적으로 파괴되었습니다.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // 이미 존재하지 않는 경우도 성공으로 처리
    if (errorMessage.includes('no such container')) {
      activeContainers.delete(containerId);
      containerTimers.delete(containerId);
      
      return {
        success: true,
        message: `컨테이너 ${containerId}가 이미 존재하지 않습니다.`,
      };
    }
    
    console.error(`[Container] 파괴 실패: ${containerId} - ${errorMessage}`);
    
    return {
      success: false,
      message: `컨테이너 파괴 실패: ${errorMessage}`,
    };
  }
}

/**
 * 모든 활성 컨테이너 정리 (서버 종료 시 호출)
 */
export async function cleanupAllContainers(): Promise<void> {
  console.log('[Container] 모든 컨테이너 정리 중...');
  
  // 모든 비동기 프로세스 정리
  for (const [containerId, asyncInfo] of runningAsyncProcesses) {
    if (asyncInfo.isRunning) {
      asyncInfo.process.kill();
      console.log(`[Container] 비동기 프로세스 종료: ${containerId}`);
    }
  }
  runningAsyncProcesses.clear();
  
  const containerIds = Array.from(activeContainers.keys());
  
  for (const containerId of containerIds) {
    await destroyContainer(containerId);
  }
  
  console.log('[Container] 모든 컨테이너 정리 완료');
}

/**
 * 활성 컨테이너 목록 조회
 */
export function getActiveContainers(): ContainerInfo[] {
  return Array.from(activeContainers.values());
}
