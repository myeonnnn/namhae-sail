# Namhae Sail

통영~거제 한려수도를 요트로 항해하는 3D 시뮬레이터. Vite + TypeScript + Three.js(WebGL2) + OpenLayers.
배포: https://namhae-sail.vercel.app/ (main에 푸시하면 Vercel이 배포한다)

## 명령

```bash
pnpm dev          # 개발 서버, 포트 5190 고정 (vite.config.ts의 strictPort)
pnpm typecheck
pnpm test         # 단위, 통합, 브라우저 테스트를 모두 실행
pnpm vitest run --project unit          # 단위 테스트만 (코드를 고칠 때마다)
pnpm vitest run --project integration   # 통합 테스트만
pnpm vitest run --project browser       # WebGL이 필요한 테스트만 (설치된 Chrome을 헤드리스로 사용)
pnpm build        # typecheck + vite build
npx prettier --single-quote --print-width 120 --write <파일>
```

- prettier 설정 파일이 없다. 옵션을 빼면 큰따옴표로 바뀌고, 폴더 전체에 실행하면 관계없는 파일까지 바뀐다. 고친 파일에만 실행한다.
- 개발 서버는 상위 폴더의 `.claude/launch.json`에 `namhae-sail`로 등록되어 있다.

## 구조

- `src/main.ts`: 모듈을 조립하고 프레임의 순서를 정한다. 물리는 1/60초 고정 간격, 렌더는 매 프레임이다.
- `src/ocean/`: `seaSpectrum.ts`(CPU와 GPU가 공유하는 스펙트럼), `seaSurface.ts`(GPU의 FFT), `waves.ts`(배가 타는 수면과 파도 상태), `oceanMaterial.ts`(수면 셰이더), `wake.ts`(항적)
- `src/ship/`: 선박 사양, 운동 모델, 횡동요, 선체가 수면과 바람에서 받는 힘(`seakeeping.ts`)
- `src/sim/`: 충돌, 전복 처리, 타임어택 판정(`race.ts`), 조언(`coach.ts`)
- `src/environment/`: 바람, 너울, 파도 세기 5단계(15가지 환경), 태양
- `src/world/`: 지형 타일, 육지 격자와 취주 거리(`shelter.ts`), 구조물, 등대와 부표
- `src/game/`, `src/course/`: 타임어택의 진행과 코스 자료(`courses.json`), 기록 저장
- `src/ui/`: HUD와 계기, 메뉴, 소리(Web Audio로 합성)
- 좌표: 미터, +X 동쪽, -Z 북쪽. 방위는 북쪽을 0으로 하는 시계 방향 라디안이다.

## 지켜야 할 것

- 화면의 수면과 배가 타는 수면은 `seaSpectrum.ts`의 같은 난수와 수식으로 각자 계산한다. `amplitude()`를 고치면 `AMPLITUDE_GLSL`도 함께 고친다. 층의 무늬 크기와 파수 범위도 양쪽이 같아야 한다.
- 수면의 형태나 `BREAKING_STEEPNESS`를 바꾸면 전복 빈도가 달라진다. 바꾸기 전과 후를 같은 조건(파도 세기, 받는 방향, 속력)의 모의 실험으로 비교해서 맞춘다.
- 타임어택은 같은 바다를 재현해야 한다. 수면과 날씨에는 `Math.random` 대신 `src/core/random.ts`의 `seededRandom`을 쓴다.
- 개발 전용 코드는 `import.meta.env.DEV`로 감싼다. 배포 빌드에서 제거된다.

## 테스트의 분류

| 분류 | 파일 이름 | 기준 | 시간 |
| --- | --- | --- | --- |
| 단위 | `*.test.ts` | 모듈 하나의 입력과 출력. Node, 결정적, DOM·WebGL·네트워크 없음 | 파일당 0.5초 이내 |
| 통합 | `*.integration.test.ts` | 여러 모듈을 실제로 엮은 흐름이 핵심일 때 (예: 수면 → 선체가 받는 힘 → 횡동요 → 전복). 모의 객체 없이 실제 모듈 | 파일당 5초 이내 |
| 브라우저 | `*.browser.test.ts` | WebGL이나 DOM이 꼭 필요할 때만 (셰이더 컴파일, GPU와 CPU의 일치) | 파일당 5초 이내 |

- 수 분이 걸리는 통계 측정(전복 빈도 등)은 테스트가 아니라 측정 스크립트로 둔다.
- 눈으로 판단해야 하는 것(물거품의 모양, 움직임)은 테스트로 만들지 않고 화면으로 확인한다.

## 기능을 만드는 순서 (테스트 먼저)

1. **수용 기준**: 요청을 확인할 수 있는 문장으로 정리한다. 여러 파일에 걸치거나 동작이 바뀌는 기능은 사용자의 확인을 받는다.
2. **테스트 작성**: `test-writer` 에이전트(`.claude/agents/test-writer.md`)에게 맡긴다. 전달하는 것은 요청 원문, 확인된 수용 기준, 건드릴 모듈의 경로와 시그니처뿐이다. 구현 계획과 구현 코드는 전달하지 않는다.
3. **실패 확인**: 새 테스트가 올바른 이유로 실패하는지 확인한다. 이 단계 전에는 구현을 시작하지 않는다.
4. **구현**: 테스트가 통과할 때까지 구현한다. 구현하는 쪽은 테스트를 고치지 않는다. 테스트가 틀렸다고 판단되면 이유를 사용자에게 보고하고, 수정은 `test-writer`에게 맡긴다.
5. **전체 확인**: `pnpm typecheck`와 `pnpm test`를 모두 통과시킨다.

예외: 한두 줄의 수정, 서식과 주석, 화면의 모양을 다듬는 작업(셰이더의 색, 물거품의 질감)은 이 순서를 따르지 않는다. 다만 수식이나 판정 기준을 바꾸는 셰이더 수정은 예외가 아니다.

## 작업 방식

- 코드 주석은 한국어로 "왜"를 설명한다. 커밋 메시지는 영어로 쓴다.
- 커밋은 기능별로 나누고, 각 커밋이 typecheck와 test를 통과해야 한다.
- 화면에 보이는 변경은 브라우저에서 직접 확인한다. 헤드리스 브라우저로 측정할 때에는 한 번에 하나만 실행한다. 여러 개를 동시에 돌리면 GPU를 나눠 써서 사용자의 화면이 끊긴다.
