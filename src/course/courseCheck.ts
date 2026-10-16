import { latLonToWorld } from '../geo/projection';
import { layoutBridge } from '../world/bridges';
import type { ChartBridge } from '../world/chartData';
import type { Course } from './course';

/** 코스를 검사하는 데 쓰는 바다의 장애물. 모두 월드 좌표 (m)이다. */
export interface CourseWorld {
  /** 육지 다각형들. 각 다각형은 꼭짓점의 목록이다. */
  land: { x: number; z: number }[][];
  /** 게임이 다리를 따라 세우는 교각. radius는 선박이 닿으면 충돌로 보는 반지름이다. */
  piers: { x: number; z: number; radius: number }[];
  /** 등대, 등표, 부표의 위치 */
  seamarks: { x: number; z: number }[];
}

/** 코스의 경로(출발점에서 관문들을 지나 도착선까지 곧게 이은 선)가 장애물에서 떨어진 정도 */
export interface CourseClearance {
  /** 경로의 어느 한 점이라도 육지 위에 있으면 true */
  onLand: boolean;
  /** 경로에서 가장 가까운 해안선까지의 거리 (m). 육지 위를 지나면 0 */
  shore: number;
  /** 경로에서 가장 가까운 교각의 표면까지의 거리 (m). 교각 중심까지의 거리에서 반지름을 뺀 값이다. 교각이 없으면 Infinity */
  pier: number;
  /** 경로에서 가장 가까운 등대, 등표, 부표까지의 거리 (m). 없으면 Infinity */
  seamark: number;
}

/**
 * 해안선과 해도의 자료를 코스 검사용 장애물로 바꾼다.
 * @param land public/data/land.json의 geometry.coordinates (MultiPolygon, [경도, 위도]). 각 다각형의 바깥 고리만 쓴다
 * @param bridges public/data/chart.json의 bridges. 교각은 게임과 같은 규칙(layoutBridge)으로 세운다
 * @param seamarks public/data/seamarks.json의 항목들 (lat, lon만 쓴다)
 */
export function courseWorld(
  land: [number, number][][][],
  bridges: ChartBridge[],
  seamarks: { lat: number; lon: number }[],
): CourseWorld {
  const toWorld = ([lon, lat]: [number, number]) => latLonToWorld({ lat, lon });
  return {
    // 구멍(호수)은 코스와 상관이 없으므로 바깥 고리만 쓴다.
    land: land.map(([outer]) => outer.map(toWorld)),
    piers: bridges.flatMap((bridge) =>
      (layoutBridge(bridge)?.piers ?? []).map(({ station, radius }) => ({ x: station.x, z: station.z, radius })),
    ),
    seamarks: seamarks.map(({ lat, lon }) => latLonToWorld({ lat, lon })),
  };
}

/** 코스의 경로가 장애물에서 얼마나 떨어져 있는지 잰다. */
export function measureCourse(course: Course, world: CourseWorld): CourseClearance {
  const points = [course.start, ...course.gates];
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) segments.push([points[i], points[i + 1]]);

  let onLand = false;
  let shore = Infinity;
  for (const polygon of world.land) {
    const box = boundsOf(polygon);
    for (const segment of segments) {
      // 지금까지 찾은 거리보다 먼 다각형은 변을 하나하나 재지 않고 넘어간다. 해안선 자료는 꼭짓점이 수만 개이다.
      if (boxDistance(box, boundsOf(segment)) >= shore && !onLand) continue;
      if (segment.some((point) => inside(point, polygon))) onLand = true;
      for (let i = 0; i < polygon.length; i++) {
        const edge: Segment = [polygon[i], polygon[(i + 1) % polygon.length]];
        // 끝점이 모두 바다여도 선분이 해안선과 만나면 섬을 가로지르는 것이다.
        if (crosses(segment, edge)) onLand = true;
        shore = Math.min(shore, segmentDistance(segment, edge));
      }
    }
  }
  if (onLand) shore = 0;

  const nearest = (point: Point) => Math.min(...segments.map((segment) => pointSegmentDistance(point, segment)));
  return {
    onLand,
    shore,
    pier: Math.min(Infinity, ...world.piers.map((pier) => nearest(pier) - pier.radius)),
    seamark: Math.min(Infinity, ...world.seamarks.map(nearest)),
  };
}

type Point = { x: number; z: number };
type Segment = [Point, Point];
interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function boundsOf(points: Point[]): Box {
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.hypot(dx, dz);
}

/** 점이 다각형 안에 있는지 (반직선을 그어서 변과 만나는 횟수로 판정한다) */
function inside(point: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > point.z !== b.z > point.z && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) {
      result = !result;
    }
  }
  return result;
}

function pointSegmentDistance(point: Point, [a, b]: Segment): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)) : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

/** 두 선분 사이의 거리. 서로 만나면 0 */
function segmentDistance(p: Segment, q: Segment): number {
  if (crosses(p, q)) return 0;
  return Math.min(
    pointSegmentDistance(p[0], q),
    pointSegmentDistance(p[1], q),
    pointSegmentDistance(q[0], p),
    pointSegmentDistance(q[1], p),
  );
}

function crosses([a, b]: Segment, [c, d]: Segment): boolean {
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
