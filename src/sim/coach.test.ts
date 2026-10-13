import { describe, expect, it } from 'vitest';
import { Coach, type CoachInput } from './coach';

const DT = 1 / 60;
const CALM: CoachInput = { heel: 0, seaOffBow: 0, windSpeed: 20, speed: 10, breaking: 0, capsized: false };

/** 같은 상태를 주어진 시간 동안 이어 가면서, 그동안 나온 조언을 모은다. */
function run(coach: Coach, input: Partial<CoachInput>, seconds: number): string[] {
  const tips: string[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const tip = coach.update(DT, { ...CALM, ...input });
    if (tip) tips.push(tip);
  }
  return tips;
}

describe('조종 요령의 안내', () => {
  it('파도를 앞에서 받으며 안정적으로 달리면 아무 말도 하지 않는다', () => {
    expect(run(new Coach(), {}, 120)).toEqual([]);
  });

  it('거친 바다에서 파도를 옆으로 계속 받으면 알려 준다', () => {
    const tips = run(new Coach(), { seaOffBow: 95 }, 10);
    expect(tips).toHaveLength(1);
    expect(tips[0]).toContain('옆으로');
  });

  it('선회하면서 잠깐 옆으로 받는 것과, 바람이 약한 날에는 알리지 않는다', () => {
    expect(run(new Coach(), { seaOffBow: 95 }, 1.5)).toEqual([]);
    expect(run(new Coach(), { seaOffBow: 95, windSpeed: 8 }, 30)).toEqual([]);
  });

  it('같은 조언은 두 번까지만, 간격을 두고 한다', () => {
    const coach = new Coach();
    expect(run(coach, { seaOffBow: 95 }, 10)).toHaveLength(1);
    // 바로 이어서는 다시 하지 않는다.
    expect(run(coach, { seaOffBow: 95 }, 5)).toEqual([]);
    expect(run(coach, { seaOffBow: 95 }, 30)).toHaveLength(1);
    expect(run(coach, { seaOffBow: 95 }, 120)).toEqual([]);
  });

  it('여러 조건이 겹치면 급한 것부터 알린다', () => {
    const tips = run(new Coach(), { seaOffBow: 95, heel: 0.7 }, 5);
    expect(tips[0]).toContain('횡경사');
  });

  it('뒤집히면 직전의 상태로 까닭을 한 번 설명한다', () => {
    const coach = new Coach();
    run(coach, { seaOffBow: 100, speed: 26 }, 1);
    const tips = run(coach, { capsized: true, speed: 2 }, 5);
    expect(tips).toHaveLength(1);
    expect(tips[0]).toContain('옆에서');
    expect(tips[0]).toContain('51노트');
    // 다시 일어선 뒤에 또 뒤집히면 다시 설명한다.
    run(coach, { seaOffBow: 170, speed: 30 }, 1);
    expect(run(coach, { capsized: true }, 1)[0]).toContain('뒤에서');
  });
});
