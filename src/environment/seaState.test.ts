import { describe, expect, it } from 'vitest';
import { seededRandom } from '../core/random';
import { COURSES } from '../course/course';
import { createSeaState, fixSeaStep, releaseSeaStep, SEA_LEVELS, selectSeaLevel, updateSeaState } from './seaState';

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

/** 주어진 시간 동안 0.1초 간격으로 바다를 진행하고, 그동안 풍속과 너울이 거친 값을 모두 모은다 */
function run(
  state: ReturnType<typeof createSeaState>,
  wind: { speed: number; fromDeg: number },
  swell: { height: number; fromDeg: number },
  seconds: number,
  random: () => number,
): { winds: Set<number>; swells: Set<number> } {
  const winds = new Set<number>();
  const swells = new Set<number>();
  for (let time = 0; time < seconds; time += 0.1) {
    updateSeaState(state, wind, swell, 0.1, random);
    winds.add(wind.speed);
    swells.add(swell.height);
  }
  return { winds, swells };
}

describe('코스가 고른 환경의 고정', () => {
  // 명세: "코스는 파도의 단계와 함께 그 단계의 환경(잔잔한 쪽, 가운데, 거친 쪽) 하나를 고를 수 있다."
  it('단계 안의 환경 하나를 고르면 바람과 너울이 바로 그 환경의 값이 된다', () => {
    for (let level = 1; level <= SEA_LEVELS.length; level++) {
      for (let step = 0; step < 3; step++) {
        const wind = { speed: 0, fromDeg: 0 };
        const swell = { height: 0, fromDeg: 0 };
        const state = createSeaState(wind, swell, 3);
        fixSeaStep(state, level, step, wind, swell);
        expect(wind.speed).toBe(SEA_LEVELS[level - 1].steps[step].windSpeed);
        expect(swell.height).toBe(SEA_LEVELS[level - 1].steps[step].swellHeight);
        expect(state.level).toBe(level);
        expect(state.step).toBe(step);
        expect(state.fixed).toBe(true);
      }
    }
  });

  // 명세: "고른 코스는 도전하는 동안 그 환경의 풍속과 너울을 바꾸지 않는다."
  it('고정한 환경은 시간이 오래 지나도 풍속과 너울이 바뀌지 않는다', () => {
    // 가장자리(잔잔한 쪽, 거친 쪽)와 가운데를 모두 본다. 가장자리는 오가는 방향이 한쪽뿐이라 따로 확인한다.
    for (const step of [0, 1, 2]) {
      const wind = { speed: 0, fromDeg: 0 };
      const swell = { height: 0, fromDeg: 0 };
      const state = createSeaState(wind, swell, 4);
      fixSeaStep(state, 4, step, wind, swell);
      const expected = SEA_LEVELS[3].steps[step];
      // 고정하지 않았다면 이 난수로 단계 안을 오가는 것은 위의 "오르내린다" 테스트가 보장한다.
      const { winds, swells } = run(state, wind, swell, 900, sequence([0.9, 0.5, 0.1, 0.5]));
      expect([...winds]).toEqual([expected.windSpeed]);
      expect([...swells]).toEqual([expected.swellHeight]);
      expect(state.step).toBe(step);
      expect(state.fixed).toBe(true);
    }
  });

  it('고정한 환경은 어떤 난수에서도 바뀌지 않는다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    const state = createSeaState(wind, swell, 5);
    fixSeaStep(state, 5, 2, wind, swell);
    for (const random of [() => 0, () => 0.999999, seededRandom(7)]) {
      const { winds, swells } = run(state, wind, swell, 600, random);
      expect([...winds]).toEqual([SEA_LEVELS[4].steps[2].windSpeed]);
      expect([...swells]).toEqual([SEA_LEVELS[4].steps[2].swellHeight]);
    }
  });

  it('같은 환경을 고르면 매번 같은 바람과 너울로 시작한다', () => {
    const results = [11, 29].map((seed) => {
      const wind = { speed: 0, fromDeg: 0 };
      const swell = { height: 0, fromDeg: 0 };
      // 고르기 전의 바다가 달라도(다른 단계에서 한참 오간 뒤) 결과는 같아야 한다.
      const state = createSeaState(wind, swell, 2);
      run(state, wind, swell, 120, seededRandom(seed));
      fixSeaStep(state, 4, 0, wind, swell);
      run(state, wind, swell, 60, seededRandom(1));
      return [wind.speed, swell.height];
    });
    expect(results[0]).toEqual(results[1]);
  });

  // 명세: "도전을 그만두거나 ... 환경을 고정하지 않고 다시 단계 안에서 오간다."
  it('고정을 풀면 다시 같은 단계의 범위 안에서 풍속과 너울이 오르내린다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    const state = createSeaState(wind, swell, 3);
    fixSeaStep(state, 4, 2, wind, swell);
    releaseSeaStep(state);
    expect(state.fixed).toBe(false);
    expect(state.level).toBe(4);

    const [calm, , rough] = SEA_LEVELS[3].steps;
    const { winds } = run(state, wind, swell, 900, sequence([0.9, 0.5, 0.1, 0.5]));
    // 고정했던 거친 쪽 환경에서 벗어나 움직인다.
    expect(winds.size).toBeGreaterThan(1);
    for (const speed of winds) {
      expect(speed).toBeGreaterThanOrEqual(calm.windSpeed - 1e-9);
      expect(speed).toBeLessThanOrEqual(rough.windSpeed + 1e-9);
    }
    expect(Math.min(...winds)).toBeLessThan(rough.windSpeed - 0.5);
  });

  // 명세: "... 파도의 단계를 다시 고르면, 환경을 고정하지 않고 다시 단계 안에서 오간다."
  it('고정한 뒤에 파도의 단계를 다시 고르면 고정이 풀리고 새 단계의 가운데에서 오가기 시작한다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    const state = createSeaState(wind, swell, 3);
    fixSeaStep(state, 4, 0, wind, swell);
    selectSeaLevel(state, 2, wind, swell);
    expect(state.fixed).toBe(false);
    expect(wind.speed).toBe(SEA_LEVELS[1].steps[1].windSpeed);
    expect(swell.height).toBe(SEA_LEVELS[1].steps[1].swellHeight);

    const [calm, , rough] = SEA_LEVELS[1].steps;
    const { winds } = run(state, wind, swell, 900, sequence([0.9, 0.5, 0.1, 0.5]));
    expect(winds.size).toBeGreaterThan(1);
    for (const speed of winds) {
      expect(speed).toBeGreaterThanOrEqual(calm.windSpeed - 1e-9);
      expect(speed).toBeLessThanOrEqual(rough.windSpeed + 1e-9);
    }
  });

  it('같은 단계를 다시 골라도 고정이 풀린다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    const state = createSeaState(wind, swell, 4);
    fixSeaStep(state, 4, 2, wind, swell);
    selectSeaLevel(state, 4, wind, swell);
    expect(state.fixed).toBe(false);
    const { winds } = run(state, wind, swell, 900, sequence([0.9, 0.5, 0.1, 0.5]));
    expect(winds.size).toBeGreaterThan(1);
  });

  it('고정하지 않았을 때 고정을 풀어도 아무것도 바뀌지 않는다', () => {
    const wind = { speed: 0, fromDeg: 0 };
    const swell = { height: 0, fromDeg: 0 };
    const state = createSeaState(wind, swell, 3);
    run(state, wind, swell, 200, seededRandom(3));
    const before = { ...state };
    const windBefore = { ...wind };
    const swellBefore = { ...swell };
    releaseSeaStep(state);
    expect(state).toEqual(before);
    expect(wind).toEqual(windBefore);
    expect(swell).toEqual(swellBefore);
  });

  // 명세: "환경을 고르지 않은 코스(미륵도 앞바다 스프린트)는 지금처럼 가운데 환경에서 시작해서 단계 안의 환경 사이를 오간다."
  // 가운데에서 시작해 오가는 것은 위의 "파도의 세기" 테스트들이 보장하므로, 여기서는 이 코스가 환경을 고르지 않았음을 확인한다.
  it('미륵도 앞바다 스프린트는 환경을 고르지 않는다', () => {
    const mireuk = COURSES.find((course) => course.id === 'mireuk-sprint');
    expect(mireuk).toBeDefined();
    expect(mireuk?.seaStep).toBeUndefined();
  });
});
