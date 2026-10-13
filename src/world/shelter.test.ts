import { describe, expect, it } from 'vitest';
import { measureFetch, OPEN_SEA_FETCH } from './shelter';

describe('취주 거리', () => {
  // 북쪽으로 5km 떨어진 곳(z = -5000)에 동서로 길게 놓인 육지
  const northShore = (_x: number, z: number) => z < -5000;

  it('바람이 육지 쪽에서 불어오면 육지까지의 거리 정도가 된다', () => {
    const fetch = measureFetch(northShore, 0, 0, 0);
    // 비스듬한 방향은 조금 더 멀리에서 육지를 만나므로, 5km보다 약간 길다.
    expect(fetch).toBeGreaterThan(5000);
    expect(fetch).toBeLessThan(5800);
  });

  it('바람이 열린 바다 쪽에서 불어오면 상한까지 늘어난다', () => {
    expect(measureFetch(northShore, 0, 0, 180)).toBe(OPEN_SEA_FETCH);
  });

  it('해안에 붙어 있어도 0이 되지는 않는다', () => {
    expect(measureFetch(() => true, 0, 0, 90)).toBe(200);
  });

  it('동쪽은 +X, 북쪽은 -Z라는 좌표 규약을 따른다', () => {
    const eastShore = (x: number) => x > 3000;
    expect(measureFetch(eastShore, 0, 0, 90)).toBeLessThan(3600);
    expect(measureFetch(eastShore, 0, 0, 270)).toBe(OPEN_SEA_FETCH);
  });
});
