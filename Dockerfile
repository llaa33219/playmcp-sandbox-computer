# Podman이 포함된 Fedora 베이스 이미지
FROM quay.io/podman/stable:latest

# dnf 캐시 정리 및 zchunk 비활성화 (체크섬 오류 방지)
RUN dnf clean all && \
    rm -rf /var/cache/dnf && \
    echo "zchunk=False" >> /etc/dnf/dnf.conf

# Node.js 설치
RUN dnf install -y nodejs npm --setopt=install_weak_deps=False && \
    dnf clean all

# Podman 스토리지 설정 (VFS 드라이버 사용 - Railway 환경 권한 문제 해결)
# VFS는 overlay보다 느리지만 권한 문제가 없음
RUN mkdir -p /etc/containers && \
    echo '[storage]' > /etc/containers/storage.conf && \
    echo 'driver = "vfs"' >> /etc/containers/storage.conf

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

# TypeScript 빌드
RUN npm run build

# 빌드 후 devDependencies 제거
RUN npm prune --omit=dev

# 환경 변수 설정
ENV NODE_ENV=production
ENV PORT=3000

# 포트 노출
EXPOSE 3000

# 서버 실행
CMD ["node", "dist/index.js"]
