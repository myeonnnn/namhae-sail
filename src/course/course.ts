import { latLonToWorld, type LatLon } from '../geo/projection';
import definitions from './courses.json';
import { difficultyOf, type Difficulty } from './difficulty';
import { countRisks, riskScoreOf, riskyChoices, seaScoreOf, type RiskCount } from './risk';

/** courses.json에 적는 코스 한 개 */
interface CourseDefinition {
  id: string;
  /** 코스의 위치나 조건을 고치면 올린다. 이전 판의 기록과는 비교할 수 없기 때문이다. */
  version: number;
  name: string;
  note: string;
  /** 파도의 세기 (1~5). 코스마다 고정이다. */
  seaLevel: number;
  /** 단계 안에서 고정할 환경 (0 잔잔한 쪽, 1 가운데, 2 거친 쪽). 없으면 단계 안의 환경 사이를 오간다. */
  seaStep?: number;
  /** 바람이 불어오는 방향 (북쪽을 0으로 하는 시계 방향 각도). 코스마다 고정이다. */
  windFromDeg: number;
  /** 관문의 폭 (m) */
  gateWidth: number;
  start: LatLon;
  /** 순서대로 지나야 하는 관문 */
  gates: LatLon[];
  finish: LatLon;
}

/** 통과해야 하는 선분. 어느 쪽에서 지나도 통과로 인정한다. */
export interface Gate {
  /** 관문의 가운데 (월드 좌표) */
  x: number;
  z: number;
  /** 관문의 양 끝 */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** 관문을 정면으로 지나는 방향의 방위 (rad). 아치를 세우는 방향과, 이 관문에서 다시 출발할 때의 선수 방위로 사용한다. */
  heading: number;
  /** 마지막 관문, 곧 도착선이면 true */
  finish: boolean;
}

// 등급의 규칙은 핸드폰 컨트롤러도 쓰므로, 코스 자료(courses.json)를 끌어오지 않는 작은 모듈에 둔다.
export { DIFFICULTY_LABELS, difficultyOf, type Difficulty } from './difficulty';

export interface Course {
  id: string;
  version: number;
  name: string;
  note: string;
  seaLevel: number;
  /** 도전하는 동안 고정할 환경 (0~2). 없으면 단계 안의 환경 사이를 오간다. */
  seaStep?: number;
  windFromDeg: number;
  gateWidth: number;
  /** 바다의 세기 (1~3). 파도의 단계와 환경으로 계산한다. */
  seaScore: number;
  /** 경로에서 센 위험한 코너와 옆파도 구간 */
  risks: RiskCount;
  /** 위험한 선택의 점수 (1~3) */
  riskScore: number;
  /** seaScore와 riskScore로 정한 등급 */
  difficulty: Difficulty;
  /** 출발 위치와 선수 방위 (rad). 첫 관문을 향한다. */
  start: { x: number; z: number; heading: number };
  /** 순서대로 지나야 하는 관문. 마지막이 도착선이다. */
  gates: Gate[];
  /** 출발 위치에서 도착선까지, 관문의 가운데를 이은 거리 (m) */
  length: number;
}

/** 북쪽이 -Z이므로, (dx, dz) 방향의 방위는 atan2(dx, -dz)이다. */
function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

function build(definition: CourseDefinition): Course {
  const points = [definition.start, ...definition.gates, definition.finish].map(latLonToWorld);
  const half = definition.gateWidth / 2;
  let length = 0;

  const gates: Gate[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    const next = points[i + 1];
    const inX = point.x - previous.x;
    const inZ = point.z - previous.z;
    const inLength = Math.hypot(inX, inZ);
    length += inLength;

    // 관문은 들어오는 방향과 나가는 방향의 중간을 향해서 세운다. 꺾이는 지점에서도 관문을 비스듬히 지나지 않게 된다.
    let dirX = inX / inLength;
    let dirZ = inZ / inLength;
    if (next) {
      const outLength = Math.hypot(next.x - point.x, next.z - point.z);
      dirX += (next.x - point.x) / outLength;
      dirZ += (next.z - point.z) / outLength;
      const length = Math.hypot(dirX, dirZ) || 1;
      dirX /= length;
      dirZ /= length;
    }
    // 진행 방향에 수직인 방향으로 양 끝을 놓는다.
    gates.push({
      x: point.x,
      z: point.z,
      ax: point.x - dirZ * half,
      az: point.z + dirX * half,
      bx: point.x + dirZ * half,
      bz: point.z - dirX * half,
      heading: headingOf(dirX, dirZ),
      finish: !next,
    });
  }

  const [start, first] = points;
  // 등급은 손으로 적지 않고 코스의 바다와 경로로 계산한다. 관문의 폭은 넣지 않는다.
  const seaScore = seaScoreOf(definition.seaLevel, definition.seaStep);
  const risks = countRisks(points, definition.windFromDeg);
  const riskScore = riskScoreOf(riskyChoices(risks, seaScore));
  return {
    id: definition.id,
    version: definition.version,
    name: definition.name,
    note: definition.note,
    seaLevel: definition.seaLevel,
    seaStep: definition.seaStep,
    windFromDeg: definition.windFromDeg,
    gateWidth: definition.gateWidth,
    seaScore,
    risks,
    riskScore,
    difficulty: difficultyOf(seaScore, riskScore),
    start: { x: start.x, z: start.z, heading: headingOf(first.x - start.x, first.z - start.z) },
    gates,
    length,
  };
}

/** 도전할 수 있는 코스의 목록. 위치와 조건은 courses.json에서 정한다. */
export const COURSES: Course[] = (definitions as CourseDefinition[]).map(build);
