import { describe, expect, it } from 'vitest';
import { latLonToTile, latLonToWorld, WORLD_ORIGIN, worldToLatLon } from './projection';

const NAUTICAL_MILE = 1852;

describe('projection', () => {
  it('maps the origin to (0, 0)', () => {
    const { x, z } = latLonToWorld(WORLD_ORIGIN);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('puts north at -Z and east at +X', () => {
    const north = latLonToWorld({ lat: WORLD_ORIGIN.lat + 0.1, lon: WORLD_ORIGIN.lon });
    const east = latLonToWorld({ lat: WORLD_ORIGIN.lat, lon: WORLD_ORIGIN.lon + 0.1 });
    expect(north.z).toBeLessThan(0);
    expect(north.x).toBeCloseTo(0, 6);
    expect(east.x).toBeGreaterThan(0);
    expect(east.z).toBeCloseTo(0, 6);
  });

  it('keeps distance error within 2% across the south sea', () => {
    for (const lat of [33.0, 34.0, 35.5]) {
      const a = latLonToWorld({ lat, lon: 127 });
      const b = latLonToWorld({ lat: lat + 1 / 60, lon: 127 });
      expect(Math.abs(a.z - b.z - NAUTICAL_MILE) / NAUTICAL_MILE).toBeLessThan(0.02);
    }
  });

  it('round-trips between lat/lon and world coordinates', () => {
    const point = { lat: 34.3, lon: 126.5 };
    const { x, z } = latLonToWorld(point);
    const back = worldToLatLon(x, z);
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lon).toBeCloseTo(point.lon, 9);
  });

  it('matches the known slippy-map tile for Busan', () => {
    // 부산항 부근(35.10N, 129.04E)은 줌 10에서 타일 (879, 405)에 속한다.
    const tile = latLonToTile({ lat: 35.1, lon: 129.04 }, 10);
    expect(Math.floor(tile.x)).toBe(879);
    expect(Math.floor(tile.y)).toBe(405);
  });
});
