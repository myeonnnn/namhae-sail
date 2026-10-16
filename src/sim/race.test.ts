import { describe, expect, it } from 'vitest';
import { COURSES, type Course, type Difficulty } from '../course/course';
import { Race, segmentsCross } from './race';

const DT = 1 / 60;
// 요구사항의 값. 구현의 상수를 가져오면 상수가 틀려도 테스트가 통과하므로 여기에 따로 적는다.
/** 출발 전 카운트다운 (초) */
const COUNTDOWN = 3;
/** 전복 한 번의 벌점 (초) */
const PENALTY_PER_CAPSIZE = 10;

// 북쪽(-Z)으로 곧게 놓인 연습용 코스: 100m마다 폭 40m의 관문이 두 개 있고, 두 번째가 도착선이다.
const gateAt = (z: number, finish: boolean) => ({ x: 0, z, ax: -20, az: z, bx: 20, bz: z, heading: 0, finish });
const COURSE: Course = {
  id: 'test',
  version: 1,
  name: '연습',
  note: '',
  seaLevel: 1,
  windFromDeg: 0,
  gateWidth: 40,
  // 경로를 재거나 경주를 진행하는 데는 난이도가 쓰이지 않으므로 가장 낮은 값으로 둔다.
  seaScore: 1,
  risks: { corners: 0, beamLegs: 0 },
  riskScore: 1,
  difficulty: 'easy',
  start: { x: 0, z: 0, heading: 0 },
  gates: [gateAt(-100, false), gateAt(-200, true)],
  length: 200,
};

/** 카운트다운을 끝내고 출발한 상태의 경주 */
function started(): Race {
  const race = new Race(COURSE);
  race.begin();
  for (let t = 0; t < COUNTDOWN + 0.1; t += DT) race.step(DT, COURSE.start, COURSE.start);
  return race;
}

describe('선분의 교차', () => {
  it('엇갈려 지나면 만나고, 나란하거나 닿지 않으면 만나지 않는다', () => {
    expect(segmentsCross(0, 10, 0, -10, -5, 0, 5, 0)).toBe(true);
    expect(segmentsCross(0, -10, 0, 10, -5, 0, 5, 0)).toBe(true);
    expect(segmentsCross(10, 10, 10, -10, -5, 0, 5, 0)).toBe(false);
    expect(segmentsCross(0, 10, 0, 1, -5, 0, 5, 0)).toBe(false);
  });
});

describe('타임어택의 진행', () => {
  it('카운트다운이 끝나야 시간이 흐르기 시작한다', () => {
    const race = new Race(COURSE);
    race.begin();
    const events = [];
    for (let t = 0; t < COUNTDOWN - 0.5; t += DT) events.push(...race.step(DT, COURSE.start, COURSE.start));
    expect(race.phase).toBe('countdown');
    expect(race.time).toBe(0);
    expect(events.map((e) => (e.type === 'count' ? e.remaining : e.type))).toEqual([2, 1]);

    for (let t = 0; t < 1; t += DT) events.push(...race.step(DT, COURSE.start, COURSE.start));
    expect(race.phase).toBe('running');
    expect(events.at(-1)).toEqual({ type: 'go' });
    expect(race.time).toBeGreaterThan(0);
  });

  it('관문을 순서대로 지나면 완주한다', () => {
    const race = started();
    expect(race.step(DT, { x: 3, z: -99 }, { x: 3, z: -101 }).map((e) => e.type)).toEqual(['gate']);
    expect(race.nextGate).toBe(1);
    expect(race.step(DT, { x: -8, z: -199 }, { x: -8, z: -201 }).map((e) => e.type)).toEqual(['gate', 'finish']);
    expect(race.phase).toBe('finished');
    expect(race.splits).toHaveLength(2);
  });

  it('반대쪽에서 지나도 통과로 인정한다', () => {
    const race = started();
    expect(race.step(DT, { x: 0, z: -101 }, { x: 0, z: -99 })).toHaveLength(1);
    expect(race.nextGate).toBe(1);
  });

  it('순서가 아닌 관문과, 관문의 바깥을 지난 것은 인정하지 않는다', () => {
    const race = started();
    expect(race.step(DT, { x: 0, z: -199 }, { x: 0, z: -201 })).toEqual([]);
    expect(race.step(DT, { x: 30, z: -99 }, { x: 30, z: -101 })).toEqual([]);
    expect(race.nextGate).toBe(0);
  });

  it('빠르게 달려서 한 스텝에 관문을 건너뛰어도 통과로 인정한다', () => {
    const race = started();
    expect(race.step(DT, { x: 0, z: -60 }, { x: 0, z: -140 })).toHaveLength(1);
  });

  it('전복될 때마다 벌점이 더해지고, 마지막으로 지난 관문에서 다시 출발한다', () => {
    const race = started();
    expect(race.respawn).toEqual(COURSE.start);
    race.capsize();
    race.step(DT, { x: 0, z: -99 }, { x: 0, z: -101 });
    race.capsize();
    expect(race.capsizes).toBe(2);
    expect(race.total).toBeCloseTo(race.time + 2 * PENALTY_PER_CAPSIZE, 6);
    expect(race.respawn).toMatchObject({ x: 0, z: -100 });
    // 다음 관문이 정북에 있으므로 북쪽을 보고 놓인다.
    expect(race.respawn.heading).toBeCloseTo(0, 6);
  });

  it('완주한 뒤에는 시간이 흐르지 않는다', () => {
    const race = started();
    race.step(DT, { x: 0, z: -99 }, { x: 0, z: -101 });
    race.step(DT, { x: 0, z: -199 }, { x: 0, z: -201 });
    const total = race.total;
    for (let i = 0; i < 100; i++) race.step(DT, { x: 0, z: -300 }, { x: 0, z: -301 });
    race.capsize();
    expect(race.total).toBe(total);
  });
});

describe('코스의 자료', () => {
  it('관문의 폭과 방향이 자료와 맞고, 출발 위치는 첫 관문을 향한다', () => {
    for (const course of COURSES) {
      expect(course.gates.at(-1)!.finish).toBe(true);
      for (const gate of course.gates) {
        expect(Math.hypot(gate.bx - gate.ax, gate.bz - gate.az)).toBeCloseTo(course.gateWidth, 6);
        // 관문의 선은 지나는 방향과 직각이다.
        const along = [Math.sin(gate.heading), -Math.cos(gate.heading)];
        expect(along[0] * (gate.bx - gate.ax) + along[1] * (gate.bz - gate.az)).toBeCloseTo(0, 6);
      }
      const first = course.gates[0];
      const toFirst = Math.atan2(first.x - course.start.x, -(first.z - course.start.z));
      expect(course.start.heading).toBeCloseTo(toFirst, 6);
    }
  });

  it('모든 코스는 등급이 정한 속력으로 달려도 165초 안에 도착하는 길이이다', () => {
    // 명세: 쉬움과 보통은 초속 15m(약 29노트), 어려움은 초속 12m로 달려도 165초 안에 도착한다.
    // 3분에서 선회와 출발과 맞바람을 위한 여유를 남긴 값이다.
    const SPEED: Record<Difficulty, number> = { easy: 15, normal: 15, hard: 12 };
    expect(COURSES.length).toBeGreaterThan(0);
    for (const course of COURSES) {
      const speed = SPEED[course.difficulty];
      expect(course.length / speed, course.id).toBeLessThanOrEqual(165);
    }
  });
});
