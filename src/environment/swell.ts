/**
 * 너울: 먼바다의 바람이 만든 파도가 이 구역까지 건너온 것.
 * 지금 부는 바람과 무관해서, 바람이 없는 날에도 밀려오고 바람과 다른 방향에서 오기도 한다.
 * 화면의 조절 막대가 이 객체의 값을 직접 변경한다.
 */
export interface Swell {
  /** 너울의 유의파고 (m). 섬에 가려지지 않은 열린 바다에서의 값이다. */
  height: number;
  /** 너울이 오는 방향. 북쪽을 0으로 하는 시계 방향 각도 */
  fromDeg: number;
}

export const MAX_SWELL_HEIGHT = 4;

/** 한려수도의 남동쪽은 대한해협으로 열려 있어서, 너울은 주로 그쪽에서 들어온다. 높이는 파도의 세기를 고르면 정해진다 (seaState.ts). */
export function createSwell(): Swell {
  return { height: 0, fromDeg: 150 };
}
