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
  it('영점에서 30도를 돌리면 타가 끝까지 간다: 시계 방향은 우현 +1, 반시계 방향은 좌현 -1', () => {
    expect(rudderFromRoll(30, 0)).toBeCloseTo(1, 9);
    expect(rudderFromRoll(-30, 0)).toBeCloseTo(-1, 9);
  });

  it('30도를 넘게 돌려도 ±1에 머문다', () => {
    for (const roll of [30.5, 45, 60, 89.9]) {
      expect(rudderFromRoll(roll, 0)).toBe(1);
      expect(rudderFromRoll(-roll, 0)).toBe(-1);
    }
  });

  it('영점에서 3도 안쪽은 0이다', () => {
    for (const roll of [0, 0.5, 1, 2, 2.9, 2.999]) {
      expect(rudderFromRoll(roll, 0)).toBe(0);
      expect(rudderFromRoll(-roll, 0)).toBe(0);
    }
  });

  it('3도와 30도 사이에서는 시계 방향이면 우현(0보다 크고 1보다 작다), 반시계 방향이면 좌현이다', () => {
    for (const roll of [4, 10, 16.5, 25, 29]) {
      const r = rudderFromRoll(roll, 0);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
      expect(rudderFromRoll(-roll, 0)).toBeLessThan(0);
      expect(rudderFromRoll(-roll, 0)).toBeGreaterThan(-1);
    }
  });

  it('3도와 30도 사이는 돌린 각도에 비례한다: 같은 각도를 더 돌리면 어디서든 타가 같은 만큼 더 움직인다', () => {
    // 비례(선형)이면 같은 각도 간격의 증가량이 구간 어디서나 같다. 정확한 기울기는 가정하지 않고 증가량끼리 비교한다.
    const step = 5;
    const starts = [4, 9, 14, 19, 24];
    const increments = starts.map((a) => rudderFromRoll(a + step, 0) - rudderFromRoll(a, 0));
    for (const inc of increments) {
      expect(inc).toBeGreaterThan(0);
      expect(inc).toBeCloseTo(increments[0], 9);
    }
    // 반시계 방향도 같은 비율로 커진다
    for (const a of starts) {
      expect(rudderFromRoll(-(a + step), 0) - rudderFromRoll(-a, 0)).toBeCloseTo(-increments[0], 9);
    }
  });

  it('3도를 넘는 순간 타가 튀지 않고 0에서부터 이어서 커진다', () => {
    // 3도 바로 바깥의 값은 0에 아주 가깝다. 3도를 넘는 순간 값이 뛰어오르면 이 한계를 크게 넘는다.
    expect(rudderFromRoll(3.001, 0)).toBeGreaterThanOrEqual(0);
    expect(rudderFromRoll(3.001, 0)).toBeLessThan(0.001);
    expect(rudderFromRoll(-3.001, 0)).toBeLessThanOrEqual(0);
    expect(rudderFromRoll(-3.001, 0)).toBeGreaterThan(-0.001);
    // 더 바깥으로 갈수록 0에서 멀어진다
    expect(rudderFromRoll(3.5, 0)).toBeGreaterThan(rudderFromRoll(3.001, 0));
  });

  it('돌린 각도가 커질수록 타는 줄어들지 않는다 (-90도에서 90도까지)', () => {
    let previous = rudderFromRoll(-90, 0);
    for (let roll = -90; roll <= 89.75; roll += 0.25) {
      const r = rudderFromRoll(roll, 0);
      expect(r).toBeGreaterThanOrEqual(previous);
      expect(r).toBeGreaterThanOrEqual(-1);
      expect(r).toBeLessThanOrEqual(1);
      previous = r;
    }
  });

  it('영점을 옮기면 새 영점에서 돌린 각도로 타가 정해진다', () => {
    const zero = 12;
    for (const delta of [-45, -30, -17, -2, 0, 2, 9, 17, 30, 45]) {
      expect(rudderFromRoll(zero + delta, zero)).toBeCloseTo(rudderFromRoll(delta, 0), 9);
    }
    // 새 영점에 그대로 두면 0이고, 처음 영점(0도)으로 돌아가면 반시계로 12도 돌린 것이므로 좌현이다
    expect(rudderFromRoll(zero, zero)).toBe(0);
    expect(rudderFromRoll(0, zero)).toBeLessThan(0);
    expect(rudderFromRoll(zero + 30, zero)).toBeCloseTo(1, 9);
    expect(rudderFromRoll(zero - 30, zero)).toBeCloseTo(-1, 9);
  });

  it('영점 버튼을 누른 순간의 자세를 그대로 유지하면 타는 0이다 (센서 값에서 영점을 잡는 흐름)', () => {
    for (const angle of LANDSCAPES) {
      const held = landscapeGravity(-20, angle);
      const zero = screenRoll(held, angle);
      expect(rudderFromRoll(screenRoll(held, angle), zero)).toBe(0);
      // 그 자세에서 시계 방향으로 30도 더 돌리면 우현 끝이다
      expect(rudderFromRoll(screenRoll(landscapeGravity(10, angle), angle), zero)).toBeCloseTo(1, 6);
    }
  });

  it('처음 영점(0도)에서는 화면이 수평일 때 타가 0이다', () => {
    for (const angle of LANDSCAPES) {
      expect(rudderFromRoll(screenRoll(landscapeGravity(0, angle), angle), 0)).toBe(0);
    }
  });
});
