import { describe, expect, it } from 'vitest';
import { latLonToWorld } from '../geo/projection';
import type { ChartBridge } from '../world/chartData';
import { layoutBridge } from '../world/bridges';
import type { Course } from './course';
import { courseWorld, measureCourse, type CourseWorld } from './courseCheck';

type Point = { x: number; z: number };

/**
 * 월드 좌표의 점들로 코스를 만든다. 첫 점이 출발점, 마지막 점이 도착선이다.
 * 경로를 재는 데는 관문의 가운데만 쓰이므로, 관문의 폭과 방향은 의미 없는 값으로 둔다.
 */
function courseThrough(points: Point[]): Course {
  const [start, ...rest] = points;
  return {
    id: 'check',
    version: 1,
    name: '검사용',
    note: '',
    seaLevel: 1,
    windFromDeg: 0,
    gateWidth: 40,
    // 경로를 재거나 경주를 진행하는 데는 난이도가 쓰이지 않으므로 가장 낮은 값으로 둔다.
    seaScore: 1,
    risks: { corners: 0, beamLegs: 0 },
    riskScore: 1,
    difficulty: 'easy',
    start: { x: start.x, z: start.z, heading: 0 },
    gates: rest.map((p, i) => ({
      x: p.x,
      z: p.z,
      ax: p.x - 20,
      az: p.z,
      bx: p.x + 20,
      bz: p.z,
      heading: 0,
      finish: i === rest.length - 1,
    })),
    length: 0,
  };
}

/**
 * 손으로 거리를 셀 수 있는 작은 세계.
 * - 섬: x 400~600, z 100~300의 사각형 (마지막 꼭짓점에서 첫 꼭짓점으로 닫는 변은 가장 가까운 변이 아니게 놓았다)
 * - 교각: (500, -50), 반지름 5
 * - 부표: 두 번째 구간의 가운데에서 오른쪽으로 30m
 */
const ISLAND: Point[] = [
  { x: 400, z: 300 },
  { x: 400, z: 100 },
  { x: 600, z: 100 },
  { x: 600, z: 300 },
];

/**
 * 경로: (0, 0) → (1000, 0) → (1600, -800).
 * 두 번째 구간은 길이 1000m이고 방향은 (0.6, -0.8)이다. 그 법선 (0.8, 0.6)으로 30m 떨어진 가운데 옆의 점이
 * (1000 + 0.6·500 + 0.8·30, 0 − 0.8·500 + 0.6·30) = (1324, −382)이다.
 */
const PATH: Point[] = [
  { x: 0, z: 0 },
  { x: 1000, z: 0 },
  { x: 1600, z: -800 },
];

const WORLD: CourseWorld = {
  land: [ISLAND],
  piers: [{ x: 500, z: -50, radius: 5 }],
  seamarks: [{ x: 1324, z: -382 }],
};

describe('코스 경로가 장애물에서 떨어진 거리', () => {
  it('해안까지는 경로에서 가장 가까운 해안선의 변까지 잰다', () => {
    // 첫 구간(z = 0)과 섬의 아래 변(z = 100) 사이가 100m이다. 두 번째 구간에서 섬의 꼭짓점 (600, 100)까지는
    // (1000, 0)에서 √(400² + 100²) ≈ 412m이므로 더 멀다.
    const clearance = measureCourse(courseThrough(PATH), WORLD);
    expect(clearance.onLand).toBe(false);
    expect(clearance.shore).toBeCloseTo(100, 6);
  });

  it('교각까지는 중심까지의 거리에서 반지름을 뺀 표면까지의 거리이다', () => {
    // 교각의 중심 (500, −50)에서 첫 구간까지 50m, 반지름 5m를 빼면 45m
    expect(measureCourse(courseThrough(PATH), WORLD).pier).toBeCloseTo(45, 6);
  });

  it('비스듬한 구간에서도 등대와 부표까지의 수직 거리를 잰다', () => {
    expect(measureCourse(courseThrough(PATH), WORLD).seamark).toBeCloseTo(30, 6);
  });

  it('구간의 연장선 위에 있는 장애물은 연장선이 아니라 구간의 끝점까지 잰다', () => {
    // 출발점 (0, 0)의 뒤쪽 40m에 있는 부표. 첫 구간의 직선 위에 있지만 구간 밖이므로 거리는 40m이다.
    const world: CourseWorld = { land: [], piers: [{ x: 2200, z: -1600, radius: 10 }], seamarks: [{ x: -40, z: 0 }] };
    const clearance = measureCourse(courseThrough(PATH), world);
    expect(clearance.seamark).toBeCloseTo(40, 6);
    // 도착점 (1600, −800)에서 방향 (0.6, −0.8)으로 1000m 더 간 곳의 교각: 중심까지 1000m, 표면까지 990m
    expect(clearance.pier).toBeCloseTo(990, 6);
  });

  it('여러 장애물 가운데 가장 가까운 것을 고른다', () => {
    const world: CourseWorld = {
      land: [ISLAND],
      piers: [
        { x: 500, z: -300, radius: 5 },
        { x: 500, z: -50, radius: 5 },
      ],
      seamarks: [
        { x: 200, z: -500 },
        { x: 1324, z: -382 },
        { x: 0, z: 70 },
      ],
    };
    const clearance = measureCourse(courseThrough(PATH), world);
    expect(clearance.pier).toBeCloseTo(45, 6);
    expect(clearance.seamark).toBeCloseTo(30, 6);
  });

  it('관문이 모두 바다에 있어도 그 사이의 곧은 경로가 섬을 가로지르면 육지 위로 본다', () => {
    // z = 200의 직선은 섬(z 100~300)의 한가운데를 지난다. 출발점과 도착점은 섬 밖이다.
    const clearance = measureCourse(
      courseThrough([
        { x: 0, z: 200 },
        { x: 1000, z: 200 },
      ]),
      WORLD,
    );
    expect(clearance.onLand).toBe(true);
    expect(clearance.shore).toBe(0);
  });

  it('출발점이 섬 안에 있으면 육지 위로 본다', () => {
    const clearance = measureCourse(
      courseThrough([
        { x: 500, z: 200 },
        { x: 500, z: 1000 },
      ]),
      WORLD,
    );
    expect(clearance.onLand).toBe(true);
    expect(clearance.shore).toBe(0);
  });

  it('관문 하나가 섬 안에 있으면 육지 위로 본다', () => {
    // 섬 안의 관문 (500, 200)으로 들어갔다가 나온다. 두 구간 모두 섬의 변을 지나지만, 관문 자체가 육지 위에 있다.
    const clearance = measureCourse(
      courseThrough([
        { x: 0, z: 200 },
        { x: 500, z: 200 },
        { x: 0, z: 250 },
      ]),
      WORLD,
    );
    expect(clearance.onLand).toBe(true);
  });

  it('섬에 1m만 못 미쳐 지나가면 육지 위가 아니고, 해안까지 1m이다', () => {
    // 섬의 아래 변 z = 100 바로 앞의 z = 99를 지난다. 육지에 닿지 않은 경계의 경우이다.
    const clearance = measureCourse(
      courseThrough([
        { x: 0, z: 99 },
        { x: 1000, z: 99 },
      ]),
      WORLD,
    );
    expect(clearance.onLand).toBe(false);
    expect(clearance.shore).toBeCloseTo(1, 6);
  });

  it('교각과 등대, 부표가 없으면 그 거리는 무한대이다', () => {
    const clearance = measureCourse(courseThrough(PATH), { land: [ISLAND], piers: [], seamarks: [] });
    expect(clearance.pier).toBe(Infinity);
    expect(clearance.seamark).toBe(Infinity);
  });
});

/** 꼭짓점 목록에서 첫 점과 같은 마지막 점(닫는 점)을 뺀다. GeoJSON의 고리는 닫혀 있지만, 다각형을 닫힌 채로 둘지는 정하지 않았다. */
function openRing(points: Point[]): Point[] {
  const first = points[0];
  const last = points.at(-1)!;
  return points.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.z - last.z) < 1e-6
    ? points.slice(0, -1)
    : points;
}

function expectSamePoints(actual: Point[], expected: Point[], label: string): void {
  expect(actual, label).toHaveLength(expected.length);
  expected.forEach((point, i) => {
    expect(actual[i].x, `${label} ${i}`).toBeCloseTo(point.x, 6);
    expect(actual[i].z, `${label} ${i}`).toBeCloseTo(point.z, 6);
  });
}

describe('해안선과 해도 자료를 장애물로 바꾸기', () => {
  // 미륵도 남쪽 바다의 경위도. 값 자체는 의미가 없고, 월드 좌표로 바뀌는지만 본다.
  const outer: [number, number][] = [
    [128.36, 34.7],
    [128.37, 34.7],
    [128.37, 34.71],
    [128.36, 34.71],
    [128.36, 34.7],
  ];
  const hole: [number, number][] = [
    [128.364, 34.704],
    [128.366, 34.704],
    [128.366, 34.706],
    [128.364, 34.704],
  ];
  const second: [number, number][] = [
    [128.4, 34.72],
    [128.41, 34.72],
    [128.405, 34.73],
    [128.4, 34.72],
  ];

  it('육지 다각형은 바깥 고리의 꼭짓점을 월드 좌표로 바꾼 것이고, 안쪽 고리(구멍)는 쓰지 않는다', () => {
    const world = courseWorld([[outer, hole], [second]], [], []);
    expect(world.land).toHaveLength(2);
    const toWorld = (ring: [number, number][]) => openRing(ring.map(([lon, lat]) => latLonToWorld({ lat, lon })));
    expectSamePoints(openRing(world.land[0]), toWorld(outer), '첫 섬');
    expectSamePoints(openRing(world.land[1]), toWorld(second), '둘째 섬');
  });

  it('교각은 게임이 다리를 세우는 규칙(layoutBridge)과 같은 위치와 반지름이다', () => {
    // 동서로 약 900m 걸친 사장교. 사장교는 주탑의 반지름이 더 크므로, 주탑과 일반 교각이 함께 나온다.
    const bridge: ChartBridge = {
      name: '시험대교',
      structure: 'cable-stayed',
      width: 10,
      clearance: 40,
      length: 900,
      points: [
        [128.36, 34.72],
        [128.37, 34.72],
      ],
    };
    const expected = layoutBridge(bridge)!.piers.map(({ station, radius }) => ({
      x: station.x,
      z: station.z,
      radius,
    }));
    expect(expected.length).toBeGreaterThan(0);
    const world = courseWorld([], [bridge], []);
    expect(world.piers).toHaveLength(expected.length);
    expected.forEach((pier, i) => {
      expect(world.piers[i].x, `교각 ${i}`).toBeCloseTo(pier.x, 6);
      expect(world.piers[i].z, `교각 ${i}`).toBeCloseTo(pier.z, 6);
      expect(world.piers[i].radius, `교각 ${i}`).toBeCloseTo(pier.radius, 6);
    });
  });

  it('점이 하나뿐인 다리는 교각을 세우지 않는다', () => {
    const bridge: ChartBridge = { width: 8, clearance: 20, length: 0, points: [[128.36, 34.72]] };
    expect(courseWorld([], [bridge], []).piers).toEqual([]);
  });

  it('등대, 등표, 부표는 경위도를 월드 좌표로 바꾼 위치이다', () => {
    const marks = [
      { lat: 34.714, lon: 128.364 },
      { lat: 34.8, lon: 128.42 },
    ];
    const world = courseWorld([], [], marks);
    expectSamePoints(world.seamarks, marks.map(latLonToWorld), '부표');
  });
});
