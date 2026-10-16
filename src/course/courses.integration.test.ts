import { describe, expect, it } from 'vitest';
import { latLonToWorld } from '../geo/projection';
import { layoutBridge } from '../world/bridges';
import type { ChartData } from '../world/chartData';
import { COURSES, difficultyOf, type Course, type Difficulty } from './course';
import { courseWorld, measureCourse, type CourseWorld } from './courseCheck';
// 자료는 게임이 내려받는 파일 그대로를 문자열로 읽는다. 큰 JSON을 타입으로 추론하지 않도록 ?raw를 쓴다.
import chartText from '../../public/data/chart.json?raw';
import landText from '../../public/data/land.json?raw';
import seamarksText from '../../public/data/seamarks.json?raw';

// 해안선과 해도 자료를 실제로 읽어서, 코스 자료(courses.json) → 장애물 변환 → 거리 측정을 엮어 확인한다.

/**
 * 명세 "코스" 절의 표: 등급마다 경로가 떨어져 있어야 하는 거리 (m).
 * 구현의 상수를 가져오지 않고 여기에 따로 적는다.
 */
const MIN_CLEARANCE: Record<Difficulty, { shore: number; pier: number; seamark: number }> = {
  easy: { shore: 100, pier: 100, seamark: 30 },
  normal: { shore: 50, pier: 20, seamark: 30 },
  hard: { shore: 15, pier: 20, seamark: 30 },
};

const land = (JSON.parse(landText) as { geometry: { coordinates: [number, number][][][] } }).geometry.coordinates;
const chart = JSON.parse(chartText) as ChartData;
const seamarks = JSON.parse(seamarksText) as { lat: number; lon: number }[];

// 장애물은 한 번만 만든다. 만드는 데 실패하면 각 테스트가 그 오류로 실패하도록, 모듈을 불러올 때가 아니라 처음 쓸 때 만든다.
let cached: CourseWorld | undefined;
function world(): CourseWorld {
  cached ??= courseWorld(land, chart.bridges, seamarks);
  return cached;
}

/** 월드 좌표의 점들로 검사용 코스를 만든다. 경로를 재는 데는 관문의 가운데만 쓰인다. */
function courseThrough(points: { x: number; z: number }[]): Course {
  const [start, ...rest] = points;
  return {
    id: 'check',
    version: 1,
    name: '검사용',
    note: '',
    seaLevel: 1,
    windFromDeg: 0,
    gateWidth: 40,
    precision: 1,
    sea: 1,
    start: { x: start.x, z: start.z, heading: 0 },
    gates: rest.map((p, i) => ({
      ...p,
      ax: p.x,
      az: p.z,
      bx: p.x,
      bz: p.z,
      heading: 0,
      finish: i === rest.length - 1,
    })),
    length: 0,
  };
}

describe('실제 자료로 만든 장애물이 믿을 만하다', () => {
  // 아래 코스 검사가 "장애물을 못 봐서 통과"하지 않도록, 장애물이 있는 곳을 지나는 경로로 먼저 확인한다.

  it('바다에서 미륵도 안쪽으로 들어가는 경로는 육지 위로 본다', () => {
    // 출발점은 미륵도 앞바다 스프린트의 출발점(바다), 끝점 북위 34.80°, 동경 128.42°는 미륵도의 안쪽이다.
    const clearance = measureCourse(
      courseThrough([latLonToWorld({ lat: 34.714, lon: 128.364 }), latLonToWorld({ lat: 34.8, lon: 128.42 })]),
      world(),
    );
    expect(clearance.onLand).toBe(true);
    expect(clearance.shore).toBe(0);
  });

  it('게임이 세운 사량대교의 교각을 가로지르는 경로는 교각에 닿는다', () => {
    const bridge = chart.bridges.find((b) => b.name === '사량대교')!;
    const pier = layoutBridge(bridge)!.piers[0].station;
    // 교각의 중심을 남북으로 지나는 400m의 경로. 중심까지 0m이므로 표면까지의 거리는 0 이하이다.
    const clearance = measureCourse(
      courseThrough([
        { x: pier.x, z: pier.z + 200 },
        { x: pier.x, z: pier.z - 200 },
      ]),
      world(),
    );
    expect(clearance.pier).toBeLessThanOrEqual(0);
  });

  it('등대 위를 지나는 경로는 등대까지 0m이다', () => {
    const mark = latLonToWorld(seamarks[0]);
    const clearance = measureCourse(
      courseThrough([
        { x: mark.x - 200, z: mark.z },
        { x: mark.x + 200, z: mark.z },
      ]),
      world(),
    );
    // 등대의 위치를 정확히 지나므로 0이다. 부동소수점의 오차만 허용한다.
    expect(clearance.seamark).toBeLessThan(1e-6);
  });
});

describe('모든 타임어택 코스는 등급의 기준만큼 장애물에서 떨어져 있다', () => {
  it('코스가 하나 이상 있다', () => {
    expect(COURSES.length).toBeGreaterThan(0);
  });

  for (const course of COURSES) {
    describe(`${course.name} (${course.id})`, () => {
      it('출발점과 관문과 도착선, 그 사이의 곧은 경로가 모두 바다 위에 있다', () => {
        expect(measureCourse(course, world()).onLand).toBe(false);
      });

      it('해안선에서 등급이 정한 거리 이상 떨어져 있다', () => {
        const { shore } = MIN_CLEARANCE[difficultyOf(course.precision, course.sea)];
        expect(measureCourse(course, world()).shore).toBeGreaterThanOrEqual(shore);
      });

      it('게임이 세우는 교각에서 등급이 정한 거리 이상 떨어져 있다', () => {
        const { pier } = MIN_CLEARANCE[difficultyOf(course.precision, course.sea)];
        expect(measureCourse(course, world()).pier).toBeGreaterThanOrEqual(pier);
      });

      it('등대와 부표에서 30m 이상 떨어져 있다', () => {
        const { seamark } = MIN_CLEARANCE[difficultyOf(course.precision, course.sea)];
        expect(measureCourse(course, world()).seamark).toBeGreaterThanOrEqual(seamark);
      });
    });
  }
});
