import { describe, expect, it } from 'vitest';
import { latLonToWorld } from '../geo/projection';
import { COURSES, DIFFICULTY_LABELS, difficultyOf } from './course';
import definitions from './courses.json';
import { countRisks, riskScoreOf, riskyChoices, seaScoreOf } from './risk';

// 명세 "난이도" 절의 값. 구현의 상수를 가져오지 않고 여기에 따로 적는다.
/** 바다의 세기와 위험한 선택이 가질 수 있는 값: 1(낮음), 2(중간), 3(높음) */
const LEVELS = [1, 2, 3];

/**
 * 기존 코스 "미륵도 앞바다 스프린트"의 위치와 조건. 이 코스를 추가하던 때(난이도를 넣기 전)의 courses.json에서 옮겨 적었다.
 * 명세: "이 코스의 위치와 조건은 바꾸지 않아서, 저장된 기록이 그대로 유효하다."
 */
const MIREUK = {
  id: 'mireuk-sprint',
  version: 1,
  name: '미륵도 앞바다 스프린트',
  seaLevel: 4,
  windFromDeg: 225,
  gateWidth: 90,
  start: { lat: 34.714, lon: 128.364 },
  gates: [
    { lat: 34.71284, lon: 128.36697 },
    { lat: 34.7138, lon: 128.37039 },
    { lat: 34.71193, lon: 128.37321 },
    { lat: 34.71289, lon: 128.37664 },
    { lat: 34.71102, lon: 128.37945 },
  ],
  finish: { lat: 34.71128, lon: 128.38273 },
};

describe('코스의 등급', () => {
  it('바다의 세기와 위험한 선택의 합이 3 이하이면 쉬움, 4이면 보통, 5 이상이면 어려움이다', () => {
    // 1~3의 모든 조합 아홉 가지를 합으로 직접 판정해서 비교한다.
    for (const seaScore of LEVELS) {
      for (const riskScore of LEVELS) {
        const sum = seaScore + riskScore;
        const expected = sum <= 3 ? 'easy' : sum === 4 ? 'normal' : 'hard';
        expect(difficultyOf(seaScore, riskScore), `바다 ${seaScore}, 위험 ${riskScore}`).toBe(expected);
      }
    }
  });

  it('경계의 합 3과 4, 4와 5에서 등급이 바뀐다', () => {
    expect(difficultyOf(1, 2)).toBe('easy');
    expect(difficultyOf(2, 1)).toBe('easy');
    expect(difficultyOf(2, 2)).toBe('normal');
    expect(difficultyOf(1, 3)).toBe('normal');
    expect(difficultyOf(3, 1)).toBe('normal');
    expect(difficultyOf(2, 3)).toBe('hard');
    expect(difficultyOf(3, 2)).toBe('hard');
  });

  it('가장 낮은 조합(1, 1)은 쉬움이고, 가장 높은 조합(3, 3)은 어려움이다', () => {
    expect(difficultyOf(1, 1)).toBe('easy');
    expect(difficultyOf(3, 3)).toBe('hard');
  });

  it('등급의 이름은 쉬움, 보통, 어려움이다', () => {
    expect(DIFFICULTY_LABELS).toEqual({ easy: '쉬움', normal: '보통', hard: '어려움' });
  });
});

describe('코스 목록의 난이도 자료', () => {
  it('모든 코스의 바다의 세기와 위험한 선택은 1, 2, 3 중 하나이다', () => {
    for (const course of COURSES) {
      expect(LEVELS, `${course.id} 바다의 세기`).toContain(course.seaScore);
      expect(LEVELS, `${course.id} 위험한 선택`).toContain(course.riskScore);
    }
  });

  it('바다의 세기는 코스의 파도의 단계와 환경으로 계산한다', () => {
    for (const course of COURSES) {
      expect(course.seaScore, course.id).toBe(seaScoreOf(course.seaLevel, course.seaStep));
    }
  });

  it('위험한 코너와 옆파도 구간은 출발점, 관문, 도착선을 이은 경로와 코스의 풍향으로 센다', () => {
    for (const course of COURSES) {
      // 관문의 가운데만 넘긴다. 관문의 폭과 방향은 난이도에 넣지 않는다.
      const points = [course.start, ...course.gates].map(({ x, z }) => ({ x, z }));
      expect(course.risks, course.id).toEqual(countRisks(points, course.windFromDeg));
    }
  });

  it('위험한 선택의 점수는 코너를 언제나 세고, 옆파도 구간은 바다의 세기가 3일 때만 세어서 정한다', () => {
    for (const course of COURSES) {
      // riskyChoices를 쓰지 않고 명세의 문장대로 직접 센다.
      const count = course.risks.corners + (course.seaScore === 3 ? course.risks.beamLegs : 0);
      expect(course.riskScore, course.id).toBe(riskScoreOf(count));
      expect(course.riskScore, course.id).toBe(riskScoreOf(riskyChoices(course.risks, course.seaScore)));
    }
  });

  it('등급은 계산한 바다의 세기와 위험한 선택으로 정한다', () => {
    for (const course of COURSES) {
      expect(course.difficulty, course.id).toBe(difficultyOf(course.seaScore, course.riskScore));
    }
  });

  it('난이도를 손으로 적지 않는다: 코스 자료에 정밀함, 바다의 거칠기, 점수, 등급을 적지 않는다', () => {
    const handWritten = ['precision', 'sea', 'seaScore', 'risks', 'riskScore', 'difficulty'];
    for (const definition of definitions as Record<string, unknown>[]) {
      for (const key of handWritten) {
        expect(definition, `${String(definition.id)}의 ${key}`).not.toHaveProperty(key);
      }
    }
  });

  it('관문의 폭으로 매기던 정밀함과 바다의 거칠기는 코스에 남아 있지 않다', () => {
    for (const course of COURSES) {
      expect(course, course.id).not.toHaveProperty('precision');
      expect(course, course.id).not.toHaveProperty('sea');
    }
  });

  it('코스의 id는 서로 겹치지 않는다', () => {
    // 기록은 코스의 id로 저장하므로, 겹치면 다른 코스의 기록과 섞인다.
    const ids = COURSES.map((course) => course.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('쉬움의 기준인 미륵도 앞바다 스프린트', () => {
  const course = COURSES.find((c) => c.id === MIREUK.id);

  it('쉬움이다', () => {
    expect(course).toBeDefined();
    expect(course!.difficulty).toBe('easy');
  });

  it('환경을 고정하지 않은 4단계 코스이므로 가운데 환경으로 보아 바다의 세기가 2이다', () => {
    expect(course!.seaStep).toBeUndefined();
    expect(course!.seaScore).toBe(2);
  });

  it('바다의 세기가 2이면서 쉬움이려면 위험한 선택이 1이다', () => {
    // 합이 3 이하여야 쉬움이므로, 바다의 세기 2에서 위험한 선택은 1뿐이다 (위험한 선택 0~1개).
    // 바다의 세기가 2이므로 옆파도 구간은 세지 않고 위험한 코너만 센다.
    expect(course!.riskScore).toBe(1);
    expect(course!.risks.corners).toBeLessThanOrEqual(1);
  });

  it('판과 조건이 그대로여서 저장된 기록이 유효하다', () => {
    expect(course).toMatchObject({
      version: MIREUK.version,
      name: MIREUK.name,
      seaLevel: MIREUK.seaLevel,
      windFromDeg: MIREUK.windFromDeg,
      gateWidth: MIREUK.gateWidth,
    });
  });

  it('출발점과 관문과 도착선의 위치가 그대로이다', () => {
    const start = latLonToWorld(MIREUK.start);
    const points = [...MIREUK.gates, MIREUK.finish].map(latLonToWorld);
    expect(course!.start.x).toBeCloseTo(start.x, 6);
    expect(course!.start.z).toBeCloseTo(start.z, 6);
    expect(course!.gates).toHaveLength(points.length);
    points.forEach((point, i) => {
      expect(course!.gates[i].x, `관문 ${i}`).toBeCloseTo(point.x, 6);
      expect(course!.gates[i].z, `관문 ${i}`).toBeCloseTo(point.z, 6);
    });
  });
});
