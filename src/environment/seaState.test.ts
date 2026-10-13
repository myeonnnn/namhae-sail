import { describe, expect, it } from 'vitest';
import { createSeaState, SEA_LEVELS, selectSeaLevel, updateSeaState } from './seaState';

/** 정해진 순서의 값을 되풀이해서 반환하는 난수 */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('파도의 세기', () => {
  it('환경은 잔잔한 것부터 거친 것까지 순서대로 15가지이다', () => {
    const steps = SEA_LEVELS.flatMap((level) => level.steps);
    expect(steps).toHaveLength(15);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].windSpeed).toBeGreaterThan(steps[i - 1].windSpeed);
      expect(steps[i].swellHeight).toBeGreaterThanOrEqual(steps[i - 1].swellHeight);
    }
  });

  it('단계를 고르면 가운데 환경에서 시작한다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    createSeaState(wind, swell, 4);
    expect(wind.speed).toBe(SEA_LEVELS[3].steps[1].windSpeed);
    expect(swell.height).toBe(SEA_LEVELS[3].steps[1].swellHeight);
  });

  it('시간이 지나면 같은 단계의 범위 안에서 풍속과 너울이 오르내린다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    const state = createSeaState(wind, swell, 3);
    const [calm, , rough] = SEA_LEVELS[2].steps;
    const random = sequence([0.9, 0.5, 0.1, 0.5]);
    let lowest = Infinity;
    let highest = -Infinity;
    for (let time = 0; time < 600; time += 0.1) {
      updateSeaState(state, wind, swell, 0.1, random);
      expect(wind.speed).toBeGreaterThanOrEqual(calm.windSpeed - 1e-9);
      expect(wind.speed).toBeLessThanOrEqual(rough.windSpeed + 1e-9);
      expect(swell.height).toBeGreaterThanOrEqual(calm.swellHeight - 1e-9);
      expect(swell.height).toBeLessThanOrEqual(rough.swellHeight + 1e-9);
      lowest = Math.min(lowest, wind.speed);
      highest = Math.max(highest, wind.speed);
    }
    // 가장 잔잔한 환경과 가장 거친 환경의 근처까지 모두 다녀온다.
    expect(lowest).toBeLessThan(calm.windSpeed + 0.5);
    expect(highest).toBeGreaterThan(rough.windSpeed - 0.5);
  });

  it('직접 조절하는 동안에는 바꾸지 않고, 단계를 다시 고르면 이어서 바꾼다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    const state = createSeaState(wind, swell, 2);
    state.manual = true;
    wind.speed = 13.3;
    for (let time = 0; time < 300; time += 0.1) updateSeaState(state, wind, swell, 0.1);
    expect(wind.speed).toBe(13.3);

    selectSeaLevel(state, 5, wind, swell);
    expect(state.manual).toBe(false);
    expect(wind.speed).toBe(SEA_LEVELS[4].steps[1].windSpeed);
  });
});
