import type { Course } from '../course/course';
import type { RaceResult } from '../course/records';
import { formatBearing, formatDistance } from '../geo/units';
import { CAPSIZE_PENALTY, type Race } from '../sim/race';
import { createButton, writeAttribute, writeText } from './dom';

// 화면 가운데에 띄운 큰 글자(카운트다운, 출발, 완주)가 머무르는 시간 (ms)
const BANNER_HOLD_MS = 900;

/** 기록을 분:초.십분의 일초로 표시한다. */
export function formatRaceTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/**
 * 타임어택의 표시: 화면 위쪽의 시간과 다음 관문, 가운데의 큰 글자, 완주한 뒤의 결과.
 * 도전하고 있지 않을 때에는 아무것도 보이지 않는다.
 */
export class RaceHud {
  private readonly panel = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly result = document.createElement('div');
  private readonly time: HTMLElement;
  private readonly gate: HTMLElement;
  private readonly gates: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly distance: HTMLElement;
  private readonly capsizes: HTMLElement;
  private bannerUntil = 0;

  constructor(root: HTMLElement) {
    const { panel, banner, result } = this;
    panel.className = 'hud-panel hud-race';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="hud-race-time" data-ref="time"></div>
      <div class="hud-race-gates" data-ref="gates"></div>
      <div class="hud-race-meta">
        <span data-ref="gate"></span>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path data-ref="arrow" d="M10 2 L15 15 L10 12 L5 15 Z" /></svg>
        <span class="hud-value" data-ref="distance"></span>
        <span data-ref="capsizes"></span>
      </div>`;
    const ref = (name: string) => panel.querySelector<HTMLElement>(`[data-ref="${name}"]`)!;
    this.time = ref('time');
    this.gate = ref('gate');
    this.gates = ref('gates');
    this.arrow = ref('arrow');
    this.distance = ref('distance');
    this.capsizes = ref('capsizes');

    banner.className = 'hud-race-banner';
    banner.hidden = true;
    result.className = 'hud-panel hud-race-result';
    result.hidden = true;
    root.append(panel, banner, result);
  }

  /** 코스의 관문 하나마다 칸을 하나씩 만든다. 지난 관문은 채워지고, 다음 관문은 강조되며, 마지막 칸이 도착선이다. */
  show(course: Course): void {
    this.gates.replaceChildren(
      ...course.gates.map((gate) => {
        const pip = document.createElement('i');
        if (gate.finish) pip.dataset['finish'] = 'true';
        return pip;
      }),
    );
    this.panel.hidden = false;
    this.result.hidden = true;
  }

  hide(): void {
    this.panel.hidden = true;
    this.banner.hidden = true;
    this.result.hidden = true;
  }

  /** 화면 가운데에 큰 글자를 잠시 띄운다. */
  flash(text: string, kind: 'count' | 'go' | 'finish' = 'count'): void {
    this.banner.textContent = text;
    this.banner.dataset['kind'] = kind;
    this.banner.hidden = false;
    // 같은 글자를 다시 띄울 때에도 나타나는 움직임이 처음부터 재생되게 한다.
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
    this.bannerUntil = performance.now() + (kind === 'finish' ? BANNER_HOLD_MS * 2.5 : BANNER_HOLD_MS);
  }

  /** 매 프레임 호출한다. */
  update(race: Race, ship: { x: number; z: number; heading: number }): void {
    if (!this.banner.hidden && performance.now() > this.bannerUntil) this.banner.hidden = true;

    writeText(this.time, formatRaceTime(race.phase === 'countdown' ? 0 : race.total));
    const total = race.course.gates.length;
    Array.from(this.gates.children).forEach((pip, index) =>
      writeAttribute(pip, 'data-state', index < race.nextGate ? 'passed' : index === race.nextGate ? 'next' : 'ahead'),
    );
    const target = race.target;
    writeText(this.gate, target ? (target.finish ? '도착선' : `관문 ${race.nextGate + 1}/${total - 1}`) : '완주');
    if (target) {
      const east = target.x - ship.x;
      const north = -(target.z - ship.z);
      const bearing = Math.atan2(east, north);
      // 화살표는 선수를 기준으로 관문이 있는 쪽을 가리킨다. 위쪽이 선수이다.
      const relative = ((bearing - ship.heading) * 180) / Math.PI;
      writeAttribute(this.arrow, 'transform', `rotate(${relative.toFixed(0)} 10 10)`);
      writeText(this.distance, `${formatBearing(bearing)} · ${formatDistance(Math.hypot(east, north)).split(' (')[0]}`);
    }
    writeText(this.capsizes, race.capsizes ? `전복 ${race.capsizes}회 (+${race.penalty}초)` : '');
  }

  /** 완주한 뒤의 결과를 보여 준다. */
  showResult(
    course: Course,
    result: RaceResult,
    record: { best: RaceResult; improved: boolean },
    actions: { retry(): void; exit(): void },
  ): void {
    const row = (label: string, value: string, emphasis = false) =>
      `<div class="hud-label">${label}</div><div class="hud-value${emphasis ? ' hud-race-total' : ''}">${value}</div>`;
    const best = record.improved ? '새로운 최고 기록' : `최고 기록 ${formatRaceTime(record.best.total)}`;
    this.result.innerHTML = `
      <h2>완주</h2>
      <p class="hud-label">${course.name}</p>
      <div class="hud-race-result-grid">
        ${row('기록', formatRaceTime(result.total), true)}
        ${row('주행 시간', formatRaceTime(result.time))}
        ${row('전복', `${result.capsizes}회${result.capsizes ? ` (벌점 +${result.capsizes * CAPSIZE_PENALTY}초)` : ''}`)}
      </div>
      <p class="hud-race-best" data-improved="${record.improved}">${best}</p>
      <div class="hud-race-actions"></div>`;
    this.result
      .querySelector('.hud-race-actions')!
      .append(
        createButton({ content: '다시 도전', className: 'hud-race-primary', onClick: actions.retry }),
        createButton({ content: '자유 항해', onClick: actions.exit }),
      );
    this.result.hidden = false;
  }
}
