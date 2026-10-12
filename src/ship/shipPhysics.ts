/**
 * 3자유도(전후, 횡, 선회) 선박 운동 모델.
 *
 * 좌표 규약: 월드의 +X는 동쪽, -Z는 북쪽이다.
 * heading은 북쪽을 0으로 하고 시계 방향으로 증가하는 라디안 값이다.
 * 힘은 모두 질량으로 나눈 가속도 단위로 표현한다.
 */
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

export const SHIP_PARAMS = {
  thrustAccel: 3.0,
  reverseThrustRatio: 0.4,
  surgeLinearDrag: 0.05,
  surgeQuadraticDrag: 0.0167,
  swayDrag: 3.0,
  rudderGain: 0.044,
  propWashGain: 0.15,
  yawLinearDrag: 1.5,
  yawQuadraticDrag: 1.0,
} as const;

export function createShipState(): ShipState {
  return { x: 0, z: 0, heading: 0, surge: 0, sway: 0, yawRate: 0 };
}

export function stepShip(state: ShipState, controls: ShipControls, dt: number): void {
  const p = SHIP_PARAMS;
  const { surge, sway, yawRate } = state;

  const thrust =
    controls.throttle >= 0
      ? controls.throttle * p.thrustAccel
      : controls.throttle * p.thrustAccel * p.reverseThrustRatio;

  const surgeAccel =
    thrust - p.surgeLinearDrag * surge - p.surgeQuadraticDrag * Math.abs(surge) * surge + sway * yawRate;
  // -surge * yawRate 항 때문에 선회할 때 선체가 바깥쪽으로 밀린다.
  const swayAccel = -p.swayDrag * sway - surge * yawRate;
  // 타는 물의 흐름이 있어야 효과가 있으므로 속도에 비례하고, 프로펠러 후류가 저속에서의 타효를 보탠다.
  const yawAccel =
    controls.rudder * (p.rudderGain * surge + p.propWashGain * controls.throttle) -
    p.yawLinearDrag * yawRate -
    p.yawQuadraticDrag * Math.abs(yawRate) * yawRate;

  state.surge += surgeAccel * dt;
  state.sway += swayAccel * dt;
  state.yawRate += yawAccel * dt;
  state.heading = wrapAngle(state.heading + state.yawRate * dt);

  const sin = Math.sin(state.heading);
  const cos = Math.cos(state.heading);
  state.x += (state.surge * sin + state.sway * cos) * dt;
  state.z += (-state.surge * cos + state.sway * sin) * dt;
}

/** 각도를 [0, 2π) 범위로 정규화한다. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}
