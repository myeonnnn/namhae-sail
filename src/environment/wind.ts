/** 바람의 상태. 화면의 조절 막대가 이 객체의 값을 직접 변경한다. */
export interface Wind {
  /** 풍속 (m/s) */
  speed: number;
  /** 바람이 불어오는 방향. 북쪽을 0으로 하는 시계 방향 각도이며, 기상 예보의 풍향과 동일한 기준이다. */
  fromDeg: number;
}

// 초속 35m는 강한 태풍에 해당한다. 실제로는 소형 선박이 나갈 수 없는 날씨이지만, 게임에서 가장 거친 바다의 기준으로 삼는다.
export const MAX_WIND_SPEED = 35;

// 풍향을 조절하는 막대의 간격 (도)
export const WIND_DIRECTION_STEP = 5;

/**
 * 풍향은 접속할 때마다 무작위로 정한다. 같은 항로도 바람에 따라 파도를 받는 방향과 섬에 가려지는 구간이 달라진다.
 * 풍속은 파도의 세기를 고르면 정해진다 (seaState.ts).
 */
export function createWind(): Wind {
  const steps = 360 / WIND_DIRECTION_STEP;
  return { speed: 0, fromDeg: Math.floor(Math.random() * steps) * WIND_DIRECTION_STEP };
}

/** 바람이 공기를 이동시키는 속도를 월드 좌표로 반환한다. 풍향은 불어오는 쪽이므로 반대 방향을 향한다. */
export function windVelocity(wind: Wind): { x: number; z: number } {
  const toward = ((wind.fromDeg + 180) * Math.PI) / 180;
  return { x: Math.sin(toward) * wind.speed, z: -Math.cos(toward) * wind.speed };
}

const COMPASS_NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

export function compassName(deg: number): string {
  return COMPASS_NAMES[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
