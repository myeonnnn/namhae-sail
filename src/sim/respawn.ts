import type { Wind } from '../environment/wind';

/** 이보다 약한 바람(m/s)에서는 풍랑이 거의 없어서, 방향을 바꿀 까닭이 없다. */
const CALM_WIND = 0.1;
const TURN = Math.PI * 2;

/**
 * 자유 항해 중 전복된 배를 그 자리에서 다시 세울 때의 선수 방위를 정한다.
 * 풍랑이 오는 쪽, 즉 바람이 불어오는 쪽(wind.fromDeg)을 선수로 향한다.
 * 바람이 거의 없으면(풍속 0.1 m/s 미만) 지금의 방위를 그대로 둔다.
 * @param heading 뒤집혔을 때의 선수 방위 (rad, 북쪽 0, 시계 방향)
 * @returns 선수 방위 (rad, 북쪽 0, 시계 방향). 0 이상 2π 미만
 */
export function respawnHeading(heading: number, wind: Wind): number {
  // 파도를 선수로 받으면 가장 덜 흔들리므로, 다시 세우자마자 또 뒤집히는 일이 줄어든다.
  const target = wind.speed < CALM_WIND ? heading : (wind.fromDeg * Math.PI) / 180;
  return ((target % TURN) + TURN) % TURN;
}
