import { describe, expect, it } from 'vitest';
import { sampleSea, shapeSea } from './seaSpectrum';

/** 넓은 범위의 여러 지점에서 읽은 높이로 유의파고(표준편차의 4배)를 구한다. */
function measuredHeight(time: number): number {
  let squares = 0;
  const count = 3000;
  for (let i = 0; i < count; i++) squares += sampleSea((i * 37.7) % 5000, (i * 91.3) % 5000, time).height ** 2;
  return 4 * Math.sqrt(squares / count);
}

describe('수면의 스펙트럼', () => {
  it('너울만 있으면 수면의 유의파고가 지정한 값과 같다', () => {
    shapeSea(0, 1, 180, 2, 220);
    expect(measuredHeight(12)).toBeCloseTo(2, 0);
  });

  it('바람이 만든 파도는 배가 타는 긴 파도에 에너지의 대부분이 들어 있다', () => {
    // 봉우리의 파장이 약 60m인 바다. 13m보다 짧은 물결은 화면에만 보이는 층이 맡으므로, 지정한 값보다 조금 낮게 나온다.
    shapeSea(3, 1, 180, 0, 0);
    const height = measuredHeight(12);
    expect(height).toBeGreaterThan(2.6);
    expect(height).toBeLessThan(3.1);
  });

  it('같은 시각의 같은 지점은 언제 읽어도 같은 값이다', () => {
    shapeSea(2, 1.2, 90, 1, 130);
    const first = sampleSea(123, -456, 30).height;
    sampleSea(0, 0, 31);
    expect(sampleSea(123, -456, 30).height).toBe(first);
  });

  it('파도는 바람이 불어 가는 쪽으로 진행한다', () => {
    // 바람이 동쪽(+x)으로 분다. 0.5초 뒤의 수면은 동쪽으로 옮겨서 읽어야 처음의 수면과 가장 비슷하다.
    shapeSea(2, 1.2, 90, 0, 0);
    const match = (shift: number) => {
      let sum = 0;
      for (let i = 0; i < 400; i++) {
        const x = (i * 13.1) % 389;
        const z = (i * 7.3) % 389;
        const before = sampleSea(x, z, 50).height;
        sum += before * sampleSea(x + shift, z, 50.5).height;
      }
      return sum;
    };
    expect(match(3)).toBeGreaterThan(match(-3));
  });

  it('마루에서는 가파름이 양수이고 수면이 마루 쪽으로 모인다', () => {
    shapeSea(3, 1, 180, 0, 0);
    let relation = 0;
    for (let i = 0; i < 2000; i++) {
      const { height, steepness } = sampleSea((i * 37.7) % 5000, (i * 91.3) % 5000, 8);
      relation += height * steepness;
    }
    expect(relation).toBeGreaterThan(0);
  });
});
