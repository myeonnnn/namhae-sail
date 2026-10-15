import { describe, expect, it } from 'vitest';
import { seededRandom } from '../core/random';
import { smoothRoll } from './tilt';

/** 명세의 시정수: 0.15초 뒤에 바뀐 양의 1−1/e가 반영된다 */
const TAU = 0.15;

/**
 * 처음 값 start에서 시작해, 각 간격 dt마다 같은 목표 각도 target을 넣으며 smoothRoll을 반복해 부른다.
 * @returns 마지막에 돌려받은 각도
 */
function hold(start: number, target: number, intervals: number[]): number {
  let value = smoothRoll(undefined, start, 0);
  for (const dt of intervals) value = smoothRoll(value, target, dt);
  return value;
}

/** total초를 dt 간격으로 나눈 간격 목록. 나누어떨어지지 않으면 마지막 간격을 짧게 해서 합이 total이 되게 한다. */
function evenIntervals(total: number, dt: number): number[] {
  const out: number[] = [];
  let elapsed = 0;
  while (total - elapsed > 1e-12) {
    const step = Math.min(dt, total - elapsed);
    out.push(step);
    elapsed += step;
  }
  return out;
}

/** total초를 seed로 정한 고르지 않은 간격(5~50ms)으로 나눈 목록. 합은 total이다. */
function unevenIntervals(total: number, seed: number): number[] {
  const random = seededRandom(seed);
  const out: number[] = [];
  let elapsed = 0;
  while (total - elapsed > 1e-12) {
    const step = Math.min(0.005 + 0.045 * random(), total - elapsed);
    out.push(step);
    elapsed += step;
  }
  return out;
}

/** 바뀐 양 중에서 반영된 비율 */
function fraction(start: number, target: number, value: number): number {
  return (value - start) / (target - start);
}

describe('기울기를 부드럽게 반영 (smoothRoll): 처음 받은 값', () => {
  it('처음 받은 값(previous가 undefined)은 간격과 관계없이 그대로 돌려준다', () => {
    for (const roll of [-89, -20, -3, 0, 2.5, 17, 60]) {
      for (const dt of [0, 1 / 60, 0.15, 5]) {
        expect(smoothRoll(undefined, roll, dt)).toBe(roll);
      }
    }
  });
});

describe('기울기를 부드럽게 반영 (smoothRoll): 한 번에 바뀐 기울기를 따라가는 속도', () => {
  it('0도에서 20도로 한 번에 바뀌면, 0.15초 뒤에 바뀐 양의 약 63%(1−1/e)가 반영된다', () => {
    // 1 − 1/e ≈ 0.632. 명세가 "약"이라고 했으므로 ±0.02(바뀐 양의 2%p)까지 허용한다.
    const expected = 1 - 1 / Math.E;
    for (const dt of [1 / 60, 1 / 30, 0.05, 0.15]) {
      expect(Math.abs(fraction(0, 20, hold(0, 20, evenIntervals(0.15, dt))) - expected)).toBeLessThan(0.02);
    }
  });

  it('0도에서 20도로 한 번에 바뀌면, 0.45초 뒤에 바뀐 양의 약 95%가 반영된다', () => {
    // 0.45초는 시정수의 3배이므로 1 − e⁻³ ≈ 0.950. ±0.015까지 허용한다.
    const expected = 1 - Math.exp(-0.45 / TAU);
    for (const dt of [1 / 60, 1 / 30, 0.05, 0.15]) {
      expect(Math.abs(fraction(0, 20, hold(0, 20, evenIntervals(0.45, dt))) - expected)).toBeLessThan(0.015);
    }
  });

  it('반시계 방향(음수)으로 바뀌어도 같은 비율로 반영된다', () => {
    const value = hold(10, -15, evenIntervals(0.15, 1 / 60));
    expect(Math.abs(fraction(10, -15, value) - (1 - 1 / Math.E))).toBeLessThan(0.02);
  });

  it('0.15초보다 이르게는 63%에 못 미치고, 넘치거나 되돌아가지 않고 목표 쪽으로만 다가간다', () => {
    // 지수 평활은 목표를 넘지 않고(오버슈트 없음), 시간이 지날수록 목표에 더 가까워진다
    let value = smoothRoll(undefined, 0, 0);
    let previous = value;
    let elapsed = 0;
    for (let i = 0; i < 120; i++) {
      value = smoothRoll(value, 20, 1 / 60);
      elapsed += 1 / 60;
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(20);
      if (elapsed < 0.1 - 1e-9) expect(fraction(0, 20, value)).toBeLessThan(1 - 1 / Math.E);
      previous = value;
    }
  });

  it('크게 돌린 것은 끝까지 따라간다: 1초 뒤에는 바뀐 양의 99% 넘게 반영된다', () => {
    // 1초는 시정수의 약 6.7배이므로 1 − e^(−6.67) ≈ 0.9987. 99%는 그보다 넉넉한 하한이다.
    expect(fraction(0, 25, hold(0, 25, evenIntervals(1, 1 / 60)))).toBeGreaterThan(0.99);
    expect(fraction(0, -25, hold(0, -25, evenIntervals(1, 1 / 60)))).toBeGreaterThan(0.99);
  });

  it('직전 값과 지금 각도가 같으면 그대로 머문다', () => {
    for (const roll of [-30, 0, 12.5]) {
      for (const dt of [1 / 60, 0.1, 1]) expect(smoothRoll(roll, roll, dt)).toBeCloseTo(roll, 9);
    }
  });

  it('시간이 지나지 않았으면(dt = 0) 직전 값을 그대로 돌려준다', () => {
    expect(smoothRoll(5, 25, 0)).toBeCloseTo(5, 9);
    expect(smoothRoll(-12, 40, 0)).toBeCloseTo(-12, 9);
  });

  it('간격이 아주 길어도(앱이 잠시 멈췄다 돌아온 경우) 목표를 넘지 않고 목표에 거의 닿는다', () => {
    // 10초는 시정수의 약 67배이므로 남는 차이는 사실상 0이다
    for (const dt of [1, 10, 100]) {
      const value = smoothRoll(0, 20, dt);
      expect(value).toBeLessThanOrEqual(20);
      expect(value).toBeGreaterThan(19.9);
    }
  });
});

describe('기울기를 부드럽게 반영 (smoothRoll): 센서 값이 들어오는 간격', () => {
  // 지수 평활은 간격마다 e^(−dt/τ)씩 차이를 줄이므로, 간격을 어떻게 나누어도 같은 총 시간이면 결과가 같다.
  // 차이는 부동소수점 오차뿐이므로 1e-6도 안쪽에서 같아야 한다.
  const DIGITS = 6;

  it('1/60초 간격과 1/20초 간격으로 같은 0.3초를 보내면 같은 만큼 반영된다', () => {
    const at60 = hold(0, 20, evenIntervals(0.3, 1 / 60));
    const at20 = hold(0, 20, evenIntervals(0.3, 1 / 20));
    expect(at60).toBeCloseTo(at20, DIGITS);
  });

  it('고르지 않은 간격으로 같은 시간을 보내도 고른 간격과 같은 만큼 반영된다', () => {
    for (const total of [0.15, 0.3, 0.45]) {
      const reference = hold(-5, 18, evenIntervals(total, 1 / 60));
      for (const seed of [1, 2, 3, 42]) {
        expect(hold(-5, 18, unevenIntervals(total, seed))).toBeCloseTo(reference, DIGITS);
      }
    }
  });

  it('간격과 관계없이 0.15초 뒤의 반영 비율은 1−1/e이다', () => {
    // 고르지 않은 간격으로 나누어도 명세의 63%가 그대로 나와야 한다
    for (const seed of [7, 8, 9]) {
      expect(fraction(0, 20, hold(0, 20, unevenIntervals(TAU, seed)))).toBeCloseTo(1 - 1 / Math.E, 2);
    }
  });

  it('한 번에 0.15초를 보낸 결과와 여러 번에 나누어 0.15초를 보낸 결과가 같다', () => {
    const once = smoothRoll(0, 20, 0.15);
    expect(once).toBeCloseTo(hold(0, 20, evenIntervals(0.15, 0.01)), DIGITS);
    expect(once).toBeCloseTo(hold(0, 20, [0.1, 0.05]), DIGITS);
  });
});

describe('기울기를 부드럽게 반영 (smoothRoll): 손의 미세한 떨림', () => {
  /** 마지막 구간에서의 최댓값과 최솟값의 차이 */
  function peakToPeak(values: number[]): number {
    return Math.max(...values) - Math.min(...values);
  }

  it('평균 0도에서 ±2도로 초당 10번 오르내리는 떨림은 결과의 흔들림 폭이 입력의 1/4보다 작다', () => {
    // 시정수 τ인 1차 평활은 주파수 f의 진동을 1/√(1 + (2πfτ)²)배로 줄인다.
    // f = 10Hz, τ = 0.15초이면 1/√(1 + 9.42²) ≈ 0.105배다. 1/60초 샘플링에 따른 차이를 감안해 1/4을 상한으로 둔다.
    const dt = 1 / 60;
    let value: number | undefined;
    const tail: number[] = [];
    const inputs: number[] = [];
    for (let i = 0; i < 180; i++) {
      const t = i * dt;
      const roll = 2 * Math.sin(2 * Math.PI * 10 * t + 0.3);
      value = smoothRoll(value, roll, dt);
      // 처음 값을 그대로 쓰므로 처음 1초는 정착 구간으로 보고, 뒤의 2초만 잰다
      if (t >= 1) {
        tail.push(value);
        inputs.push(roll);
      }
    }
    expect(peakToPeak(tail)).toBeLessThan(peakToPeak(inputs) / 4);
    // 걸러 낸 뒤에도 평균 0도 근처에 머문다
    for (const v of tail) expect(Math.abs(v)).toBeLessThan(1);
  });

  it('무작위로 ±2도 떨리는 입력은 결과의 표준편차가 입력보다 훨씬 작다', () => {
    // 매 1/60초 독립인 떨림이면 지수 평활(α = 1 − e^(−dt/τ) ≈ 0.105)의 표준편차 비는 √(α/(2−α)) ≈ 0.24이다.
    // 유한한 표본의 흔들림을 감안해 0.4를 상한으로 둔다.
    const random = seededRandom(20261015);
    const dt = 1 / 60;
    let value: number | undefined;
    const outputs: number[] = [];
    const inputs: number[] = [];
    for (let i = 0; i < 600; i++) {
      const roll = -2 + 4 * random();
      value = smoothRoll(value, roll, dt);
      if (i >= 60) {
        outputs.push(value);
        inputs.push(roll);
      }
    }
    const std = (xs: number[]) => {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    };
    expect(std(outputs)).toBeLessThan(0.4 * std(inputs));
  });

  it('떨리는 손으로 크게 돌려도 돌린 각도는 따라간다', () => {
    // 20도로 돌린 채 ±2도 떨리면, 1초 뒤의 결과는 20도에서 떨림 폭(2도)보다 훨씬 가까이 있다.
    // 계단 응답의 남은 차이 20·e^(−6.67) ≈ 0.03도에, 걸러 진 떨림(표준편차 약 0.28도)의 5배를 더해도 1.5도 안쪽이다.
    const random = seededRandom(7);
    const dt = 1 / 60;
    let value = smoothRoll(undefined, 0, 0);
    for (let i = 0; i < 60; i++) value = smoothRoll(value, 20 + (-2 + 4 * random()), dt);
    expect(Math.abs(value - 20)).toBeLessThan(1.5);
  });
});
