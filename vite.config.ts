import { defineConfig, type Plugin } from 'vite';

export default defineConfig({
  // 같은 와이파이의 핸드폰이 QR 코드로 컨트롤러를 열 수 있도록, 개발 서버를 LAN에도 연다.
  server: { port: 5190, strictPort: true, host: true },
  plugins: [lanUrl()],
  build: {
    // 컨트롤러는 핸드폰에서 따로 여는 페이지이므로, 배포에도 게임과 함께 포함한다.
    rollupOptions: {
      input: { main: 'index.html', controller: 'controller.html' },
    },
  },
});

/**
 * 개발 서버의 LAN 주소를 /__lan-url로 알려 준다.
 * 브라우저는 PC의 LAN 주소를 알 수 없으므로, 게임을 localhost로 열어도 QR 코드에는 핸드폰이 접속할 수 있는 주소를 넣으려고 쓴다.
 */
function lanUrl(): Plugin {
  return {
    name: 'lan-url',
    configureServer(server) {
      server.middlewares.use('/__lan-url', (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(server.resolvedUrls?.network[0] ?? '');
      });
    },
  };
}
