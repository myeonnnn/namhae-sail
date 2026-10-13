import { describe, expect, it } from 'vitest';
import { significantWaveHeight } from './waves';

describe('바람이 만든 파도의 높이', () => {
  it('섬에 가려진 곳에서도 파도가 일정한 수준 아래로는 줄어들지 않는다', () => {
    expect(significantWaveHeight(15, 500)).toBe(significantWaveHeight(15, 35000));
    expect(significantWaveHeight(15, 500)).toBeLessThan(significantWaveHeight(15, 80000));
  });

  it('가려지지 않은 곳에서는 취주 거리가 길수록 높다', () => {
    expect(significantWaveHeight(15, 40000)).toBeLessThan(significantWaveHeight(15, 80000));
  });
});
