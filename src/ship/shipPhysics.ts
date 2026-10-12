/**
 * 3자유도(전후, 횡, 선회) 선박 운동 모델.
 *
 * 좌표 규약: 월드의 +X는 동쪽, -Z는 북쪽이다.
 * heading은 북쪽을 0으로 하고 시계 방향으로 증가하는 라디안 값이다.
 * 힘은 모두 질량으로 나눈 가속도 단위로 표현한다.
 */
import type { ShipSpec } from './shipSpec';

export interface ShipState {
  x: number;
  z: number;
  heading: number;
  /** 선수 방향 속도 (m/s) */
  surge: number;
  /** 우현 방향 속도 (m/s) */
  sway: number;
  /** 선회 각속도 (rad/s), 우현 선회가 양수 */
  yawRate: number;
}

export interface ShipControls {
  /** -1(전속 후진) ~ 1(전속 전진) */
  throttle: number;
  /** -1(좌현 전타) ~ 1(우현 전타) */
  rudder: number;
}

export function createShipState(): ShipState {
  return { x: 0, z: 0, heading: 0, surge: 0, sway: 0, yawRate: 0 };
}

export function stepShip(
  state: ShipState,
  controls: ShipControls,
  p: ShipSpec['physics'],
  /** 바람이 공기를 이동시키는 속도 (월드 좌표, m/s) */
  wind: { x: number; z: number },
  dt: number,
): void {
  const { surge, sway, yawRate } = state;

  // 선체가 실제로 받는 바람은 바람의 속도에서 배의 속도를 뺀 값이다.
  // 월드 기준의 바람을 선체 기준(선수 방향, 우현 방향)으로 변환한 다음에 배의 속도를 뺀다.
  const { forward: apparentForward, starboard: apparentStarboard } = apparentWind(state, wind);
  // 풍압은 풍속의 제곱에 비례한다.
  const apparentSpeed = Math.hypot(apparentForward, apparentStarboard);

  const thrust =
    controls.throttle >= 0
      ? controls.throttle * p.thrustAccel
      : controls.throttle * p.thrustAccel * p.reverseThrustRatio;

  const surgeAccel =
    thrust -
    p.surgeLinearDrag * surge -
    p.surgeQuadraticDrag * Math.abs(surge) * surge +
    sway * yawRate +
    p.windSurge * apparentForward * apparentSpeed;
  // -surge * yawRate 항 때문에 선회할 때 선체가 바깥쪽으로 밀린다.
  const swayAccel = -p.swayDrag * sway - surge * yawRate + p.windSway * apparentStarboard * apparentSpeed;
  // 타는 물의 흐름이 있어야 효과가 있으므로 속도에 비례하고, 프로펠러 후류가 저속에서의 타효를 보탠다.
  const yawAccel =
    controls.rudder * (p.rudderGain * surge + p.propWashGain * controls.throttle) -
    p.yawLinearDrag * yawRate -
    p.yawQuadraticDrag * Math.abs(yawRate) * yawRate +
    p.windYaw * apparentStarboard * apparentSpeed;

  state.surge += surgeAccel * dt;
  state.sway += swayAccel * dt;
  state.yawRate += yawAccel * dt;
  state.heading = wrapAngle(state.heading + state.yawRate * dt);

  const sin = Math.sin(state.heading);
  const cos = Math.cos(state.heading);
  state.x += (state.surge * sin + state.sway * cos) * dt;
  state.z += (-state.surge * cos + state.sway * sin) * dt;
}

/**
 * 선체가 실제로 받는 바람(겉보기 바람)을 선체 기준의 속도로 반환한다.
 * 바람의 속도에서 배의 속도를 뺀 값이며, forward는 선수 방향으로, starboard는 우현 방향으로 공기가 이동하는 속도이다.
 * 배가 빠르게 전진하면 바람이 없어도 앞에서 불어오는 바람을 받게 된다.
 */
export function apparentWind(state: ShipState, wind: { x: number; z: number }): { forward: number; starboard: number } {
  const sin = Math.sin(state.heading);
  const cos = Math.cos(state.heading);
  return {
    forward: wind.x * sin - wind.z * cos - state.surge,
    starboard: wind.x * cos + wind.z * sin - state.sway,
  };
}

/** 각도를 [0, 2π) 범위로 정규화한다. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}
