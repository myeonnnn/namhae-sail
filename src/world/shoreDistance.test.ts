import { describe, expect, it } from 'vitest';
import { distanceToLand } from './shoreDistance';

describe('육지까지의 거리', () => {
  it('육지에서 멀어질수록 한 칸씩 커진다', () => {
    // 5칸짜리 한 줄의 왼쪽 끝이 육지
    const distance = distanceToLand(new Uint8Array([1, 0, 0, 0, 0]), 5, 1);
    expect(Array.from(distance)).toEqual([0, 1, 2, 3, 4]);
  });

  it('여러 육지 가운데 가까운 쪽까지의 거리를 고른다', () => {
    const distance = distanceToLand(new Uint8Array([1, 0, 0, 0, 0, 0, 1]), 7, 1);
    expect(Array.from(distance)).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });

  it('대각선 방향은 한 칸보다 길게 센다', () => {
    const land = new Uint8Array(9);
    land[0] = 1;
    const distance = distanceToLand(land, 3, 3);
    expect(distance[4]).toBeCloseTo(Math.SQRT2);
    expect(distance[8]).toBeCloseTo(2 * Math.SQRT2);
  });

  it('육지가 없으면 모든 칸이 무한대이다', () => {
    expect(distanceToLand(new Uint8Array(4), 2, 2).every((d) => d === Infinity)).toBe(true);
  });
});
