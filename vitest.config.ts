import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// 테스트는 개발 서버의 설정(vite.config.ts)이 필요 없으므로 이 파일만 읽는다.
export default defineConfig({
  test: {
    projects: [
      {
        // 단위 테스트: 모듈 하나를 Node에서 확인한다. 가장 빠르고, 코드를 고칠 때마다 돌린다.
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
          exclude: ['src/**/*.integration.test.ts', 'src/**/*.browser.test.ts', 'scripts/**/*.integration.test.mjs'],
        },
      },
      {
        // 통합 테스트: 여러 모듈을 실제로 엮어서 하나의 흐름을 Node에서 확인한다 (예: 수면 → 선체가 받는 힘 → 횡동요 → 전복).
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts', 'scripts/**/*.integration.test.mjs'],
        },
      },
      {
        // 브라우저 테스트: 셰이더처럼 WebGL이 필요한 것을 실제 브라우저 안에서 확인한다.
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
