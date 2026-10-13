import { describe, expect, it } from 'vitest';
import { hashString, seededRandom } from './random';

describe('고정된 난수', () => {
  it('씨앗 값이 같으면 같은 순서로 나온다', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('씨앗 값이 다르면 다른 순서로 나오고, 값은 0 이상 1 미만이다', () => {
    const a = seededRandom(hashString('hallyeo-15k:1'));
    const b = seededRandom(hashString('hallyeo-15k:2'));
    const values = Array.from({ length: 200 }, () => a());
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(values.slice(0, 5)).not.toEqual(Array.from({ length: 5 }, () => b()));
    // 한쪽으로 치우치지 않는다.
    expect(values.reduce((sum, value) => sum + value, 0) / values.length).toBeCloseTo(0.5, 1);
  });
});
