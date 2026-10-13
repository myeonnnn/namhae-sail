/** 횡동요(좌우 기울기)의 상태. 각도는 선체의 길이 방향 축을 도는 회전이며, 우현이 올라가는 쪽이 양수이다. */
export interface RollState {
  /** 기울기 (rad) */
  angle: number;
  /** 기울기가 변하는 빠르기 (rad/s) */
  rate: number;
}

export interface RollParams {
  /** 잔잔한 물에서 한 번 기울었다가 되돌아오는 데 걸리는 시간 (초). 폭이 넓고 무게 중심이 낮은 선박일수록 짧다. */
  period: number;
  /** 정지해 있을 때의 감쇠비. 0이면 흔들림이 줄어들지 않고, 1이면 흔들림 없이 곧바로 되돌아온다. */
  damping: number;
  /** 속력 1 m/s마다 더해지는 감쇠비. 달리는 선체는 물이 선저를 받쳐 주어서 흔들림이 빨리 잦아든다. */
  speedDamping: number;
  /**
   * 복원력이 사라지는 기울기 (rad). 수면에 대해서 이 각도보다 더 기울면 선체가 스스로 일어서지 못하고 뒤집힌다.
   * 무게 중심이 낮은 선박일수록 크다.
   */
  vanishingAngle: number;
}

/**
 * 수면에 대해서 relative(rad)만큼 기울어진 선체를 되돌리는 힘의 세기. 작은 각도에서는 각도와 같은 값이다.
 *
 * 선체가 기울면 잠긴 쪽의 부력이 커져서 선체를 일으켜 세우는데, 이 힘은 기울기에 비례해서 끝없이 커지지 않는다.
 * 복원력 소실각의 절반 부근에서 가장 크고 그 뒤로는 줄어들며, 소실각을 넘으면 부호가 바뀌어서 선체를 더 넘어뜨린다.
 * 완전히 뒤집힌 상태(180°)가 또 하나의 안정된 자세이다.
 */
export function rightingMoment(relative: number, vanishingAngle: number): number {
  const magnitude = Math.abs(relative);
  const sign = Math.sign(relative);
  if (magnitude <= vanishingAngle) {
    return sign * (vanishingAngle / Math.PI) * Math.sin((Math.PI * magnitude) / vanishingAngle);
  }
  const inverted = Math.PI - vanishingAngle;
  return -sign * (inverted / Math.PI) * Math.sin((Math.PI * (magnitude - vanishingAngle)) / inverted);
}

// 속력으로 더해지는 감쇠비의 상한. 제한하지 않으면 전속으로 달리는 것만으로 어떤 파도에서도 흔들리지 않게 된다.
const MAX_SPEED_DAMPING = 0.13;
// 적분의 한 단계가 이보다 길어지지 않도록 나눈다. 화면이 잠깐 멈췄다가 돌아와도 계산이 발산하지 않게 한다.
const MAX_STEP = 1 / 120;
const MAX_ELAPSED = 0.1;

/**
 * 횡동요를 dt만큼 진행한다.
 *
 * 선체는 수면에 붙어서 움직이는 것이 아니라, 수면의 기울기를 향해서 복원력을 받는 진자처럼 움직인다.
 * 그래서 파도가 지나간 뒤에도 한동안 흔들리고, 파도를 만나는 주기가 선체의 고유 주기와 맞으면 흔들림이 점점 커진다.
 *
 * @param surfaceSlope 선체가 놓인 수면의 좌우 기울기 (rad). 복원력은 이 기울기를 기준으로 작용한다.
 * @param heeling 선체를 기울이는 그 밖의 힘(선회, 바람, 부서지는 파도). 잔잔한 물에서 그 힘이 만드는 기울기(rad)로 표현한다.
 * @param speed 선체의 속력 (m/s)
 */
export function stepRoll(
  state: RollState,
  surfaceSlope: number,
  heeling: number,
  params: RollParams,
  speed: number,
  dt: number,
): void {
  const naturalFrequency = (Math.PI * 2) / params.period;
  const damping = params.damping + Math.min(params.speedDamping * Math.abs(speed), MAX_SPEED_DAMPING);
  let remaining = Math.min(dt, MAX_ELAPSED);
  while (remaining > 1e-6) {
    const step = Math.min(remaining, MAX_STEP);
    const righting = rightingMoment(state.angle - surfaceSlope, params.vanishingAngle);
    const acceleration =
      naturalFrequency * naturalFrequency * (heeling - righting) - 2 * damping * naturalFrequency * state.rate;
    // 속도를 먼저 갱신하고 그 속도로 각도를 갱신한다. 이 순서가 진동하는 계에서 에너지가 불어나지 않게 한다.
    state.rate += acceleration * step;
    state.angle += state.rate * step;
    remaining -= step;
  }
}
