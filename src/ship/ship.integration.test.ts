import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEA_LEVELS } from '../environment/seaState';
import { windVelocity, type Wind } from '../environment/wind';
import type { Swell } from '../environment/swell';
import { updateWaves } from '../ocean/waves';
import { Ship } from './ship';
import { SPORT_YACHT } from './shipSpec';

// 실제 수면(waves.ts, seaSpectrum.ts) → 선체가 받는 힘(seakeeping.ts) → 횡동요(rollDynamics.ts) → 전복 판정(ship.ts)을
// 엮어서, 타임어택의 카운트다운 동안 배가 뒤집히지 않는지 확인한다 (명세 "4. 타임어택 > 진행").

/** 명세 "4. 타임어택 > 진행": 출발 전의 카운트다운 (초) */
const COUNTDOWN_SECONDS = 3;
/**
 * 카운트다운보다 조금 길게 붙잡아 두어도 뒤집히지 않아야 한다. 출발 신호가 프레임 하나쯤 늦거나 수면의 시계가
 * 어긋나도 여유가 있도록 2초를 더한다. 한 프레임에 약 1ms(여러 파일을 함께 돌리면 2~3ms)가 들므로,
 * 자리 하나를 붙잡는 테스트가 전체 실행에서도 1초 안팎에 끝난다.
 */
const HOLD_SECONDS = COUNTDOWN_SECONDS + 2;
/** 명세 "흔들림과 전복": 선체를 일으키는 힘이 사라지는 기울기 */
const VANISHING_ANGLE = (65 * Math.PI) / 180;
const FRAME = 1 / 60;

/**
 * 가장 거친 바다: 5단계의 가장 거친 환경(풍속 35 m/s, 너울 3.8 m).
 * 바람과 너울이 같은 쪽(너울의 기본 방향인 남남동 150°)에서 와서 파도가 한 방향으로 겹치게 하고,
 * 섬에 가려지지 않은 열린 바다로 둔다.
 */
const STORM = SEA_LEVELS[4].steps[2];
const FROM_DEG = 150;
const wind: Wind = { speed: STORM.windSpeed, fromDeg: FROM_DEG };
const swell: Swell = { height: STORM.swellHeight, fromDeg: FROM_DEG };
const OPEN_SEA = { fetch: 1_000_000, swellFetch: 1_000_000 };
const airVelocity = windVelocity(wind);

/** 파도가 오는 쪽에서 90° 돌린 방향. 명세 "흔들림과 전복": 멈춘 채 파도를 옆으로 받을 때 가장 크게 흔들린다. */
const BEAM_HEADING = ((FROM_DEG + 90) * Math.PI) / 180;

/**
 * 출발 위치와 카운트다운을 시작하는 수면의 시각(초). 같은 바다라도 자리와 시각마다 만나는 마루가 다르므로 여러 곳에서 확인한다.
 * 이 자리들은 steady 없이 두면 수 초 안에 뒤집히는 곳으로 골랐다 (아래의 대조군이 그것을 확인한다).
 */
const STARTS = [
  // 타임어택은 자유 항해를 하다가 시작하므로, 수면의 시계가 0이 아닌 시각에서도 카운트다운이 시작된다.
  { x: 0, z: 0, time: 600 },
  { x: 822, z: -1266, time: 0 },
];

/** 출발 위치에 멈춰 선 배. 물리 스텝(update)은 부르지 않으므로 위치와 방향은 그대로이다. */
function shipAt(start: { x: number; z: number }): Ship {
  const ship = new Ship(SPORT_YACHT);
  ship.state.x = start.x;
  ship.state.z = start.z;
  ship.state.heading = BEAM_HEADING;
  return ship;
}

interface Hold {
  /** 처음 뒤집힌 시각 (붙잡기 시작한 뒤의 초). 뒤집히지 않았으면 undefined */
  capsizedAt?: number;
  /** 붙잡는 동안의 가장 큰 횡경사의 크기 (rad) */
  maxHeel: number;
  /** 붙잡는 동안 횡경사가 움직인 폭 (rad) */
  heelRange: number;
}

/**
 * 렌더 프레임마다 syncObject를 부르면서 seconds 동안 붙잡아 둔다. 뒤집히면 그 자리에서 멈춘다.
 * 게임처럼 수면의 시계(elapsed)는 프레임 간격만큼씩 흐른다.
 */
function hold(ship: Ship, startTime: number, seconds: number, steady: boolean, frame = FRAME): Hold {
  let maxHeel = 0;
  let minHeel = Infinity;
  let highHeel = -Infinity;
  const frames = Math.round(seconds / frame);
  for (let i = 1; i <= frames; i++) {
    ship.syncObject(startTime + i * frame, frame, airVelocity, steady);
    maxHeel = Math.max(maxHeel, Math.abs(ship.heel));
    minHeel = Math.min(minHeel, ship.heel);
    highHeel = Math.max(highHeel, ship.heel);
    if (ship.capsized) return { capsizedAt: i * frame, maxHeel, heelRange: highHeel - minHeel };
  }
  return { maxHeel, heelRange: highHeel - minHeel };
}

describe('카운트다운 동안 배는 뒤집히지 않는다', () => {
  beforeAll(() => {
    updateWaves(wind, swell, OPEN_SEA, FRAME);
    // Node에서는 선박의 모델 파일을 불러올 수 없어서 생성자가 경고를 남긴다. 테스트의 출력이 어지럽지 않도록 감춘다.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  // 자리마다 테스트를 나누어, 한 테스트가 전체 실행에서도 시간 제한(5초)에 넉넉히 들게 한다.
  it.each(STARTS)('대조군: 같은 바다의 ($x, $z)에서 steady 없이 두면 카운트다운 안에 실제로 뒤집힌다', (start) => {
    // 아래의 테스트가 "바다가 순해서 통과"하지 않도록, 조건이 충분히 거친지 먼저 확인한다.
    // 카운트다운의 길이만 붙잡아도 뒤집히므로, steady가 없으면 출발 전에 전복된다는 뜻이기도 하다.
    const result = hold(shipAt(start), start.time, COUNTDOWN_SECONDS, false);
    expect(result.capsizedAt, `${start.time}초에서 steady 없이 뒤집히지 않았다`).toBeDefined();
  });

  it.each(STARTS)(
    '가장 거친 바다에서 파도를 옆으로 받으며 ($x, $z)에 멈춰 있어도, steady로 동기화하면 카운트다운보다 길게 흔들리기만 하고 뒤집히지 않는다',
    (start) => {
      const ship = shipAt(start);
      const result = hold(ship, start.time, HOLD_SECONDS, true);
      expect(result.capsizedAt, `${result.capsizedAt}초에 뒤집혔다`).toBeUndefined();
      expect(ship.capsized).toBe(false);
      // 뒤집히지 않았다면 기울기도 복원력이 사라지는 각도 안쪽에 머물러야 한다.
      expect(result.maxHeel).toBeLessThan(VANISHING_ANGLE);
      // 명세는 "흔들리기는 해도"라고 하므로, 선체를 수평으로 얼려 두는 것으로는 만족하지 않는다.
      // 유의파고 약 6~7m, 파장 100m 안팎의 바다에서 수면의 기울기는 수 도에서 십여 도에 이른다 (기울기 ≈ πH/λ).
      // 그 가운데 작은 쪽인 3°를 흔들림의 폭의 하한으로 둔다.
      expect(result.heelRange).toBeGreaterThan((3 * Math.PI) / 180);
    },
  );

  it('화면이 초당 30프레임으로 느리게 그려져도 steady로 붙잡혀 있으면 뒤집히지 않는다', () => {
    // 프레임 간격이 길면 한 번에 진행하는 시간이 커져서 기울기가 튀기 쉽다. 핸드폰처럼 느린 기기를 흉내 낸다.
    const start = STARTS[1];
    const result = hold(shipAt(start), start.time, HOLD_SECONDS, true, 1 / 30);
    expect(result.capsizedAt, `${result.capsizedAt}초에 뒤집혔다`).toBeUndefined();
  });
});
