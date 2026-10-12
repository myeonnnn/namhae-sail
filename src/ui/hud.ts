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
  /** 관찰 모드에서 카메라가 보고 있는 지점. 관찰 모드가 아니면 지정하지 않는다. */
  focus?: { x: number; z: number };
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
  private readonly modeHint = document.createElement('div');
  private readonly settings: SettingsMenu;

  constructor(root: HTMLElement, wind: Wind, timeOfDay: TimeOfDay) {
    const { bottom } = this;
    bottom.className = 'hud-bottom';
    this.minimap = new Minimap(bottom);
    this.instruments = new Instruments(bottom);

    this.settings = new SettingsMenu(root);
    this.settings.addSection('조작키', createKeyGuide(), true);

    const right = document.createElement('div');
    right.className = 'hud-column hud-column-right';
    new EnvironmentPanel(right, wind, timeOfDay);

    this.alert.className = 'hud-alert';
    this.alert.hidden = true;

    this.modeHint.className = 'hud-mode-hint';
    // 관찰 모드는 개발 서버에서만 켜지므로, 안내의 문구도 배포용 빌드에는 넣지 않는다.
    if (import.meta.env.DEV) {
      this.modeHint.innerHTML =
        '<strong>관찰 모드</strong> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동 · <kbd>Shift</kbd> 빠르게 · 드래그 회전 · 휠 거리 · <kbd>T</kbd> 배를 이 위치로 · <kbd>F</kbd> 종료';
    }
    this.modeHint.hidden = true;

    // 지도 안의 출처 표기는 OpenStreetMap만 다루므로, 3D 지형에 사용한 표고 자료의 출처는 화면의 구석에 따로 표기한다.
    const credits = document.createElement('div');
    credits.className = 'hud-credits';
    credits.textContent = '지형 표고: Mapzen Terrain Tiles, NASA SRTM · 지도 자료 © OpenStreetMap contributors';

    root.append(bottom, right, this.modeHint, this.alert, credits);

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

  /** 설정 메뉴에 구역을 추가한다. */
  addSettingsSection(title: string, content: HTMLElement): void {
    this.settings.addSection(title, content);
  }

  /** 배를 다른 곳으로 옮겼을 때 지도의 항적을 지운다. */
  resetTrack(): void {
    this.minimap.resetTrack();
  }

  update({ camera, state, controls, wind, engine, alert, focus }: HudFrame): void {
    this.minimap.update(state, focus);
    this.modeHint.hidden = !focus;
    this.instruments.update(camera, state, controls, wind, engine);
    this.alert.hidden = performance.now() - alert.at > ALERT_HOLD_MS;
    if (!this.alert.hidden && this.alert.textContent !== alert.message) this.alert.textContent = alert.message;
  }
}
