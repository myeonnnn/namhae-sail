import type * as THREE from 'three';
import type { TimeOfDay } from '../environment/sun';
import type { Wind } from '../environment/wind';
import type { ShipControls, ShipState } from '../ship/shipPhysics';
import { EnvironmentPanel } from './environmentPanel';
import { Instruments } from './instruments';
import { createKeyGuide } from './keyGuide';
import { Minimap } from './minimap';
import { SettingsMenu } from './settingsMenu';

// 충돌이 해소된 뒤에도 경고를 잠시 유지해서, 깜빡이지 않고 읽을 수 있게 한다.
const ALERT_HOLD_MS = 1500;
const CONSOLE_MARGIN = 16;
// 조작대의 높이는 화면 높이의 이 비율을 넘지 않는다.
const MAX_CONSOLE_HEIGHT_RATIO = 0.3;

export interface HudFrame {
  camera: THREE.Camera;
  state: ShipState;
  controls: ShipControls;
  wind: Wind;
  engine: { rpm: number; maxRpm: number };
  /** 가장 최근의 충돌에 대한 경고 문구와 그 시각 (performance.now 기준). 충돌한 적이 없으면 시각이 -Infinity이다. */
  alert: { message: string; at: number };
}

/**
 * 화면 위의 표시 장치를 배치한다.
 * 아래쪽 가운데에는 지도와 계기판을 나란히 붙여서 두고, 왼쪽 위에는 설정 메뉴를, 오른쪽 위에는 환경을,
 * 위쪽 가운데에는 경고를 둔다.
 */
export class Hud {
  private readonly minimap: Minimap;
  private readonly instruments: Instruments;
  private readonly alert = document.createElement('div');
  private readonly bottom = document.createElement('div');

  constructor(root: HTMLElement, wind: Wind, timeOfDay: TimeOfDay) {
    const { bottom } = this;
    bottom.className = 'hud-bottom';
    this.minimap = new Minimap(bottom);
    this.instruments = new Instruments(bottom);

    const settings = new SettingsMenu(root);
    settings.addSection('조작키', createKeyGuide(), true);

    const right = document.createElement('div');
    right.className = 'hud-column hud-column-right';
    new EnvironmentPanel(right, wind, timeOfDay);

    this.alert.className = 'hud-alert';
    this.alert.hidden = true;

    root.append(bottom, right, this.alert);

    window.addEventListener('resize', () => this.fitConsole());
    this.fitConsole();
  }

  /** 조작대가 화면에서 차지하는 높이 (픽셀). 카메라가 배를 조작대에 가려지지 않는 위치에 두는 데 사용한다. */
  get consoleHeight(): number {
    return this.bottom.getBoundingClientRect().height + CONSOLE_MARGIN;
  }

  /** 화면이 좁거나 낮으면 조작대 전체를 같은 비율로 줄여서, 화면 밖으로 나가거나 화면을 지나치게 가리지 않게 한다. */
  private fitConsole(): void {
    const { offsetWidth: width, offsetHeight: height } = this.bottom;
    const scale = Math.min(
      1,
      (window.innerWidth - CONSOLE_MARGIN * 2) / width,
      (window.innerHeight * MAX_CONSOLE_HEIGHT_RATIO) / height,
    );
    this.bottom.style.setProperty('--hud-console-scale', scale.toFixed(3));
  }

  update({ camera, state, controls, wind, engine, alert }: HudFrame): void {
    this.minimap.update(state);
    this.instruments.update(camera, state, controls, wind, engine);
    this.alert.hidden = performance.now() - alert.at > ALERT_HOLD_MS;
    if (!this.alert.hidden && this.alert.textContent !== alert.message) this.alert.textContent = alert.message;
  }
}
