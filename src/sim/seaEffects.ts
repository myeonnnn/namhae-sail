import type { ChaseCamera } from '../ship/chaseCamera';
import type { ImpactSpray } from '../ship/impactSpray';
import type { Ship } from '../ship/ship';
import type { ShipSpec } from '../ship/shipSpec';

// 부서지는 마루가 선체를 때리는 세기가 이 값을 넘으면 물보라를 일으킨다.
const BREAKER_THRESHOLD = 0.03;
// 같은 파도에서 연달아 일으키지 않도록 두는 간격 (초)
const BREAKER_INTERVAL = 1.2;
const DEFAULT_CAPSIZE_MESSAGE = '전복되었습니다: R 키로 다시 시작';

/** 전복되는 순간과, 부서지는 파도가 선체의 옆면을 때리는 순간을 물보라와 카메라의 흔들림으로 연출한다. */
export class SeaEffects {
  /** 뒤집혀 있는 동안 표시하는 문구. 타임어택에서는 다시 출발하는 위치와 벌점을 알리는 문구로 바꾼다. */
  capsizeMessage = DEFAULT_CAPSIZE_MESSAGE;
  /** 뒤집히는 순간에 한 번 호출한다. */
  onCapsize?: () => void;
  private wasCapsized = false;
  private sinceBreaker = Infinity;

  constructor(
    private readonly ship: Ship,
    private readonly hull: ShipSpec['model'],
    private readonly spray: ImpactSpray,
    private readonly camera: ChaseCamera,
    private readonly showAlert: (message: string) => void,
  ) {}

  /** 선체의 자세를 갱신한 다음에 매 프레임 호출한다. */
  update(frameTime: number): void {
    const { ship, hull } = this;
    const { x, z } = ship.state;
    if (ship.capsized) {
      if (!this.wasCapsized) {
        this.wasCapsized = true;
        this.spray.burst(x, 0.5, z, 1, hull.length * 0.6);
        this.camera.shake(1);
        this.onCapsize?.();
      }
      // 경고는 일정 시간이 지나면 사라지므로, 뒤집혀 있는 동안에는 계속 다시 표시한다.
      this.showAlert(this.capsizeMessage);
      return;
    }
    this.wasCapsized = false;

    this.sinceBreaker += frameTime;
    if (ship.breaking > BREAKER_THRESHOLD && this.sinceBreaker > BREAKER_INTERVAL) {
      this.sinceBreaker = 0;
      const intensity = Math.min(ship.breaking / (BREAKER_THRESHOLD * 4), 1);
      this.spray.burst(x, 0.5, z, intensity, hull.beam);
      this.camera.shake(intensity * 0.5);
    }
  }

  /** 문구와 알림을 기본값으로 되돌린다. */
  resetCapsizeHandling(): void {
    this.capsizeMessage = DEFAULT_CAPSIZE_MESSAGE;
    this.onCapsize = undefined;
  }
}
