import { describe, expect, it } from 'vitest';
import { formatBearing, formatDistance, formatLatLon } from './units';

describe('단위의 표기', () => {
  it('방위를 세 자리로 표시하고, 360°는 000°로 되돌린다', () => {
    expect(formatBearing(0)).toBe('000°');
    expect(formatBearing(Math.PI / 2)).toBe('090°');
    expect(formatBearing(-Math.PI / 2)).toBe('270°');
    expect(formatBearing(Math.PI * 2 - 0.001)).toBe('000°');
  });

  it('경위도를 도와 분으로 표시한다', () => {
    expect(formatLatLon(34.5, 128.25)).toBe('34°30.000′N  128°15.000′E');
    expect(formatLatLon(-0.1, -1.5)).toBe('0°06.000′S  1°30.000′W');
  });

  it('거리를 가까우면 미터로, 멀면 킬로미터로 표시한다', () => {
    expect(formatDistance(926)).toBe('926 m (0.50 해리)');
    expect(formatDistance(3704)).toBe('3.7 km (2.0 해리)');
  });
});
