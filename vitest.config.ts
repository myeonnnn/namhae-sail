import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// 테스트는 개발 서버의 설정(vite.config.ts)이 필요 없으므로 이 파일만 읽는다.
export default defineConfig({
  test: {
    projects: [
      {
        // 물리와 수면 계산처럼 숫자만 다루는 테스트는 Node에서 돌린다. 빠르고 브라우저가 필요 없다.
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        // 셰이더처럼 WebGL이 필요한 테스트는 실제 브라우저 안에서 돌린다.
        // Playwright가 브라우저를 따로 내려받지 않도록, 이 컴퓨터에 설치된 Chrome을 쓴다.
        // 헤드리스 Chrome은 기본으로 GPU를 쓰지 않으므로, 실제 화면과 같은 조건이 되도록 GPU를 켠다.
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                channel: 'chrome',
                args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
