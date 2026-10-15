import { describe, expect, it } from 'vitest';
import { rightingMoment, stepRoll, type RollParams, type RollState } from './rollDynamics';

const VANISHING = (65 * Math.PI) / 180;
const PARAMS: RollParams = { period: 3, damping: 0.1, speedDamping: 0.01, vanishingAngle: VANISHING };
const DT = 1 / 60;

/** 수면의 기울기를 시간의 함수로 주고 일정 시간 동안 진행하면서, 기울기의 기록을 반환한다. */
function simulate(seconds: number, equilibrium: (time: number) => number, start: RollState, speed = 0): number[] {
  const history: number[] = [];
  for (let time = 0; time < seconds; time += DT) {
    stepRoll(start, equilibrium(time), 0, PARAMS, speed, DT);
    history.push(start.angle);
  }
  return history;
}

describe('횡동요', () => {
  it('기울어진 선체를 놓으면 고유 주기로 흔들리면서 잦아든다', () => {
    const history = simulate(12, () => 0, { angle: 0.3, rate: 0 });
    // 양수에서 음수로 넘어가는 시각의 간격이 한 주기이다.
    const crossings = history.flatMap((angle, i) => (i > 0 && history[i - 1] > 0 && angle <= 0 ? [i * DT] : []));
    expect(crossings[1] - crossings[0]).toBeCloseTo(PARAMS.period, 0);
    expect(Math.max(...history.slice(-60).map(Math.abs))).toBeLessThan(0.05);
  });

  it('고유 주기와 같은 주기의 파도를 만나면 수면의 기울기보다 훨씬 크게 기울어진다', () => {
    const slope = 0.05;
    const wave = (period: number) => (time: number) => slope * Math.sin((Math.PI * 2 * time) / period);
    const peak = (period: number) =>
      Math.max(...simulate(40, wave(period), { angle: 0, rate: 0 }).slice(-600).map(Math.abs));
    expect(peak(PARAMS.period)).toBeGreaterThan(slope * 3);
    // 주기가 긴 너울은 선체가 그대로 따라가고, 주기가 짧은 잔물결에는 거의 반응하지 않는다.
    expect(peak(PARAMS.period * 5)).toBeCloseTo(slope, 1);
    expect(peak(PARAMS.period / 4)).toBeLessThan(slope * 0.3);
  });

  it('달리고 있으면 같은 파도에서도 덜 흔들린다', () => {
    const wave = (time: number) => 0.05 * Math.sin((Math.PI * 2 * time) / PARAMS.period);
    const peak = (speed: number) =>
      Math.max(...simulate(40, wave, { angle: 0, rate: 0 }, speed).slice(-600).map(Math.abs));
    expect(peak(15)).toBeLessThan(peak(0) * 0.6);
  });

  it('화면이 오래 멈췄다가 돌아와도 값이 발산하지 않는다', () => {
    const state: RollState = { angle: 0.4, rate: 0.3 };
    for (let i = 0; i < 20; i++) stepRoll(state, 0, 0, PARAMS, 0, 5);
    expect(Math.abs(state.angle)).toBeLessThan(1);
  });

  it('작은 기울기에서는 복원력이 기울기에 비례하고, 소실각에서 사라진다', () => {
    expect(rightingMoment(0.02, VANISHING)).toBeCloseTo(0.02, 3);
    expect(rightingMoment(-0.02, VANISHING)).toBeCloseTo(-0.02, 3);
    expect(rightingMoment(VANISHING, VANISHING)).toBeCloseTo(0, 6);
    // 소실각을 넘으면 선체를 더 넘어뜨리는 쪽으로 작용한다.
    expect(rightingMoment(VANISHING + 0.2, VANISHING)).toBeLessThan(0);
    expect(rightingMoment(Math.PI, VANISHING)).toBeCloseTo(0, 6);
  });

  it('소실각의 안쪽에서 놓으면 일어서고, 바깥쪽에서 놓으면 뒤집힌다', () => {
    const settle = (degrees: number) => simulate(30, () => 0, { angle: (degrees * Math.PI) / 180, rate: 0 }).at(-1)!;
    expect(settle(55)).toBeCloseTo(0, 1);
    expect(settle(75)).toBeCloseTo(Math.PI, 1);
  });

  it('기울이는 힘이 계속 작용하면 그만큼 기울어진 채로 머무른다', () => {
    const state: RollState = { angle: 0, rate: 0 };
    for (let time = 0; time < 30; time += DT) stepRoll(state, 0, 0.1, PARAMS, 0, DT);
    expect(state.angle).toBeCloseTo(0.1, 2);
  });
});
