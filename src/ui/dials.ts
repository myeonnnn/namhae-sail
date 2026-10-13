import type { Swell } from '../environment/swell';
import type { Wind } from '../environment/wind';
import { writeAttribute, writeText } from './dom';

/**
 * 계기판에 넣는 원형 계기들.
 * 각 계기는 계기판의 틀에 끼워 넣을 마크업(MARKUP)을 제공하고, 틀이 만들어진 뒤에 그 안에서 자신의 요소를 찾아서 갱신한다.
 */

const ref = (panel: HTMLElement, name: string) => panel.querySelector<HTMLElement>(`[data-ref="${name}"]`)!;

// ---- 경사계 ----
// 위쪽의 축에 매달린 추가 아래의 눈금을 가리키는 형태이다. 눈금은 좌우로 이 각도(도)까지 그린다.
const INCLINE_PIVOT_X = 36;
const INCLINE_PIVOT_Y = 8;
const INCLINE_RADIUS = 40;
// 수면에 대한 기울기가 약 65°를 넘으면 뒤집히므로, 그 직전까지 추가 따라가도록 60°까지 그린다.
const INCLINE_SCALE_DEG = 60;
// 이 각도(도)부터는 위험한 기울기로 보고 붉은색으로 표시한다.
const INCLINE_DANGER_DEG = 30;
// 이보다 작은 기울기는 수평으로 표시한다. 잔잔한 물에서 값이 계속 바뀌어 보이지 않게 한다.
const INCLINE_LEVEL_DEG = 1;

/** 경사계의 눈금 위에서 기울기(도, 우현 쪽이 양수)에 해당하는 지점 */
function inclinePoint(degrees: number): string {
  const angle = (degrees * Math.PI) / 180;
  return `${(INCLINE_PIVOT_X + INCLINE_RADIUS * Math.sin(angle)).toFixed(2)} ${(INCLINE_PIVOT_Y + INCLINE_RADIUS * Math.cos(angle)).toFixed(2)}`;
}

/** 경사계의 눈금을 따라 from에서 to까지(도)의 호를 그리는 SVG 경로 */
function inclineArc(from: number, to: number): string {
  return `M ${inclinePoint(from)} A ${INCLINE_RADIUS} ${INCLINE_RADIUS} 0 0 0 ${inclinePoint(to)}`;
}

/** 선체의 좌우 기울기를 추로 표시한다. */
export class Inclinometer {
  static readonly MARKUP = `
    <div class="hud-dial">
      <svg viewBox="0 0 72 58" width="72" height="58">
        <path class="hud-tach-track" d="${inclineArc(-INCLINE_DANGER_DEG, INCLINE_DANGER_DEG)}" />
        <path class="hud-tach-redline" d="${inclineArc(-INCLINE_SCALE_DEG, -INCLINE_DANGER_DEG)}" />
        <path class="hud-tach-redline" d="${inclineArc(INCLINE_DANGER_DEG, INCLINE_SCALE_DEG)}" />
        <line class="hud-incline-zero" x1="${INCLINE_PIVOT_X}" y1="${INCLINE_PIVOT_Y + INCLINE_RADIUS - 6}" x2="${INCLINE_PIVOT_X}" y2="${INCLINE_PIVOT_Y + INCLINE_RADIUS + 6}" />
        <line class="hud-tach-needle" data-ref="inclineNeedle" x1="${INCLINE_PIVOT_X}" y1="${INCLINE_PIVOT_Y}" x2="${INCLINE_PIVOT_X}" y2="${INCLINE_PIVOT_Y + INCLINE_RADIUS - 6}" />
        <circle class="hud-tach-hub" cx="${INCLINE_PIVOT_X}" cy="${INCLINE_PIVOT_Y}" r="3" />
      </svg>
      <div class="hud-label">횡경사</div>
      <div class="hud-value" data-ref="incline"></div>
    </div>`;

  private readonly needle: HTMLElement;
  private readonly value: HTMLElement;

  constructor(panel: HTMLElement) {
    this.needle = ref(panel, 'inclineNeedle');
    this.value = ref(panel, 'incline');
  }

  /** @param heel 횡경사 (rad). 우현 쪽으로 기울어지면 양수이다. */
  update(heel: number): void {
    const heelDeg = (heel * 180) / Math.PI;
    // 추는 선체가 기울어진 쪽, 곧 낮아진 쪽으로 움직인다. 화면의 오른쪽이 우현이다.
    const shown = Math.max(-INCLINE_SCALE_DEG - 4, Math.min(INCLINE_SCALE_DEG + 4, heelDeg));
    writeAttribute(this.needle, 'transform', `rotate(${(-shown).toFixed(1)} ${INCLINE_PIVOT_X} ${INCLINE_PIVOT_Y})`);
    // 90°를 넘었으면 이미 뒤집힌 것이므로 각도 대신에 상태를 표시한다.
    writeText(
      this.value,
      Math.abs(heelDeg) > 90
        ? '전복'
        : Math.abs(heelDeg) < INCLINE_LEVEL_DEG
          ? '수평'
          : `${heelDeg > 0 ? '우현' : '좌현'} ${Math.abs(heelDeg).toFixed(0)}°`,
    );
    writeAttribute(this.value, 'data-danger', String(Math.abs(heelDeg) >= INCLINE_DANGER_DEG));
  }
}

// ---- 파도의 방향 ----
// 파도가 오는 방향을 선수 기준으로 표시한다. 위쪽이 선수이다.
const SEA_CENTER_X = 36;
const SEA_CENTER_Y = 29;
const SEA_RADIUS = 25;
// 파도를 이 범위(선수에서 잰 각도, 도)에서 받으면 옆으로 받는 것이다. 선체가 가장 크게 기울어지는 위험한 자세이다.
const BEAM_SECTOR_DEG = [50, 130] as const;
// 이 풍속(m/s)부터는 옆으로 받는 자세를 경고한다. 이보다 약한 바람에서는 옆으로 받아도 뒤집히지 않는다.
const BEAM_WARNING_WIND = 14;

/** 파도 계기의 테두리 위에서, 선수에서 시계 방향으로 잰 각도(도)에 해당하는 지점 */
function seaPoint(degrees: number): string {
  const angle = (degrees * Math.PI) / 180;
  return `${(SEA_CENTER_X + SEA_RADIUS * Math.sin(angle)).toFixed(2)} ${(SEA_CENTER_Y - SEA_RADIUS * Math.cos(angle)).toFixed(2)}`;
}

/** 파도 계기의 테두리를 따라 from에서 to까지(도) 시계 방향으로 그리는 호 */
function seaArc(from: number, to: number): string {
  return `M ${seaPoint(from)} A ${SEA_RADIUS} ${SEA_RADIUS} 0 0 1 ${seaPoint(to)}`;
}

// 테두리에서 중심을 향하는 화살표. 파도가 오는 방향으로 돌려서 사용한다.
const SEA_ARROW = `M ${SEA_CENTER_X - 1.4} ${SEA_CENTER_Y - SEA_RADIUS + 1} h 2.8 v 7 h 3 l -4.4 7 l -4.4 -7 h 3 Z`;

/** 각도를 선수 기준의 -180° 초과 180° 이하로 바꾼다. 양수가 우현 쪽이다. */
function relativeBearing(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * 풍랑과 너울이 오는 방향을 선수 기준으로 표시한다.
 * 파도는 바람이 불어오는 쪽에서 오므로, 배의 속력이 섞인 겉보기 바람이 아니라 실제의 풍향을 사용한다.
 */
export class SeaDirectionDial {
  static readonly MARKUP = `
    <div class="hud-dial">
      <svg viewBox="0 0 72 58" width="72" height="58">
        <circle class="hud-apparent-ring" cx="${SEA_CENTER_X}" cy="${SEA_CENTER_Y}" r="${SEA_RADIUS}" />
        <path class="hud-sea-beam" d="${seaArc(BEAM_SECTOR_DEG[0], BEAM_SECTOR_DEG[1])}" />
        <path class="hud-sea-beam" d="${seaArc(-BEAM_SECTOR_DEG[1], -BEAM_SECTOR_DEG[0])}" />
        <path class="hud-apparent-hull" d="M${SEA_CENTER_X} ${SEA_CENTER_Y - 12} c 6 6 6 15 3.5 22 h -7 c -2.5 -7 -2.5 -16 3.5 -22 Z" />
        <path class="hud-sea-swell" data-ref="swellArrow" d="${SEA_ARROW}" />
        <path class="hud-sea-wind" data-ref="windSeaArrow" d="${SEA_ARROW}" />
      </svg>
      <div class="hud-label hud-sea-legend"><i class="hud-sea-dot-wind"></i>풍랑<i class="hud-sea-dot-swell"></i>너울</div>
      <div class="hud-value" data-ref="sea"></div>
    </div>`;

  private readonly windArrow: HTMLElement;
  private readonly swellArrow: HTMLElement;
  private readonly value: HTMLElement;

  constructor(panel: HTMLElement) {
    this.windArrow = ref(panel, 'windSeaArrow');
    this.swellArrow = ref(panel, 'swellArrow');
    this.value = ref(panel, 'sea');
  }

  /** @param heading 선수 방위 (rad) */
  update(heading: number, wind: Wind, swell: Swell): void {
    const headingDeg = (heading * 180) / Math.PI;
    const windFrom = relativeBearing(wind.fromDeg - headingDeg);
    const swellFrom = relativeBearing(swell.fromDeg - headingDeg);
    const rotate = (degrees: number) => `rotate(${degrees.toFixed(1)} ${SEA_CENTER_X} ${SEA_CENTER_Y})`;
    writeAttribute(this.windArrow, 'transform', rotate(windFrom));
    writeAttribute(this.windArrow, 'visibility', wind.speed < 0.1 ? 'hidden' : 'visible');
    writeAttribute(this.swellArrow, 'transform', rotate(swellFrom));
    writeAttribute(this.swellArrow, 'visibility', swell.height < 0.05 ? 'hidden' : 'visible');

    const offBow = Math.abs(windFrom);
    writeText(
      this.value,
      wind.speed < 0.1
        ? '잔잔함'
        : offBow < 0.5 || offBow > 179.5
          ? `${offBow < 90 ? '선수' : '선미'} ${offBow.toFixed(0)}°`
          : `${windFrom > 0 ? '우현' : '좌현'} ${offBow.toFixed(0)}°`,
    );
    const beamOn = offBow >= BEAM_SECTOR_DEG[0] && offBow <= BEAM_SECTOR_DEG[1];
    writeAttribute(this.value, 'data-danger', String(beamOn && wind.speed >= BEAM_WARNING_WIND));
  }
}
