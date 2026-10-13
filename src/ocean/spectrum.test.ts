import { describe, expect, it } from 'vitest';
import { createBands, GRAVITY, jonswapAmplitudes, significantHeight } from './spectrum';

// 파장 350m부터 7.5m까지, 앱이 사용하는 것과 같은 범위의 파도
const WAVELENGTHS = [350, 230, 150, 95, 62, 41, 27, 17, 11, 7.5];
const BANDS = createBands(WAVELENGTHS.map((wavelength) => Math.sqrt((GRAVITY * Math.PI * 2) / wavelength)));
const height = (windSpeed: number, fetch: number) => significantHeight(jonswapAmplitudes(windSpeed, fetch, BANDS, []));

describe('파도의 스펙트럼', () => {
  it('구간은 서로 맞닿아 있고, 양 끝은 바깥쪽으로 넓다', () => {
    for (let i = 1; i < BANDS.length; i++) expect(BANDS[i][0]).toBeCloseTo(BANDS[i - 1][1], 10);
    const width = (i: number) => BANDS[i][1] / BANDS[i][0];
    expect(width(0)).toBeGreaterThan(width(1) * 1.5);
    expect(width(BANDS.length - 1)).toBeGreaterThan(width(BANDS.length - 2) * 1.5);
  });

  it('취주 거리가 길수록, 바람이 강할수록 파도가 높다', () => {
    expect(height(15, 2000)).toBeLessThan(height(15, 20000));
    expect(height(15, 20000)).toBeLessThan(height(15, 80000));
    expect(height(10, 20000)).toBeLessThan(height(20, 20000));
  });

  it('아직 자라고 있는 파도는 JONSWAP의 경험식 H = 0.0016·U·√(F/g)에 가깝다', () => {
    for (const [wind, fetch] of [
      [15, 10000],
      [20, 20000],
      [25, 30000],
    ] as const) {
      const expected = 0.0016 * wind * Math.sqrt(fetch / GRAVITY);
      expect(height(wind, fetch) / expected).toBeGreaterThan(0.7);
      expect(height(wind, fetch) / expected).toBeLessThan(1.3);
    }
  });

  it('취주 거리가 충분하면 더 자라지 않는다', () => {
    expect(height(6, 400000)).toBeCloseTo(height(6, 4000000), 2);
  });

  it('바람이 없으면 파도가 없다', () => {
    expect(height(0, 50000)).toBe(0);
  });

  it('받은 배열에 결과를 적어서 돌려준다', () => {
    const out = [1, 2, 3];
    expect(jonswapAmplitudes(10, 20000, BANDS, out)).toBe(out);
    expect(out).toHaveLength(BANDS.length);
  });
});
