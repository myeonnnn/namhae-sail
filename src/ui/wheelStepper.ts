/**
 * 휠의 입력을 "한 단계 위", "한 단계 아래"로 바꾼다. 지도의 줌과 레이더의 탐지 거리가 함께 사용한다.
 *
 * 트랙패드는 한 번의 손동작에 수십 개의 작은 이벤트를 보내므로, 이벤트마다 단계를 바꾸면 한꺼번에 여러 단계가 넘어간다.
 * 스크롤한 양을 모아서 일정량이 될 때마다 한 단계만 바꾸고, 끊기지 않고 이어지는 스크롤에서는 일정한 간격으로만 허용한다.
 * 마우스 휠처럼 칸마다 멈춤이 있는 입력은 칸마다 바로 반응한다.
 */
export class WheelStepper {
  private accumulated = 0;
  private lastEventTime = -Infinity;
  private lastStepTime = -Infinity;

  constructor(
    private readonly options: {
      /** 한 단계에 필요한 스크롤의 양. 마우스 휠의 한 칸이 보내는 값은 장치에 따라 40에서 120까지 다르다. */
      step?: number;
      /** 이어지는 스크롤에서 다음 단계를 허용하기까지의 간격 (ms) */
      cooldownMs?: number;
    } = {},
  ) {}

  /** 휠 이벤트의 deltaY를 넣으면 -1(위로), 0(변화 없음), 1(아래로) 중의 하나를 반환한다. */
  feed(deltaY: number, now = performance.now()): -1 | 0 | 1 {
    const { step = 40, cooldownMs = 500 } = this.options;
    const pause = now - this.lastEventTime;
    // 스크롤이 한동안 멈췄으면, 이전에 모아 둔 양은 버린다.
    if (pause > IDLE_RESET_MS) this.accumulated = 0;
    this.lastEventTime = now;
    this.accumulated += deltaY;
    if (Math.abs(this.accumulated) < step) return 0;
    if (pause < NOTCH_PAUSE_MS && now - this.lastStepTime < cooldownMs) return 0;

    const direction = this.accumulated > 0 ? 1 : -1;
    this.accumulated = 0;
    this.lastStepTime = now;
    return direction;
  }
}

// 스크롤 이벤트 사이의 멈춤이 이보다 길면 마우스 휠의 새로운 한 칸으로 본다.
const NOTCH_PAUSE_MS = 120;
// 스크롤이 이 시간 동안 멈추면 모아 둔 양을 버린다.
const IDLE_RESET_MS = 300;
