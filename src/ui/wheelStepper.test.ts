import { describe, expect, it } from 'vitest';
import { WheelStepper } from './wheelStepper';

describe('WheelStepper', () => {
  it('마우스 휠은 칸마다 한 단계씩 반응한다', () => {
    const wheel = new WheelStepper();
    expect(wheel.feed(100, 0)).toBe(1);
    expect(wheel.feed(100, 200)).toBe(1);
    expect(wheel.feed(-100, 400)).toBe(-1);
  });

  it('트랙패드의 이어지는 스크롤은 양을 모아서, 일정한 간격으로만 단계를 바꾼다', () => {
    const wheel = new WheelStepper({ step: 40, cooldownMs: 500 });
    const steps: number[] = [];
    // 16ms 간격으로 8씩, 약 1초 동안 스크롤한다.
    for (let i = 0; i < 60; i++) steps.push(wheel.feed(8, 1000 + i * 16));
    expect(steps.filter((step) => step !== 0)).toEqual([1, 1]);
  });

  it('스크롤이 멈추면 모아 둔 양을 버린다', () => {
    const wheel = new WheelStepper();
    expect(wheel.feed(30, 0)).toBe(0);
    expect(wheel.feed(30, 1000)).toBe(0);
  });
});
