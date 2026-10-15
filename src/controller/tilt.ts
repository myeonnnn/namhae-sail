/** 수평에서 이만큼(도) 돌리면 타가 끝까지 간다. */
const FULL_ROLL = 30;
/** 기울기를 따라가는 시정수(초). 손 떨림(초당 8~12번)은 크게 줄이고, 핸들을 돌리는 느린 동작은 거의 그대로 따라간다. */
const SMOOTHING_TIME = 0.15;
/** 수평에서 이 각도(도) 안쪽은 손의 떨림으로 보고 0으로 둔다. */
const DEAD_ZONE = 3;

/** 가속도 센서가 잰 중력의 방향. DeviceMotionEvent.accelerationIncludingGravity의 x, y와 같다 (m/s²). */
export interface Gravity {
  x: number;
  y: number;
}

/**
 * 가로로 쥔 핸드폰을 핸들처럼 돌린 각도(도)를 구한다. 시계 방향이 양수이고, 화면이 수평이면 0이다. 결과는 -90 이상 90 미만이다.
 * @param gravity 핸드폰의 본래(세로) 방향을 기준으로 한 값. x는 오른쪽 모서리, y는 위쪽 모서리를 향한다.
 *   세로로 세워 들면 y가 +9.8이다. 다만 브라우저에 따라 x와 y의 부호가 모두 반대일 수 있으므로, 결과는 부호가 반대여도 같다.
 * @param screenAngle 화면이 돌아간 각도(도). screen.orientation.angle과 같다.
 *   핸드폰을 반시계 방향으로 눕혀서 가로로 들면 90, 시계 방향으로 눕히면 270이다.
 */
export function screenRoll(gravity: Gravity, screenAngle: number): number {
  // 핸드폰 본래 방향의 값을 지금 화면의 가로(x)와 세로(y) 방향으로 돌려 놓는다.
  const a = (screenAngle * Math.PI) / 180;
  const x = gravity.x * Math.cos(a) - gravity.y * Math.sin(a);
  const y = gravity.x * Math.sin(a) + gravity.y * Math.cos(a);
  // 화면을 시계 방향으로 돌리면 위쪽은 화면 안에서 반시계 방향으로 돌아가 보인다.
  // 결과를 180도 범위로 접으면, 브라우저마다 다른 센서의 부호와 screenAngle의 90과 270이 뒤바뀐 경우가 모두 같은 각도가 된다.
  return wrapHalfTurn((Math.atan2(-x, y) * 180) / Math.PI);
}

/**
 * 센서가 잰 각도를 부드럽게 따라가서, 손의 미세한 떨림을 걸러 낸다.
 * 시정수 0.15초의 지수 평활이다. 각도가 한 번에 바뀌면 0.15초 뒤에 바뀐 양의 1−1/e(약 63%)를 따라간다.
 * @param previous 직전에 이 함수가 돌려준 각도(도). 처음이면 undefined이고, 이때는 roll을 그대로 돌려준다
 * @param roll screenRoll이 구한 지금의 각도(도)
 * @param dt 직전 값을 받은 뒤로 지난 시간(초)
 */
export function smoothRoll(previous: number | undefined, roll: number, dt: number): number {
  if (previous === undefined) return roll;
  // 센서 값이 오는 간격은 기기와 부하에 따라 달라지므로, 간격에 맞춘 비율로 따라가야 같은 시간에 같은 만큼 반영된다.
  const alpha = 1 - Math.exp(-Math.max(0, dt) / SMOOTHING_TIME);
  return previous + (roll - previous) * alpha;
}

/**
 * 핸드폰을 돌린 각도를 타의 위치(-1~1)로 바꾼다. 화면이 수평인 자세(0도)가 타의 가운데이다.
 * @param roll screenRoll이 구한 지금의 각도(도)
 */
export function rudderFromRoll(roll: number): number {
  const angle = wrapHalfTurn(roll);
  // 데드존을 뺀 나머지 각도로 비례시켜서, 데드존을 넘는 순간 타가 0에서부터 이어서 움직이게 한다.
  const beyond = Math.abs(angle) - DEAD_ZONE;
  if (beyond <= 0) return 0;
  return Math.sign(angle) * Math.min(1, beyond / (FULL_ROLL - DEAD_ZONE));
}

/** 각도(도)를 -90 이상 90 미만으로 접는다. 핸들은 반 바퀴 넘게 돌리지 않으므로 180도 차이는 같은 자세로 본다. */
function wrapHalfTurn(degrees: number): number {
  return ((((degrees + 90) % 180) + 180) % 180) - 90;
}
