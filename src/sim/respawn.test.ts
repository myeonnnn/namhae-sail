import { describe, expect, it } from 'vitest';
import type { Wind } from '../environment/wind';
import { respawnHeading } from './respawn';

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;

// 각도를 라디안으로 바꾸고 2π로 나머지를 구하는 과정의 반올림 오차는 1e-12 rad보다 훨씬 작다.
// 1e-9 rad는 방위로는 의미 없는 차이이므로 같은 방위로 본다.
const TOLERANCE = 1e-9;

/** 2π 차이를 같은 방위로 보고, 두 방위 사이의 가장 작은 각도 차이를 구한다. */
function bearingGap(a: number, b: number): number {
  const d = (((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

/** 결과가 JSDoc의 약속대로 0 이상 2π 미만이고, 기대한 방위와 같은 쪽을 가리키는지 확인한다. */
function expectBearing(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(actual).toBeGreaterThanOrEqual(0);
  expect(actual).toBeLessThan(TWO_PI);
  expect(bearingGap(actual, expected)).toBeLessThan(TOLERANCE);
}

function wind(speed: number, fromDeg: number): Wind {
  return { speed, fromDeg };
}

describe('자유 항해 중 전복 뒤 다시 세울 때의 선수 방위', () => {
  describe('바람이 있으면 바람이 불어오는 쪽으로 선수를 향한다', () => {
    it('바람이 동쪽(90°)에서 불어오면, 뒤집혔을 때 어디를 향했든 선수를 동쪽(π/2)으로 돌린다', () => {
      for (const heading of [0, 1, Math.PI, 5]) {
        expectBearing(respawnHeading(heading, wind(10, 90)), Math.PI / 2);
      }
    });

    it('바람이 남쪽(180°)과 서쪽(270°)에서 불어오면 선수를 각각 남쪽과 서쪽으로 향한다', () => {
      expectBearing(respawnHeading(0, wind(10, 180)), Math.PI);
      expectBearing(respawnHeading(0, wind(10, 270)), 1.5 * Math.PI);
    });

    it('바람이 북쪽(0°)에서 불어오면 선수를 북쪽(0)으로 향한다', () => {
      expectBearing(respawnHeading(2, wind(10, 0)), 0);
    });

    it('풍향 360°는 북쪽과 같으므로 결과는 2π가 아니라 0에 가까운 북쪽이다', () => {
      expectBearing(respawnHeading(2, wind(10, 360)), 0);
    });

    it('풍향 359.9°는 북쪽 바로 서쪽이며, 결과는 2π 미만으로 유지된다', () => {
      expectBearing(respawnHeading(2, wind(10, 359.9)), 359.9 * DEG);
    });

    it('한 바퀴 범위를 벗어난 풍향(-90°, 450°)도 같은 방위로 바꾸어 0 이상 2π 미만으로 돌려준다', () => {
      expectBearing(respawnHeading(0, wind(10, -90)), 1.5 * Math.PI);
      expectBearing(respawnHeading(0, wind(10, 450)), Math.PI / 2);
    });

    it('게임에서 가장 거친 바람(35 m/s)에서도 바람이 불어오는 쪽을 향한다', () => {
      expectBearing(respawnHeading(1, wind(35, 225)), 225 * DEG);
    });

    it('풍속이 정확히 0.1 m/s이면 바람이 있는 것으로 보고 바람이 불어오는 쪽을 향한다', () => {
      expectBearing(respawnHeading(Math.PI, wind(0.1, 90)), Math.PI / 2);
    });
  });

  describe('바람이 거의 없으면(0.1 m/s 미만) 뒤집혔을 때의 방향을 그대로 둔다', () => {
    it('풍속이 0이면 풍향과 관계없이 원래 방위를 유지한다', () => {
      expectBearing(respawnHeading(1.234, wind(0, 90)), 1.234);
      expectBearing(respawnHeading(Math.PI, wind(0, 0)), Math.PI);
    });

    it('풍속이 0.0999 m/s이면 아직 바람이 거의 없는 것으로 보고 원래 방위를 유지한다', () => {
      expectBearing(respawnHeading(Math.PI, wind(0.0999, 90)), Math.PI);
    });

    it('원래 방위가 0이면 0을 그대로 돌려준다', () => {
      expectBearing(respawnHeading(0, wind(0, 180)), 0);
    });

    it('원래 방위가 범위를 벗어나 있으면(음수, 2π 이상) 같은 방위를 0 이상 2π 미만으로 돌려준다', () => {
      expectBearing(respawnHeading(-Math.PI / 2, wind(0, 0)), 1.5 * Math.PI);
      expectBearing(respawnHeading(TWO_PI, wind(0, 0)), 0);
      expectBearing(respawnHeading(TWO_PI + 1, wind(0.05, 270)), 1);
    });
  });
});
