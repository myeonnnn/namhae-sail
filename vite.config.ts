import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5190, strictPort: true },
  build: {
    // 컨트롤러는 핸드폰에서 따로 여는 페이지이므로, 배포에도 게임과 함께 포함한다.
    rollupOptions: {
      input: { main: 'index.html', controller: 'controller.html' },
    },
  },
});
