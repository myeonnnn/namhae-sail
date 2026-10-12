import type * as THREE from 'three';
import type { Wind } from '../environment/wind';
import type { ShipControls, ShipState } from '../ship/shipPhysics';
import { Compass } from './compass';

const MS_TO_KNOTS = 1.943844;
const MAX_RUDDER_DEG = 35;
// 이 속력보다 느리면 이동 방향이 불안정하므로 대지 침로를 표시하지 않는다. 나침반의 기준과 동일하다.
const MIN_COURSE_SPEED = 0.2;

/** 조종하는 동안 계속 확인하는 값을 모은 계기판. 아래쪽에는 조종에 쓰는 기본 키만 표시하고, 전체 목록은 설정 메뉴에 둔다. */
export class Instruments {
  private readonly compass = new Compass();
  private readonly speed: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly course: HTMLElement;
  private readonly throttleFill: HTMLElement;
  private readonly throttleValue: HTMLElement;
  private readonly rudderFill: HTMLElement;
  private readonly rudderValue: HTMLElement;

  constructor(root: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-instruments';
    panel.innerHTML = `
      <div class="hud-gauges">
        <div class="hud-bearing">
          <div data-ref="compass"></div>
          <div class="hud-bearing-values">
            <div>
              <div class="hud-label">선수</div>
              <div class="hud-value" data-ref="heading"></div>
            </div>
            <div class="hud-bearing-course">
              <div class="hud-label">대지</div>
              <div class="hud-value" data-ref="course"></div>
            </div>
          </div>
        </div>
        <div class="hud-readouts">
          <div class="hud-label">속력</div>
          <div class="hud-speed"><span data-ref="speed"></span><small>kn</small></div>
        </div>
        <div class="hud-throttle">
          <div class="hud-throttle-track"><div class="hud-throttle-fill"></div></div>
          <div class="hud-label">스로틀</div>
          <div class="hud-value" data-ref="throttle"></div>
        </div>
      </div>
      <div class="hud-rudder">
        <div class="hud-rudder-head">
          <span class="hud-label">타각</span>
          <span class="hud-value" data-ref="rudder"></span>
        </div>
        <div class="hud-rudder-track"><div class="hud-rudder-fill"></div></div>
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
    this.throttleFill = panel.querySelector<HTMLElement>('.hud-throttle-fill')!;
    this.rudderFill = panel.querySelector<HTMLElement>('.hud-rudder-fill')!;
    ref('compass').append(this.compass.element);

    root.append(panel);
  }

  update(camera: THREE.Camera, state: ShipState, controls: ShipControls, wind: Wind): void {
    const speed = Math.hypot(state.surge, state.sway) * Math.sign(state.surge || 1);
    this.speed.textContent = (speed * MS_TO_KNOTS).toFixed(1);

    // 선수 방위는 선수가 가리키는 방향이고, 대지 침로는 배가 실제로 이동하는 방향이다.
    // 선회하거나 바람에 밀릴 때 두 값이 벌어진다.
    this.heading.textContent = formatBearing(state.heading);
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    const east = state.surge * sin + state.sway * cos;
    const north = state.surge * cos - state.sway * sin;
    this.course.textContent =
      Math.hypot(east, north) < MIN_COURSE_SPEED ? '---°' : formatBearing(Math.atan2(east, north));

    // 막대는 가운데가 중립이며, 전진은 위쪽으로, 후진은 아래쪽으로 채운다.
    const throttle = controls.throttle;
    this.throttleFill.style.height = `${Math.abs(throttle) * 50}%`;
    this.throttleFill.style.bottom = throttle >= 0 ? '50%' : `${50 - Math.abs(throttle) * 50}%`;
    this.throttleFill.dataset['direction'] = throttle >= 0 ? 'ahead' : 'astern';
    this.throttleValue.textContent = `${(throttle * 100).toFixed(0)}%`;

    // 좌현은 붉은색, 우현은 녹색으로 표시한다. 선박의 항해등과 동일한 색상 규약이다.
    const rudder = controls.rudder;
    const rudderDeg = rudder * MAX_RUDDER_DEG;
    this.rudderFill.style.width = `${Math.abs(rudder) * 50}%`;
    this.rudderFill.style.left = rudder >= 0 ? '50%' : `${50 - Math.abs(rudder) * 50}%`;
    this.rudderFill.dataset['side'] = rudder >= 0 ? 'starboard' : 'port';
    this.rudderValue.textContent =
      Math.abs(rudderDeg) < 0.5 ? '중앙' : `${rudderDeg > 0 ? '우현' : '좌현'} ${Math.abs(rudderDeg).toFixed(0)}°`;

    this.compass.update(camera, state, wind);
  }
}

/** 라디안 각도를 항해에서 사용하는 세 자리의 방위로 표시한다. */
function formatBearing(radians: number): string {
  const degrees = Math.round((radians * 180) / Math.PI);
  return `${String(((degrees % 360) + 360) % 360).padStart(3, '0')}°`;
}
