# Podman이 포함된 베이스 이미지 사용
FROM quay.io/podman/stable:latest

# Node.js 설치
RUN dnf install -y nodejs npm && dnf clean all

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

# TypeScript 빌드
RUN npm run build

# 환경 변수 설정
ENV NODE_ENV=production
ENV PORT=3000

# 포트 노출
EXPOSE 3000

# 서버 실행
CMD ["node", "dist/index.js"]
