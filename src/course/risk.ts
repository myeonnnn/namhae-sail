/**
 * 코스가 전복할 위험을 얼마나 품고 있는지를 코스의 자료로 계산한다. 기준은 명세의 "난이도" 절에 있다.
 * 좌표는 미터이고 +X가 동쪽, -Z가 북쪽이다.
 */

/** 경로에서 센 위험한 선택 */
export interface RiskCount {
  /** 바람이 불어오는 쪽으로 60° 이상 꺾는 관문의 수 */
  corners: number;
  /** 파도를 옆으로 받는 300m 이상의 구간의 수 */
  beamLegs: number;
}

// 이만큼 꺾어야 선회로 생기는 기울기가 커서 위험한 코너로 본다 (도).
const SHARP_TURN_DEG = 60;
// 바람이 선수나 선미에서 이 각도 안으로 불면 옆으로 미는 힘이 작아서 코너의 위험에 보태지 않는다 (도).
const WIND_ALONG_DEG = 20;
// 파도가 진행하는 방향과 이 범위의 각을 이루면 파도를 옆으로 받는 것으로 본다 (도).
const BEAM_RANGE_DEG = [60, 120] as const;
// 이보다 짧은 구간은 금방 지나가서 옆파도를 오래 받지 않는다 (m).
const BEAM_MIN_LENGTH = 300;

/**
 * 바다의 세기 (1~3).
 * @param level 파도의 단계 (1~5)
 * @param step 고정한 환경 (0 잔잔한 쪽, 1 가운데, 2 거친 쪽). 없으면 가운데로 본다.
 */
export function seaScoreOf(level: number, step = 1): number {
  if (level <= 3) return 1;
  if (level === 4 && step < 2) return 2;
  return 3;
}

/**
 * 출발점, 관문, 도착선을 순서대로 곧게 이은 경로에서 위험한 코너와 옆파도 구간을 센다.
 * @param points 출발점, 관문의 가운데, 도착선의 순서 (월드 좌표)
 * @param windFromDeg 바람이 불어오는 방위 (북쪽을 0으로 하는 시계 방향, 도). 파도는 그 반대쪽으로 진행한다.
 */
export function countRisks(points: readonly { x: number; z: number }[], windFromDeg: number): RiskCount {
  const count: RiskCount = { corners: 0, beamLegs: 0 };
  const waveDeg = windFromDeg + 180;
  for (let i = 1; i < points.length; i++) {
    const legDeg = bearingDeg(points[i - 1], points[i]);
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const offWave = Math.abs(signedDeg(legDeg - waveDeg));
    if (length >= BEAM_MIN_LENGTH && offWave >= BEAM_RANGE_DEG[0] && offWave <= BEAM_RANGE_DEG[1]) count.beamLegs++;

    const next = points[i + 1];
    if (!next) continue;
    const turn = signedDeg(bearingDeg(points[i], next) - legDeg);
    const windOffBow = signedDeg(windFromDeg - legDeg);
    const windAbeam = Math.abs(windOffBow) > WIND_ALONG_DEG && Math.abs(windOffBow) < 180 - WIND_ALONG_DEG;
    // 바람이 불어오는 쪽으로 꺾으면 선회의 바깥쪽이 바람이 불어 가는 쪽이 되어, 두 기울기가 겹친다.
    if (Math.abs(turn) >= SHARP_TURN_DEG && windAbeam && Math.sign(turn) === Math.sign(windOffBow)) count.corners++;
  }
  return count;
}

/**
 * 등급에 넣을 위험한 선택의 개수. 코너는 언제나 세고, 옆파도 구간은 바다의 세기가 3일 때만 센다.
 * @param seaScore seaScoreOf의 결과 (1~3)
 */
export function riskyChoices(risks: RiskCount, seaScore: number): number {
  return risks.corners + (seaScore === 3 ? risks.beamLegs : 0);
}

/** 위험한 선택의 개수(riskyChoices의 결과)로 위험한 선택의 점수 (1~3)를 정한다. */
export function riskScoreOf(count: number): number {
  return count <= 1 ? 1 : count <= 3 ? 2 : 3;
}

/** a에서 b를 향하는 방위 (북쪽을 0으로 하는 시계 방향, 도) */
function bearingDeg(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
}

/** 각도를 -180° 초과 180° 이하로 옮긴다. */
function signedDeg(deg: number): number {
  return deg - 360 * Math.ceil((deg - 180) / 360);
}
