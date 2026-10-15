# Namhae Sail

통영~거제 한려수도를 요트로 항해하는 3D 시뮬레이터. Vite + TypeScript + Three.js(WebGL2) + OpenLayers.
배포: https://namhae-sail.vercel.app/ (main에 푸시하면 Vercel이 배포한다)

## 명령

```bash
pnpm dev          # 개발 서버, 포트 5190 고정. 상위 폴더 .claude/launch.json의 namhae-sail로 띄운다
pnpm typecheck
pnpm test         # 단위, 통합, 브라우저 테스트를 모두 실행
pnpm vitest run --project unit          # 단위만 (가장 빠름)
pnpm build
pnpm verify:harness   # 테스트 하네스 검증 (약 20초)
```

## 구조

- `src/main.ts`: 조립과 프레임 순서. 물리는 1/60초 고정 간격, 렌더는 매 프레임
- `src/ocean/`: `seaSpectrum.ts`(CPU와 GPU가 공유하는 스펙트럼), `seaSurface.ts`(GPU의 FFT), `waves.ts`(배가 타는 수면), `oceanMaterial.ts`(수면 셰이더)
- `src/ship/`: 운동 모델, 횡동요, 선체가 받는 힘(`seakeeping.ts`) / `src/sim/`: 충돌, 타임어택 판정 / `src/world/`: 지형, 육지 격자, 취주 거리
- `scripts/`: 자료 생성(`fetch-*`, `build-*`), 훅(`hooks/`), 하네스 검증(`harness/`). 게임은 이 폴더를 불러오지 않는다
- 좌표: 미터, +X 동쪽, -Z 북쪽. 방위는 북쪽을 0으로 하는 시계 방향 라디안

## 지켜야 할 것

- 화면의 수면과 배가 타는 수면은 `seaSpectrum.ts`의 같은 난수와 수식으로 각자 계산한다. `amplitude()`를 고치면 `AMPLITUDE_GLSL`도 함께 고친다.
- 수면의 형태나 `BREAKING_STEEPNESS`를 바꾸면 전복 빈도가 달라진다. 바꾸기 전과 후를 같은 조건의 모의 실험으로 비교한다.
- 수면과 날씨에는 `Math.random` 대신 `src/core/random.ts`의 `seededRandom`을 쓴다. 타임어택은 같은 바다를 재현해야 한다.
- 테스트 파일의 이름이 분류를 정한다: `*.test.ts`(단위, 파일당 0.5초), `*.integration.test.ts`(통합, 5초), `*.browser.test.ts`(WebGL이 필요할 때만, 5초).
- 기능을 추가하거나 동작을 바꿀 때는 `/feature`의 순서를 따른다. 테스트는 `test-writer` 에이전트만 쓰고, 기대값은 `docs/spec.md`에서 가져온다.
- 코드 주석은 한국어로 "왜"를 설명하고, 커밋 메시지는 영어로 쓴다. 커밋은 기능별로 나누고, 각 커밋이 typecheck와 test를 통과해야 한다.
- 헤드리스 브라우저 측정은 한 번에 하나만 실행한다. 동시에 돌리면 GPU를 나눠 써서 사용자의 화면이 끊긴다.
