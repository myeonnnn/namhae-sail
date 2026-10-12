/** 바람의 상태. 화면의 조절 막대가 이 객체의 값을 직접 변경한다. */
export interface Wind {
  /** 풍속 (m/s) */
  speed: number;
  /** 바람이 불어오는 방향. 북쪽을 0으로 하는 시계 방향 각도이며, 기상 예보의 풍향과 동일한 기준이다. */
  fromDeg: number;
}

export const MAX_WIND_SPEED = 20;

/**
 * 기본값은 15m급 요트가 운항하기에 적당한 날씨이다.
 * 초속 6m는 흰 물거품이 드문드문 보이기 시작하는 바람이며, 유의파고는 약 0.5m이다.
 */
export function createWind(): Wind {
  return { speed: 6, fromDeg: 225 };
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
