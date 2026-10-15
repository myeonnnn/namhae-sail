// 테스트가 실제로 오류를 잡는지 확인하려고 일부러 주입하는 오류의 목록 (verify.mjs가 사용한다).
// 일반적인 변이(연산자 바꾸기)가 아니라, 이 프로젝트에서 실제로 생겼거나 생길 법한 오류를 고른다.
// find는 파일에 정확히 한 번 나와야 한다. 코드가 바뀌어서 자리가 사라지면 verify.mjs가 "적용 불가"로 알리므로, 그때 목록을 고친다.
//
// covered가 false인 항목은 지금의 테스트가 잡지 못한다고 알고 있는 빈틈이다. 테스트가 생겨서 잡게 되면 true로 바꾼다.

export const FAULTS = [
  {
    name: 'CPU 수면이 반 칸 어긋남',
    why: 'GPU 텍스처의 칸과 월드 좌표의 대응을 잘못 잡으면 화면의 수면과 배가 타는 수면이 0.76m 어긋난다. 실제로 있었던 오류이다.',
    file: 'src/ocean/seaSpectrum.ts',
    find: 'const angle = (-Math.PI * 2 * position) / PRIMARY_TILE;',
    replace: 'const angle = (-Math.PI * 2 * (position + 0.76)) / PRIMARY_TILE;',
    covered: true,
  },
  {
    name: 'GPU와 CPU의 수평 변위 배율이 다름',
    why: '한쪽의 뾰족한 정도만 바꾸면 마루의 위치가 화면과 물리에서 달라진다.',
    file: 'src/ocean/seaSurface.ts',
    find: 'choppiness: PRIMARY_CHOPPINESS,',
    replace: 'choppiness: 1.1,',
    covered: true,
  },
  {
    name: '수면 셰이더의 문법 오류',
    why: 'Three.js는 셰이더 컴파일이 실패해도 콘솔에 남기고 그리기만 건너뛰어서, 화면이 비어도 오류로 멈추지 않는다.',
    file: 'src/ocean/oceanMaterial.ts',
    find: 'float breaker = sea.w;',
    replace: 'float breaker = sea.w',
    covered: true,
  },
  {
    name: '너울의 에너지 정규화가 틀림',
    why: '분산과 유의파고의 관계(Hs = 4σ)를 잘못 쓰면 파도 세기 단계의 높이가 모두 달라진다.',
    file: 'src/ocean/seaSpectrum.ts',
    find: 'shape.swellEnergy = (swellHeight / 4) ** 2 / variance;',
    replace: 'shape.swellEnergy = (swellHeight / 2) ** 2 / variance;',
    covered: true,
  },
  {
    name: '파도가 바람을 거슬러 진행함',
    why: '방위(북쪽 0, 시계 방향)와 월드 좌표(-Z가 북쪽)의 변환에서 부호를 틀리기 쉽다.',
    file: 'src/ocean/seaSpectrum.ts',
    find: 'shape.windX = Math.sin(wind);',
    replace: 'shape.windX = -Math.sin(wind);',
    covered: true,
  },
  {
    name: '횡동요의 감쇠가 반대로 작용함',
    why: '감쇠의 부호가 바뀌면 흔들림이 잦아들지 않고 커져서 가만히 있어도 뒤집힌다.',
    file: 'src/ship/rollDynamics.ts',
    find: '- 2 * damping * naturalFrequency * state.rate',
    replace: '+ 2 * damping * naturalFrequency * state.rate',
    covered: true,
  },
  {
    name: '전복 벌점이 사라짐',
    why: '타임어택의 기록이 전복과 무관해진다.',
    file: 'src/sim/race.ts',
    find: 'export const CAPSIZE_PENALTY = 10;',
    replace: 'export const CAPSIZE_PENALTY = 0;',
    covered: true,
  },
  {
    name: '선체 아래의 수면을 반대쪽으로 옮겨서 읽음',
    why: '수면의 수평 이동을 거꾸로 적용하면 배가 마루와 어긋난 높이를 탄다. seakeeping.ts에는 아직 테스트가 없다.',
    file: 'src/ship/seakeeping.ts',
    find: 'state.x + shiftX + forward * sin + starboard * cos,',
    replace: 'state.x - shiftX + forward * sin + starboard * cos,',
    covered: false,
  },
  {
    name: '부서지는 마루가 선체를 반대쪽으로 넘어뜨림',
    why: '파도를 받는 방향의 부호가 바뀌면 조종의 요령이 뒤집힌다. seakeeping.ts에는 아직 테스트가 없다.',
    file: 'src/ship/seakeeping.ts',
    find: '(-towardStarboard + slam * Math.sign(load.surfaceSlope))',
    replace: '(towardStarboard + slam * Math.sign(load.surfaceSlope))',
    covered: false,
  },
  {
    name: '메인 에이전트도 테스트 파일을 고칠 수 있음',
    why: '훅의 판정이 뒤집히면 "구현하는 쪽은 테스트를 고치지 않는다"는 규칙이 아무 경고 없이 사라진다.',
    file: 'scripts/hooks/lib.mjs',
    find: 'if (input.agent_type === TEST_WRITER) return { allow: true };',
    replace: 'if (input.agent_type !== TEST_WRITER) return { allow: true };',
    covered: true,
  },
  {
    name: 'Stop 훅이 같은 실패로 끝없이 막음',
    why: '고치지 않은 채 다시 끝내려 할 때에도 검사를 반복하면, 모델이 빠져나오지 못하고 같은 실패를 되풀이한다.',
    file: 'scripts/hooks/lib.mjs',
    find: 'if (stopHookActive && fingerprint === lastFailed) return',
    replace: 'if (false && fingerprint === lastFailed) return',
    covered: true,
  },
];
