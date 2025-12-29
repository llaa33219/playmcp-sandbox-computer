# Node.js 베이스 이미지 사용 (Fedora 기반)
FROM fedora:41

# Node.js와 Podman 설치
RUN dnf update -y && \
    dnf install -y nodejs npm podman fuse-overlayfs --setopt=install_weak_deps=False && \
    dnf clean all

# Podman rootless 설정
RUN mkdir -p /etc/containers && \
    echo '[storage]' > /etc/containers/storage.conf && \
    echo 'driver = "overlay"' >> /etc/containers/storage.conf && \
    echo '[storage.options.overlay]' >> /etc/containers/storage.conf && \
    echo 'mount_program = "/usr/bin/fuse-overlayfs"' >> /etc/containers/storage.conf

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
