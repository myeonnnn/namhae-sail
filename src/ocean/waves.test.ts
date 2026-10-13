import { describe, expect, it } from 'vitest';
import { significantWaveHeight } from './waves';

describe('바람이 만든 파도의 높이', () => {
  it('취주 거리가 길수록, 바람이 강할수록 높다', () => {
    expect(significantWaveHeight(15, 40000)).toBeLessThan(significantWaveHeight(15, 60000));
    expect(significantWaveHeight(15, 60000)).toBeLessThan(significantWaveHeight(15, 80000));
    expect(significantWaveHeight(10, 40000)).toBeLessThan(significantWaveHeight(20, 40000));
  });

  it('아직 자라고 있는 파도는 JONSWAP의 경험식 H = 0.0016·U·√(F/g)에 가깝다', () => {
    for (const [wind, fetch] of [[15, 40000], [20, 50000], [25, 60000]] as const) {
      const expected = 0.0016 * wind * Math.sqrt(fetch / 9.81);
      const actual = significantWaveHeight(wind, fetch);
      console.log(`U=${wind} F=${fetch / 1000}km: ${actual.toFixed(2)} m (경험식 ${expected.toFixed(2)} m)`);
      expect(actual / expected).toBeGreaterThan(0.7);
      expect(actual / expected).toBeLessThan(1.3);
    }
  });

  it('취주 거리가 충분하면 더 자라지 않는다', () => {
    expect(significantWaveHeight(6, 400000)).toBeCloseTo(significantWaveHeight(6, 4000000), 2);
  });

  it('섬에 가려진 곳에서도 파도가 일정한 수준 아래로는 줄어들지 않는다', () => {
    expect(significantWaveHeight(15, 500)).toBe(significantWaveHeight(15, 35000));
    expect(significantWaveHeight(15, 500)).toBeLessThan(significantWaveHeight(15, 80000));
  });

  it('바람이 없으면 파도가 없다', () => {
    expect(significantWaveHeight(0, 50000)).toBe(0);
  });
});
