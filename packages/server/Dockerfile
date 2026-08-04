# 워크스페이스 전체가 필요하다. 서버가 @crazy/core를 TS 소스 그대로 실행하기 때문이다.
FROM node:20-slim

WORKDIR /app

# 의존성 레이어를 먼저 굳혀 코드만 바뀌었을 때 재설치를 피한다
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
RUN npm ci --omit=dev --workspace @crazy/server --include-workspace-root

# tsx는 devDependency지만 서버 실행에 필요하다
RUN npm install --no-save tsx@^4.19.2

COPY packages/core ./packages/core
COPY packages/server ./packages/server

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "packages/server/src/index.ts"]
