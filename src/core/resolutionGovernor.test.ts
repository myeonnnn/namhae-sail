import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from './resolutionGovernor';

/** 일정한 프레임 시간으로 주어진 시간 동안 진행하고, 그동안 바뀐 배율을 순서대로 반환한다. */
function run(governor: ResolutionGovernor, frameTime: number, seconds: number): number[] {
  const changes: number[] = [];
  for (let time = 0; time < seconds; time += frameTime) {
    const next = governor.update(frameTime);
    if (next !== undefined) changes.push(next);
  }
  return changes;
}

describe('해상도 조절', () => {
  it('초당 60프레임이 유지되면 해상도를 바꾸지 않는다', () => {
    const governor = new ResolutionGovernor(2);
    expect(run(governor, 1 / 60, 60)).toEqual([]);
    expect(governor.ratio).toBe(2);
  });

  it('느린 상태가 이어지면 한 단계씩 낮추고, 하한에서 멈춘다', () => {
    const governor = new ResolutionGovernor(2);
    expect(run(governor, 1 / 30, 3)).toEqual([1.75]);
    expect(run(governor, 1 / 30, 30)).toEqual([1.5, 1.25, 1]);
    expect(run(governor, 1 / 30, 30)).toEqual([]);
  });

  it('한두 프레임이 튀는 것과 잠깐 멈춘 것에는 반응하지 않는다', () => {
    const governor = new ResolutionGovernor(2);
    for (let i = 0; i < 600; i++) {
      // 1초마다 한 번씩 40ms짜리 프레임이 섞이고, 가끔 0.1초 동안 멈춘다.
      const frameTime = i % 240 === 0 ? 0.1 : i % 60 === 0 ? 0.04 : 1 / 60;
      expect(governor.update(frameTime)).toBeUndefined();
    }
  });

  it('여유가 생기면 다시 올린다', () => {
    const governor = new ResolutionGovernor(2);
    run(governor, 1 / 30, 3);
    expect(governor.ratio).toBe(1.75);
    expect(run(governor, 1 / 60, 7)).toEqual([]);
    expect(run(governor, 1 / 60, 3)).toEqual([2]);
  });

  it('올렸다가 곧 다시 느려지면, 다음에는 더 오래 기다린 뒤에 올린다', () => {
    const governor = new ResolutionGovernor(2);
    run(governor, 1 / 30, 3);
    // 낮춘 해상도에서는 빠르고, 올린 해상도에서는 느린 기기를 흉내 낸다.
    const simulate = (seconds: number) => {
      const raises: number[] = [];
      for (let time = 0; time < seconds;) {
        const frameTime = governor.ratio >= 2 ? 1 / 30 : 1 / 60;
        if (governor.update(frameTime) === 2) raises.push(time);
        time += frameTime;
      }
      return raises;
    };
    const raises = simulate(120);
    // 처음에는 약 8초 뒤에 올려 보고, 실패할 때마다 기다리는 시간이 두 배가 된다.
    expect(raises.length).toBeGreaterThanOrEqual(3);
    expect(raises[1] - raises[0]).toBeGreaterThan((raises[0] + 1) * 1.5);
    expect(raises[2] - raises[1]).toBeGreaterThan((raises[1] - raises[0]) * 1.5);
  });

  it('화면의 배율이 1이면 낮출 해상도가 없다', () => {
    const governor = new ResolutionGovernor(1);
    expect(run(governor, 1 / 20, 30)).toEqual([]);
    expect(governor.ratio).toBe(1);
  });
});
