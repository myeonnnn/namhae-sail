/** 조언을 판단하는 데 쓰는, 지금 이 순간의 선박과 바다의 상태 */
export interface CoachInput {
  /** 횡경사 (rad, 부호 무관) */
  heel: number;
  /** 풍랑이 선수를 기준으로 어느 쪽에서 오는지 (도, 0은 정면, 180은 뒤) */
  seaOffBow: number;
  /** 풍속 (m/s) */
  windSpeed: number;
  /** 선박의 속력 (m/s) */
  speed: number;
  /** 부서지는 마루가 선체를 때리는 세기 (0 이상) */
  breaking: number;
  capsized: boolean;
}

type TipId = 'beam' | 'heel' | 'breaker';

const MS_TO_KNOTS = 1.943844;
// 파도를 이 범위(선수에서 잰 각도, 도)에서 받으면 옆으로 받는 것이다. 파도 방향 계기의 붉은 호와 같은 범위이다.
const BEAM_SECTOR = [50, 130] as const;
// 이 풍속(m/s)부터 파도를 옆으로 받는 것이 위험하다. 파도 방향 계기가 경고하는 기준과 같다.
const ROUGH_WIND = 14;
// 경사계의 붉은 구간이 시작되는 기울기 (rad)
const DANGER_HEEL = (30 * Math.PI) / 180;
// 부서지는 마루를 이보다 세게, 이 속력(m/s)보다 빠르게 맞으면 속력을 줄이라고 알린다.
const HARD_BREAKER = 0.06;
const FAST = 15;
// 조건이 이 시간(초) 동안 이어져야 조언한다. 선회하면서 잠깐 스치는 것에는 반응하지 않는다.
const HOLD = { beam: 2.5, heel: 0.4, breaker: 0 } as const;
// 같은 조언은 이 횟수까지만 한다. 요령을 익힌 뒤에도 되풀이하면 방해가 된다.
const MAX_REPEATS = 2;
// 조언과 조언 사이에 두는 시간 (초)
const COOLDOWN = 18;

const TIPS: Record<TipId, string> = {
  beam: '파도를 옆으로 받고 있습니다. 파도 방향 계기의 화살표가 붉은 구간을 벗어나도록 선수를 돌리거나, 속력을 줄이세요.',
  heel: '횡경사가 위험한 구간입니다. 기울어지는 쪽의 반대로 타를 쓰고 스로틀을 내리세요.',
  breaker: '부서지는 마루를 빠르게 넘었습니다. 흰 물거품이 보이면 미리 속력을 줄이세요.',
};

/**
 * 거친 바다에서 조종하는 요령을, 그 요령이 필요한 순간에 한 줄씩 알려 준다.
 * 어떤 조언을 언제 할지만 판단하는 순수한 계산이고, 화면에 표시하는 일은 호출하는 쪽이 한다.
 */
export class Coach {
  private readonly held: Record<TipId, number> = { beam: 0, heel: 0, breaker: 0 };
  private readonly shown: Record<TipId, number> = { beam: 0, heel: 0, breaker: 0 };
  private sinceTip = Infinity;
  private wasCapsized = false;
  /** 뒤집히기 직전의 상태. 뒤집힌 까닭을 설명하는 데 사용한다. */
  private last: CoachInput | undefined;

  /**
   * dt만큼 진행한다. 매 프레임 호출한다.
   * @returns 지금 보여 줄 조언. 없으면 undefined이다.
   */
  update(dt: number, input: CoachInput): string | undefined {
    this.sinceTip += dt;

    if (input.capsized) {
      const first = !this.wasCapsized;
      this.wasCapsized = true;
      // 뒤집힌 까닭은 횟수와 간격의 제한 없이 매번 알린다. 다음 시도에서 무엇을 바꿔야 할지 알려 주기 때문이다.
      return first ? this.explain(this.last ?? input) : undefined;
    }
    this.wasCapsized = false;
    this.last = { ...input };

    const beamOn = input.seaOffBow >= BEAM_SECTOR[0] && input.seaOffBow <= BEAM_SECTOR[1];
    const active: Record<TipId, boolean> = {
      beam: beamOn && input.windSpeed >= ROUGH_WIND,
      heel: Math.abs(input.heel) >= DANGER_HEEL,
      breaker: input.breaking >= HARD_BREAKER && input.speed >= FAST,
    };
    // 급한 것부터 확인한다.
    for (const id of ['heel', 'breaker', 'beam'] as const) {
      this.held[id] = active[id] ? this.held[id] + dt : 0;
    }
    if (this.sinceTip < COOLDOWN) return undefined;
    for (const id of ['heel', 'breaker', 'beam'] as const) {
      if (active[id] && this.held[id] >= HOLD[id] && this.shown[id] < MAX_REPEATS) {
        this.shown[id]++;
        this.sinceTip = 0;
        return TIPS[id];
      }
    }
    return undefined;
  }

  private explain(input: CoachInput): string {
    const knots = Math.round(input.speed * MS_TO_KNOTS);
    const direction =
      input.seaOffBow < BEAM_SECTOR[0] ? '앞에서' : input.seaOffBow <= BEAM_SECTOR[1] ? '옆에서' : '뒤에서';
    const advice =
      direction === '옆에서'
        ? '파도를 앞이나 뒤로 받도록 선수를 돌려 보세요.'
        : input.speed >= FAST
          ? '가파른 마루 앞에서 속력을 줄여 보세요.'
          : '흰 물거품이 이는 마루를 피해서 지나가 보세요.';
    return `파도를 ${direction} 받으며 ${knots}노트로 달리다가 뒤집혔습니다. ${advice}`;
  }
}
