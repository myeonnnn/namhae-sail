import { describe, expect, it } from 'vitest';
import { rudderFromRoll, screenRoll, type Gravity } from './tilt';

const G = 9.8;
const DEG = Math.PI / 180;

/** 반시계로 눕힌 가로(왼쪽으로 눕힘)와 시계로 눕힌 가로(오른쪽으로 눕힘)의 screen.orientation.angle */
const LANDSCAPES = [90, 270] as const;

/**
 * 가로로 쥔 핸드폰을 사용자가 보는 쪽에서 시계 방향으로 rollDeg도 돌렸을 때 센서가 재는 중력.
 *
 * 화면이 놓인 평면에서 핸드폰 본래(세로) 방향이 반시계로 φ만큼 돌아가 있으면,
 * 핸드폰의 x축(오른쪽 모서리)은 (cos φ, sin φ), y축(위쪽 모서리)은 (-sin φ, cos φ)를 향한다.
 * 센서는 세로로 세우면 y가 +9.8이므로 "위쪽"을 향하는 벡터 (0, 1)을 잰다. 그것을 핸드폰 축에 투영하면
 * x = sin φ, y = cos φ 이다. screenAngle은 반시계로 눕힌 각도이고 시계 방향으로 돌리면 φ가 줄어드므로 φ = screenAngle - rollDeg.
 * (검산: φ = 0이면 y = +9.8, φ = 90이면 오른쪽 모서리가 위를 향하므로 x = +9.8)
 * @param inPlane 화면 평면 안에 놓인 중력의 크기. 핸드폰을 뒤로 젖혀 들면 9.8보다 작아진다
 */
function landscapeGravity(rollDeg: number, screenAngle: number, inPlane = G): Gravity {
  const phi = (screenAngle - rollDeg) * DEG;
  return { x: inPlane * Math.sin(phi), y: inPlane * Math.cos(phi) };
}

/** 브라우저에 따라 x와 y의 부호가 모두 반대로 나오는 경우 */
function flipped(g: Gravity): Gravity {
  return { x: -g.x, y: -g.y };
}

// 삼각함수를 거쳐 되돌린 각도라 부동소수점 오차만 남는다. 1e-6도는 그보다 충분히 크고 조타에는 의미가 없는 크기다.
const ANGLE_DIGITS = 6;

describe('핸드폰을 돌린 각도 (screenRoll)', () => {
  it('가로로 쥐고 화면이 수평이면 각도는 0이다', () => {
    for (const angle of LANDSCAPES) {
      expect(screenRoll(landscapeGravity(0, angle), angle)).toBeCloseTo(0, ANGLE_DIGITS);
    }
  });

  it('왼쪽으로 눕힌 가로와 오른쪽으로 눕힌 가로 모두에서, 시계 방향으로 돌리면 양수이고 반시계 방향이면 음수다', () => {
    for (const angle of LANDSCAPES) {
      expect(screenRoll(landscapeGravity(15, angle), angle)).toBeGreaterThan(0);
      expect(screenRoll(landscapeGravity(-15, angle), angle)).toBeLessThan(0);
    }
  });

  it('두 가로 방향 모두에서 돌린 각도를 도 단위로 그대로 돌려준다', () => {
    for (const angle of LANDSCAPES) {
      for (let roll = -80; roll <= 80; roll += 5) {
        expect(screenRoll(landscapeGravity(roll, angle), angle)).toBeCloseTo(roll, ANGLE_DIGITS);
      }
    }
  });

  it('브라우저가 x와 y의 부호를 모두 반대로 주어도 같은 각도를 돌려준다', () => {
    for (const angle of LANDSCAPES) {
      for (const roll of [-60, -20, -3, 0, 3, 20, 60]) {
        expect(screenRoll(flipped(landscapeGravity(roll, angle)), angle)).toBeCloseTo(roll, ANGLE_DIGITS);
      }
    }
  });

  it('핸드폰을 뒤로 젖혀 들어 화면 평면의 중력이 작아져도 돌린 각도는 같다', () => {
    // 뒤로 50도 젖히면 화면 평면에 남는 중력은 9.8·cos 50° 이다
    const inPlane = G * Math.cos(50 * DEG);
    for (const angle of LANDSCAPES) {
      for (const roll of [-25, 0, 10, 25]) {
        expect(screenRoll(landscapeGravity(roll, angle, inPlane), angle)).toBeCloseTo(roll, ANGLE_DIGITS);
      }
    }
  });

  it('결과는 -90 이상 90 미만이다', () => {
    for (const angle of LANDSCAPES) {
      for (let roll = -179; roll <= 180; roll += 7) {
        for (const g of [landscapeGravity(roll, angle), flipped(landscapeGravity(roll, angle))]) {
          const result = screenRoll(g, angle);
          expect(result).toBeGreaterThanOrEqual(-90);
          expect(result).toBeLessThan(90);
        }
      }
    }
  });
});

describe('돌린 각도를 타의 위치로 (rudderFromRoll)', () => {
  it('화면이 수평인 자세에서 30도를 돌리면 타가 끝까지 간다: 시계 방향은 우현 +1, 반시계 방향은 좌현 -1', () => {
    expect(rudderFromRoll(30)).toBeCloseTo(1, 9);
    expect(rudderFromRoll(-30)).toBeCloseTo(-1, 9);
  });

  it('30도를 넘게 돌려도 ±1에 머문다', () => {
    for (const roll of [30.5, 45, 60, 89.9]) {
      expect(rudderFromRoll(roll)).toBe(1);
      expect(rudderFromRoll(-roll)).toBe(-1);
    }
  });

  it('수평에서 3도 안쪽은 0이다', () => {
    for (const roll of [0, 0.5, 1, 2, 2.9, 2.999]) {
      expect(rudderFromRoll(roll)).toBe(0);
      expect(rudderFromRoll(-roll)).toBe(0);
    }
  });

  it('3도와 30도 사이에서는 시계 방향이면 우현(0보다 크고 1보다 작다), 반시계 방향이면 좌현이다', () => {
    for (const roll of [4, 10, 16.5, 25, 29]) {
      const r = rudderFromRoll(roll);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
      expect(rudderFromRoll(-roll)).toBeLessThan(0);
      expect(rudderFromRoll(-roll)).toBeGreaterThan(-1);
    }
  });

  it('3도와 30도 사이는 돌린 각도에 비례한다: 같은 각도를 더 돌리면 어디서든 타가 같은 만큼 더 움직인다', () => {
    // 비례(선형)이면 같은 각도 간격의 증가량이 구간 어디서나 같다. 정확한 기울기는 가정하지 않고 증가량끼리 비교한다.
    const step = 5;
    const starts = [4, 9, 14, 19, 24];
    const increments = starts.map((a) => rudderFromRoll(a + step) - rudderFromRoll(a));
    for (const inc of increments) {
      expect(inc).toBeGreaterThan(0);
      expect(inc).toBeCloseTo(increments[0], 9);
    }
    // 반시계 방향도 같은 비율로 커진다
    for (const a of starts) {
      expect(rudderFromRoll(-(a + step)) - rudderFromRoll(-a)).toBeCloseTo(-increments[0], 9);
    }
  });

  it('3도를 넘는 순간 타가 튀지 않고 0에서부터 이어서 커진다', () => {
    // 3도 바로 바깥의 값은 0에 아주 가깝다. 3도를 넘는 순간 값이 뛰어오르면 이 한계를 크게 넘는다.
    expect(rudderFromRoll(3.001)).toBeGreaterThanOrEqual(0);
    expect(rudderFromRoll(3.001)).toBeLessThan(0.001);
    expect(rudderFromRoll(-3.001)).toBeLessThanOrEqual(0);
    expect(rudderFromRoll(-3.001)).toBeGreaterThan(-0.001);
    // 더 바깥으로 갈수록 0에서 멀어진다
    expect(rudderFromRoll(3.5)).toBeGreaterThan(rudderFromRoll(3.001));
  });

  it('돌린 각도가 커질수록 타는 줄어들지 않는다 (-90도에서 90도까지)', () => {
    let previous = rudderFromRoll(-90);
    for (let roll = -90; roll <= 89.75; roll += 0.25) {
      const r = rudderFromRoll(roll);
      expect(r).toBeGreaterThanOrEqual(previous);
      expect(r).toBeGreaterThanOrEqual(-1);
      expect(r).toBeLessThanOrEqual(1);
      previous = r;
    }
  });

  it('3도에서 0, 30도에서 1이고 그 사이가 비례하므로, 가운데인 16.5도에서는 타가 절반이다', () => {
    // 3도에서 0으로 이어지고 30도에서 1인 직선: (16.5 - 3) / (30 - 3) = 0.5, (9.75 - 3) / 27 = 0.25
    expect(rudderFromRoll(16.5)).toBeCloseTo(0.5, 9);
    expect(rudderFromRoll(-16.5)).toBeCloseTo(-0.5, 9);
    expect(rudderFromRoll(9.75)).toBeCloseTo(0.25, 9);
    expect(rudderFromRoll(-23.25)).toBeCloseTo(-0.75, 9);
  });
});

describe('센서 값에서 타의 위치까지 (screenRoll과 rudderFromRoll)', () => {
  it('왼쪽으로 눕힌 가로와 오른쪽으로 눕힌 가로 모두에서, 화면이 수평이면 타는 0이다', () => {
    for (const angle of LANDSCAPES) {
      expect(rudderFromRoll(screenRoll(landscapeGravity(0, angle), angle))).toBe(0);
      expect(rudderFromRoll(screenRoll(flipped(landscapeGravity(0, angle)), angle))).toBe(0);
    }
  });

  it('두 가로 방향 모두에서, 수평에서 시계 방향으로 30도 돌리면 우현 끝, 반시계 방향으로 30도 돌리면 좌현 끝이다', () => {
    for (const angle of LANDSCAPES) {
      expect(rudderFromRoll(screenRoll(landscapeGravity(30, angle), angle))).toBeCloseTo(1, 6);
      expect(rudderFromRoll(screenRoll(landscapeGravity(-30, angle), angle))).toBeCloseTo(-1, 6);
      expect(rudderFromRoll(screenRoll(landscapeGravity(45, angle), angle))).toBe(1);
      expect(rudderFromRoll(screenRoll(landscapeGravity(-45, angle), angle))).toBe(-1);
    }
  });

  it('기준은 항상 수평이다: 기울인 자세로 오래 들고 있어도 그 자세가 0이 되지 않는다', () => {
    // 반시계로 20도 기울인 채로 같은 값을 계속 넣어도 타는 계속 같은 좌현 위치다
    for (const angle of LANDSCAPES) {
      const held = screenRoll(landscapeGravity(-20, angle), angle);
      const first = rudderFromRoll(held);
      expect(first).toBeLessThan(0);
      for (let i = 0; i < 100; i++) expect(rudderFromRoll(held)).toBe(first);
    }
  });
});
