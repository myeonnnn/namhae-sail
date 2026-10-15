import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, type Plugin } from 'vite';

export default defineConfig({
  // 개발 서버는 기본으로 이 PC에서만 열어서, 같은 와이파이의 다른 기기가 소스에 접근하지 못하게 한다.
  // 핸드폰 컨트롤러를 시험할 때만 pnpm dev:lan으로 LAN에 연다.
  server: { port: 5190, strictPort: true },
  // 아이폰은 HTTPS 페이지에서만 기울기 센서를 허용하므로, 개발 서버도 자체 서명 인증서로 HTTPS를 쓴다.
  plugins: [basicSsl(), lanUrl()],
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
