import type { Swell } from '../environment/swell';
import { windVelocity, type Wind } from '../environment/wind';
import { formatBearing, MS_TO_KNOTS } from '../geo/units';
import { apparentWind, type ShipControls, type ShipState } from '../ship/shipPhysics';
import { Inclinometer, SeaDirectionDial } from './dials';
import { writeAttribute, writeText } from './dom';

const MAX_RUDDER_DEG = 35;
// 이 속력보다 느리면 이동 방향이 불안정하므로 대지 침로를 표시하지 않는다. 나침반의 기준과 동일하다.
const MIN_COURSE_SPEED = 0.2;

// 회전계의 눈금은 왼쪽 아래(135°)에서 시작해서 시계 방향으로 270°를 돌아서 오른쪽 아래에서 끝난다.
const TACH_START_DEG = 135;
const TACH_SWEEP_DEG = 270;
const TACH_CENTER = 36;
const TACH_RADIUS = 28;
// 최대 회전수의 이 비율부터는 붉은색 구간으로 표시한다.
const TACH_REDLINE = 0.88;

/** 회전계의 눈금을 따라 ratio(0~1) 구간의 호를 그리는 SVG 경로 */
function tachArc(from: number, to: number): string {
  const point = (ratio: number) => {
    const angle = ((TACH_START_DEG + TACH_SWEEP_DEG * ratio) * Math.PI) / 180;
    return `${(TACH_CENTER + TACH_RADIUS * Math.cos(angle)).toFixed(2)} ${(TACH_CENTER + TACH_RADIUS * Math.sin(angle)).toFixed(2)}`;
  };
  const largeArc = (to - from) * TACH_SWEEP_DEG > 180 ? 1 : 0;
  return `M ${point(from)} A ${TACH_RADIUS} ${TACH_RADIUS} 0 ${largeArc} 1 ${point(to)}`;
}

/** 조종하는 동안 계속 확인하는 값을 모은 계기판. 아래쪽에는 조종에 쓰는 기본 키만 표시하고, 전체 목록은 설정 메뉴에 둔다. */
export class Instruments {
  private readonly speed: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly course: HTMLElement;
  private readonly throttleFill: HTMLElement;
  private readonly throttleValue: HTMLElement;
  private readonly rudderFill: HTMLElement;
  private readonly rudderValue: HTMLElement;
  private readonly tachNeedle: HTMLElement;
  private readonly rpmValue: HTMLElement;
  private readonly apparentArrow: HTMLElement;
  private readonly apparentValue: HTMLElement;
  private readonly inclinometer: Inclinometer;
  private readonly seaDirection: SeaDirectionDial;

  constructor(root: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-instruments';
    // 모든 계기는 "이름표, 그 아래에 값"의 순서를 따른다. 그림이 있는 계기는 그림을 맨 위에 둔다.
    panel.innerHTML = `
      <div class="hud-gauges">
        <div class="hud-readouts">
          <div class="hud-label">속력</div>
          <div class="hud-speed"><span data-ref="speed"></span><small>kn</small></div>
          <div class="hud-bearings">
            <div>
              <div class="hud-label">선수 방위</div>
              <div class="hud-value" data-ref="heading"></div>
            </div>
            <div class="hud-bearing-course">
              <div class="hud-label">대지 침로</div>
              <div class="hud-value" data-ref="course"></div>
            </div>
          </div>
        </div>
        <div class="hud-dial">
          <svg viewBox="0 0 72 58" width="72" height="58">
            <path class="hud-tach-track" d="${tachArc(0, TACH_REDLINE)}" />
            <path class="hud-tach-redline" d="${tachArc(TACH_REDLINE, 1)}" />
            <line class="hud-tach-needle" data-ref="needle" x1="${TACH_CENTER}" y1="${TACH_CENTER}" x2="${TACH_CENTER + TACH_RADIUS - 5}" y2="${TACH_CENTER}" />
            <circle class="hud-tach-hub" cx="${TACH_CENTER}" cy="${TACH_CENTER}" r="3" />
          </svg>
          <div class="hud-label">엔진 회전수</div>
          <div class="hud-value"><span data-ref="rpm"></span> rpm</div>
        </div>
        ${Inclinometer.MARKUP}
        ${SeaDirectionDial.MARKUP}
        <div class="hud-dial">
          <div class="hud-throttle-track"><div class="hud-throttle-fill"></div></div>
          <div class="hud-label">스로틀</div>
          <div class="hud-value" data-ref="throttle"></div>
        </div>
      </div>
      <div class="hud-strip">
        <div class="hud-apparent">
          <svg viewBox="0 0 40 40" width="34" height="34">
            <circle class="hud-apparent-ring" cx="20" cy="20" r="18" />
            <path class="hud-apparent-hull" d="M20 9 C25 15 25 25 23 31 L17 31 C15 25 15 15 20 9 Z" />
            <g data-ref="apparentArrow">
              <path class="hud-apparent-arrow" d="M18.7 2 L21.3 2 L21.3 8 L24 8 L20 15 L16 8 L18.7 8 Z" />
            </g>
          </svg>
          <div>
            <div class="hud-label">겉보기 바람</div>
            <div class="hud-value" data-ref="apparent"></div>
          </div>
        </div>
        <div class="hud-rudder">
          <div class="hud-rudder-head">
            <span class="hud-label">타각</span>
            <span class="hud-value" data-ref="rudder"></span>
          </div>
          <div class="hud-rudder-track"><div class="hud-rudder-fill"></div></div>
        </div>
      </div>
      <div class="hud-key-hints">
        <span><kbd>W</kbd><kbd>S</kbd>스로틀</span>
        <span><kbd>A</kbd><kbd>D</kbd>타</span>
        <span><kbd>Space</kbd>중립</span>
      </div>
    `;
    const ref = (name: string) => panel.querySelector<HTMLElement>(`[data-ref="${name}"]`)!;
    this.speed = ref('speed');
    this.heading = ref('heading');
    this.course = ref('course');
    this.throttleValue = ref('throttle');
    this.rudderValue = ref('rudder');
    this.tachNeedle = ref('needle');
    this.rpmValue = ref('rpm');
    this.apparentArrow = ref('apparentArrow');
    this.apparentValue = ref('apparent');
    this.inclinometer = new Inclinometer(panel);
    this.seaDirection = new SeaDirectionDial(panel);
    this.throttleFill = panel.querySelector<HTMLElement>('.hud-throttle-fill')!;
    this.rudderFill = panel.querySelector<HTMLElement>('.hud-rudder-fill')!;

    root.append(panel);
  }

  update(
    state: ShipState,
    controls: ShipControls,
    wind: Wind,
    engine: { rpm: number; maxRpm: number },
    /** 횡경사 (rad). 우현 쪽으로 기울어지면 양수이다. */
    heel: number,
    swell: Swell,
  ): void {
    const speed = Math.hypot(state.surge, state.sway) * Math.sign(state.surge || 1);
    writeText(this.speed, (speed * MS_TO_KNOTS).toFixed(1));

    // 선수 방위는 선수가 가리키는 방향이고, 대지 침로는 배가 실제로 이동하는 방향이다.
    // 선회하거나 바람에 밀릴 때 두 값이 벌어진다.
    writeText(this.heading, formatBearing(state.heading));
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    const east = state.surge * sin + state.sway * cos;
    const north = state.surge * cos - state.sway * sin;
    writeText(
      this.course,
      Math.hypot(east, north) < MIN_COURSE_SPEED ? '---°' : formatBearing(Math.atan2(east, north)),
    );

    // 막대는 가운데가 중립이며, 전진은 위쪽으로, 후진은 아래쪽으로 채운다.
    const throttle = controls.throttle;
    this.throttleFill.style.height = `${Math.abs(throttle) * 50}%`;
    this.throttleFill.style.bottom = throttle >= 0 ? '50%' : `${50 - Math.abs(throttle) * 50}%`;
    writeAttribute(this.throttleFill, 'data-direction', throttle >= 0 ? 'ahead' : 'astern');
    writeText(
      this.throttleValue,
      throttle === 0 ? '중립' : `${throttle > 0 ? '전진' : '후진'} ${Math.abs(throttle * 100).toFixed(0)}%`,
    );

    // 좌현은 붉은색, 우현은 녹색으로 표시한다. 선박의 항해등과 동일한 색상 규약이다.
    const rudder = controls.rudder;
    const rudderDeg = rudder * MAX_RUDDER_DEG;
    this.rudderFill.style.width = `${Math.abs(rudder) * 50}%`;
    this.rudderFill.style.left = rudder >= 0 ? '50%' : `${50 - Math.abs(rudder) * 50}%`;
    writeAttribute(this.rudderFill, 'data-side', rudder >= 0 ? 'starboard' : 'port');
    writeText(
      this.rudderValue,
      Math.abs(rudderDeg) < 0.5 ? '중앙' : `${rudderDeg > 0 ? '우현' : '좌현'} ${Math.abs(rudderDeg).toFixed(0)}°`,
    );

    const rpmRatio = Math.min(engine.rpm / engine.maxRpm, 1);
    writeAttribute(
      this.tachNeedle,
      'transform',
      `rotate(${(TACH_START_DEG + TACH_SWEEP_DEG * rpmRatio).toFixed(1)} ${TACH_CENTER} ${TACH_CENTER})`,
    );
    writeText(this.rpmValue, Math.round(engine.rpm).toLocaleString('en-US'));

    this.inclinometer.update(heel);
    this.seaDirection.update(state.heading, wind, swell);

    // 풍향계와 같은 방식으로, 선수를 기준으로 바람이 불어오는 쪽의 각도를 표시한다.
    // 공기가 이동하는 방향의 반대쪽이 바람이 불어오는 쪽이다.
    const apparent = apparentWind(state, windVelocity(wind));
    const apparentSpeed = Math.hypot(apparent.forward, apparent.starboard);
    const fromAngle = (Math.atan2(-apparent.starboard, -apparent.forward) * 180) / Math.PI;
    writeAttribute(this.apparentArrow, 'transform', `rotate(${fromAngle.toFixed(1)} 20 20)`);
    writeAttribute(this.apparentArrow, 'visibility', apparentSpeed < 0.3 ? 'hidden' : 'visible');
    const side = Math.abs(fromAngle) < 0.5 || Math.abs(fromAngle) > 179.5 ? '' : fromAngle > 0 ? '우현 ' : '좌현 ';
    writeText(
      this.apparentValue,
      apparentSpeed < 0.3 ? '없음' : `${side}${Math.abs(fromAngle).toFixed(0)}° · ${apparentSpeed.toFixed(1)} m/s`,
    );
  }
}
