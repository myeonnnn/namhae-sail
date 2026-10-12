import { describe, expect, it } from 'vitest';
import { latLonToWorld } from './projection';
import { isOutsideRegion, REGION } from './region';

describe('운영 구역', () => {
  it('모든 시작 위치가 구역의 안쪽에 있다', () => {
    for (const start of REGION.starts) {
      const { x, z } = latLonToWorld(start);
      expect(isOutsideRegion(x, z), start.name).toBe(false);
    }
  });

  it('경계의 바깥은 구역 밖으로 판정한다', () => {
    const { south, west, north, east } = REGION.bounds;
    const centre = { lat: (south + north) / 2, lon: (west + east) / 2 };
    const outside = [
      { ...centre, lat: north + 0.01 },
      { ...centre, lat: south - 0.01 },
      { ...centre, lon: west - 0.01 },
      { ...centre, lon: east + 0.01 },
    ];
    for (const point of outside) {
      const { x, z } = latLonToWorld(point);
      expect(isOutsideRegion(x, z)).toBe(true);
    }
  });
});
