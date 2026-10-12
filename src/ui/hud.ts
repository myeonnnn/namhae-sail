import type * as THREE from 'three';
import type { Wind } from '../environment/wind';
import type { ShipControls, ShipState } from '../ship/shipPhysics';
import { EnvironmentPanel } from './environmentPanel';
import { Instruments } from './instruments';
import { createKeyGuide } from './keyGuide';
import { Minimap } from './minimap';
import { SettingsMenu } from './settingsMenu';

// 좌초가 해소된 뒤에도 경고를 잠시 유지해서, 깜빡이지 않고 읽을 수 있게 한다.
const ALERT_HOLD_MS = 1500;

export interface HudFrame {
  camera: THREE.Camera;
  state: ShipState;
  controls: ShipControls;
  wind: Wind;
  /** 선체가 육지에 닿은 마지막 시각 (performance.now 기준). 닿은 적이 없으면 -Infinity이다. */
  lastGroundedAt: number;
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

  constructor(root: HTMLElement, wind: Wind) {
    const bottom = document.createElement('div');
    bottom.className = 'hud-bottom';
    this.minimap = new Minimap(bottom);
    this.instruments = new Instruments(bottom);

    const settings = new SettingsMenu(root);
    settings.addSection('조작키', createKeyGuide(), true);

    const right = document.createElement('div');
    right.className = 'hud-column hud-column-right';
    new EnvironmentPanel(right, wind);

    this.alert.className = 'hud-alert';
    this.alert.textContent = '좌초: 후진(S)으로 이탈';
    this.alert.hidden = true;

    root.append(bottom, right, this.alert);
  }

  update({ camera, state, controls, wind, lastGroundedAt }: HudFrame): void {
    this.minimap.update(state);
    this.instruments.update(camera, state, controls, wind);
    this.alert.hidden = performance.now() - lastGroundedAt > ALERT_HOLD_MS;
  }
}
