import type { Course, Gate } from '../course/course';

export type RacePhase = 'idle' | 'countdown' | 'running' | 'finished';

export type RaceEvent =
  | { type: 'count'; remaining: number }
  | { type: 'go' }
  | { type: 'gate'; index: number; split: number }
  | { type: 'finish' };

// 출발하기 전에 세는 시간 (초)
export const COUNTDOWN_SECONDS = 3;
// 전복될 때마다 기록에 더하는 시간 (초)
export const CAPSIZE_PENALTY = 10;

/** 선분 p1-p2와 선분 q1-q2가 만나면 true. 관문을 어느 쪽에서 지나든 같은 결과가 나온다. */
export function segmentsCross(
  p1x: number,
  p1z: number,
  p2x: number,
  p2z: number,
  q1x: number,
  q1z: number,
  q2x: number,
  q2z: number,
): boolean {
  const side = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) =>
    (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = side(q1x, q1z, q2x, q2z, p1x, p1z);
  const d2 = side(q1x, q1z, q2x, q2z, p2x, p2z);
  const d3 = side(p1x, p1z, p2x, p2z, q1x, q1z);
  const d4 = side(p1x, p1z, p2x, p2z, q2x, q2z);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * 타임어택 한 번의 진행 상태: 카운트다운, 관문의 통과, 시간과 벌점.
 * 화면이나 선박의 객체를 모르는 순수한 계산이며, 물리와 같은 고정 간격으로 진행한다.
 */
export class Race {
  phase: RacePhase = 'idle';
  /** 카운트다운에서 남은 시간 (초) */
  countdown = 0;
  /** 출발한 뒤에 흐른 시간 (초). 벌점은 포함하지 않는다. */
  time = 0;
  /** 전복된 횟수 */
  capsizes = 0;
  /** 다음에 지나야 하는 관문의 번호. 모두 지났으면 관문의 수와 같다. */
  nextGate = 0;
  /** 각 관문을 지난 시각 (초, 벌점 포함) */
  readonly splits: number[] = [];

  constructor(readonly course: Course) {}

  /** 벌점의 합계 (초) */
  get penalty(): number {
    return this.capsizes * CAPSIZE_PENALTY;
  }

  /** 기록: 흐른 시간에 벌점을 더한 값 (초) */
  get total(): number {
    return this.time + this.penalty;
  }

  /** 다음에 지나야 하는 관문. 완주했으면 undefined이다. */
  get target(): Gate | undefined {
    return this.course.gates[this.nextGate];
  }

  /** 전복된 뒤에 다시 출발하는 위치: 마지막으로 지난 관문, 아직 지난 관문이 없으면 출발 위치 */
  get respawn(): { x: number; z: number; heading: number } {
    const passed = this.course.gates[this.nextGate - 1];
    if (!passed) return this.course.start;
    // 지난 관문에서 다음 관문을 바라보는 방향으로 놓는다.
    const next = this.target ?? passed;
    const heading = next === passed ? passed.heading : Math.atan2(next.x - passed.x, -(next.z - passed.z));
    return { x: passed.x, z: passed.z, heading };
  }

  /** 카운트다운부터 새로 시작한다. */
  begin(): void {
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.time = 0;
    this.capsizes = 0;
    this.nextGate = 0;
    this.splits.length = 0;
  }

  /** 도전을 그만둔다. */
  abort(): void {
    this.phase = 'idle';
  }

  /** 주행 중에 전복되었을 때 호출한다. 횟수와 벌점이 늘어난다. */
  capsize(): void {
    if (this.phase === 'running') this.capsizes++;
  }

  /**
   * dt만큼 진행한다.
   * @param from, to 이번 스텝에 선박이 이동하기 전과 후의 위치. 그 사이의 선분이 관문과 만나면 통과이다.
   */
  step(dt: number, from: { x: number; z: number }, to: { x: number; z: number }): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'running';
        events.push({ type: 'go' });
      } else if (Math.ceil(this.countdown) < before) {
        events.push({ type: 'count', remaining: Math.ceil(this.countdown) });
      }
      return events;
    }
    if (this.phase !== 'running') return events;

    this.time += dt;
    const gate = this.target;
    // 순서가 된 관문만 확인한다. 다른 관문을 먼저 지나도 인정하지 않는다.
    if (gate && segmentsCross(from.x, from.z, to.x, to.z, gate.ax, gate.az, gate.bx, gate.bz)) {
      this.splits.push(this.total);
      events.push({ type: 'gate', index: this.nextGate, split: this.total });
      this.nextGate++;
      if (gate.finish) {
        this.phase = 'finished';
        events.push({ type: 'finish' });
      }
    }
    return events;
  }
}
