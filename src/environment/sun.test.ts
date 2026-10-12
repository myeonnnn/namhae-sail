import { describe, expect, it } from 'vitest';
import { sunlight, sunPosition } from './sun';

const BUSAN = { lat: 35.1, lon: 129.04 };
// 10월 12일
const OCTOBER_12 = 285;

describe('sunPosition', () => {
  it('puts the autumn noon sun due south at the expected height over Busan', () => {
    // 부산의 10월 12일 남중 시각은 약 12시 10분이고, 남중 고도는 90 − 35.1 − 7.4 ≈ 47.5°이다.
    const sun = sunPosition({ hour: 12 + 10 / 60, dayOfYear: OCTOBER_12 }, BUSAN);
    expect(sun.elevationDeg).toBeGreaterThan(46);
    expect(sun.elevationDeg).toBeLessThan(49);
    expect(Math.abs(sun.azimuthDeg - 180)).toBeLessThan(4);
  });

  it('rises in the east and sets in the west', () => {
    const morning = sunPosition({ hour: 8, dayOfYear: OCTOBER_12 }, BUSAN);
    const evening = sunPosition({ hour: 16.5, dayOfYear: OCTOBER_12 }, BUSAN);
    expect(morning.x).toBeGreaterThan(0);
    expect(evening.x).toBeLessThan(0);
    expect(morning.azimuthDeg).toBeLessThan(180);
    expect(evening.azimuthDeg).toBeGreaterThan(180);
  });

  it('crosses the horizon near the published sunrise and sunset times', () => {
    // 부산의 10월 12일 일출은 약 6시 27분, 일몰은 약 17시 52분이다.
    expect(Math.abs(sunPosition({ hour: 6 + 27 / 60, dayOfYear: OCTOBER_12 }, BUSAN).elevationDeg)).toBeLessThan(1.5);
    expect(Math.abs(sunPosition({ hour: 17 + 52 / 60, dayOfYear: OCTOBER_12 }, BUSAN).elevationDeg)).toBeLessThan(1.5);
  });

  it('is higher at midsummer than at midwinter', () => {
    const summer = sunPosition({ hour: 12.5, dayOfYear: 172 }, BUSAN);
    const winter = sunPosition({ hour: 12.5, dayOfYear: 355 }, BUSAN);
    expect(summer.elevationDeg).toBeGreaterThan(75);
    expect(winter.elevationDeg).toBeLessThan(33);
  });

  it('returns a unit vector', () => {
    const { x, y, z } = sunPosition({ hour: 9.3, dayOfYear: 40 }, BUSAN);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
  });
});

describe('sunlight', () => {
  it('turns redder and weaker as the sun gets lower', () => {
    const high = sunlight(60);
    const low = sunlight(5);
    expect(low.strength).toBeLessThan(high.strength);
    // 파란 성분의 비율이 낮을수록 붉은 빛이다.
    expect(low.color[2]).toBeLessThan(high.color[2]);
    expect(high.color[0]).toBe(1);
  });

  it('goes dark below the horizon', () => {
    expect(sunlight(-3).strength).toBe(0);
  });
});
