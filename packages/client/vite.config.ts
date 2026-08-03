import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // 워크스페이스 심볼릭 링크 대신 실제 소스를 직접 가리킨다.
      // core는 빌드 단계 없이 TS 소스 그대로 번들된다.
      '@crazy/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
