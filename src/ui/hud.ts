import type * as THREE from 'three';
import type { TimeOfDay } from '../environment/sun';
import type { Course } from '../course/course';
import type { Weather } from '../environment/weather';
import type { Wind } from '../environment/wind';
import type { ShipControls, ShipState } from '../ship/shipPhysics';
import { Compass } from './compass';
import { EnvironmentPanel } from './environmentPanel';
import { Instruments } from './instruments';
import { Minimap } from './minimap';
import { Radar, type RadarProbe } from './radar';
import { DropdownMenu } from './dropdownMenu';

// 충돌이 해소된 뒤에도 경고를 잠시 유지해서, 깜빡이지 않고 읽을 수 있게 한다.
const ALERT_HOLD_MS = 1500;
// 조종 요령의 조언을 표시하는 시간 (ms). 달리면서 읽을 수 있을 만큼 길게 둔다.
const TIP_HOLD_MS = 7000;
const CONSOLE_MARGIN = 16;
// 조작대의 높이는 화면 높이의 이 비율을 넘지 않는다.
const MAX_CONSOLE_HEIGHT_RATIO = 0.3;

export interface HudFrame {
  frameTime: number;
  camera: THREE.Camera;
  state: ShipState;
  controls: ShipControls;
  wind: Wind;
  engine: { rpm: number; maxRpm: number };
  /** 횡경사 (rad). 우현 쪽으로 기울어지면 양수이다. */
  heel: number;
  /** 바람이 육지에 막히지 않고 불어온 거리 (m) */
  fetch: number;
  /** 선체의 길이 (m). 레이더가 자선을 영상에서 제외하는 데 사용한다. */
  shipLength: number;
  /** 가장 최근의 충돌에 대한 경고 문구와 그 시각 (performance.now 기준). 충돌한 적이 없으면 시각이 -Infinity이다. */
  alert: { message: string; at: number };
  /** 관찰 모드에서 카메라가 보고 있는 지점. 관찰 모드가 아니면 지정하지 않는다. */
  focus?: { x: number; z: number };
}

/** 왼쪽 위에 나란히 놓는 메뉴 */
export type MenuId = 'race' | 'start' | 'help' | 'dev';
const MENU_LABELS: Record<MenuId, string> = { race: '타임어택', start: '시작 위치', help: '도움말', dev: '개발 도구' };
// 왼쪽부터 놓는 순서
const MENU_ORDER: MenuId[] = ['race', 'start', 'help', 'dev'];

/**
 * 화면 위의 표시 장치를 배치한다.
 * 아래쪽 가운데에는 지도와 레이더, 계기판을 나란히 붙여서 두고, 왼쪽 위에는 역할별 메뉴를, 오른쪽 위에는 환경을,
 * 위쪽 가운데에는 경고를 둔다.
 */
export class Hud {
  private readonly minimap: Minimap;
  private readonly instruments: Instruments;
  private readonly compass = new Compass();
  private readonly radar: Radar;
  private readonly alert = document.createElement('div');
  private readonly tip = document.createElement('div');
  private tipUntil = 0;
  private readonly bottom = document.createElement('div');
  private readonly modeHint = document.createElement('div');
  private readonly menuBar = document.createElement('div');
  private readonly menus: Partial<Record<MenuId, DropdownMenu>> = {};
  private readonly environment: EnvironmentPanel;

  constructor(
    private readonly root: HTMLElement,
    private readonly weather: Weather,
    timeOfDay: TimeOfDay,
    radarProbe: RadarProbe,
  ) {
    const { bottom } = this;
    bottom.className = 'hud-bottom';
    this.minimap = new Minimap(bottom);

    // 레이더는 지도와 같은 크기의 패널로 지도의 옆에 둔다.
    const radarPanel = document.createElement('div');
    radarPanel.className = 'hud-panel hud-radar-panel';
    const radarRange = document.createElement('div');
    radarRange.className = 'hud-radar-range';
    this.radar = new Radar(radarProbe, (nauticalMiles) => {
      radarRange.textContent = `탐지 거리 ${nauticalMiles} 해리 (${(nauticalMiles * 1.852).toFixed(1)} km) · 휠로 조절`;
    });
    radarPanel.append(this.radar.element, radarRange);
    bottom.append(radarPanel);

    this.instruments = new Instruments(bottom);

    // 왼쪽 위의 메뉴는 역할별로 나눈다. 개발 도구의 메뉴는 구역이 추가될 때에만 만들어지므로, 배포한 화면에는 나타나지 않는다.
    this.menuBar.className = 'hud-menus';
    root.append(this.menuBar);

    const right = document.createElement('div');
    right.className = 'hud-column hud-column-right';
    this.environment = new EnvironmentPanel(right, weather, timeOfDay);
    // 나침반은 카메라의 방향을 알려 주는 표시이므로, 조종의 계기와 분리해서 화면의 구석에 둔다.
    const compassPanel = document.createElement('div');
    compassPanel.className = 'hud-panel hud-compass-panel';
    compassPanel.append(this.compass.element);
    right.append(compassPanel);

    this.alert.className = 'hud-alert';
    this.alert.hidden = true;
    this.tip.className = 'hud-tip';
    this.tip.hidden = true;

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

    root.append(bottom, right, this.modeHint, this.alert, this.tip, credits);

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

  /** 왼쪽 위의 메뉴에, 제목을 누르면 펼쳐지는 구역을 추가한다. 내용이 여러 가지인 메뉴에 사용한다. */
  addMenuSection(menu: MenuId, title: string, content: HTMLElement, expanded = false): void {
    this.menu(menu).addSection(title, content, expanded);
  }

  /** 왼쪽 위의 메뉴에 내용을 제목 없이 그대로 넣는다. 내용이 한 가지뿐인 메뉴에 사용한다. */
  setMenuContent(menu: MenuId, content: HTMLElement): void {
    this.menu(menu).setContent(content);
  }

  /** 메뉴가 아직 없으면 만든다. 개발 도구의 메뉴가 배포한 화면에 나타나지 않는 것은, 그 내용을 넣는 코드가 실행되지 않기 때문이다. */
  private menu(id: MenuId): DropdownMenu {
    return (this.menus[id] ??= new DropdownMenu(this.menuBar, MENU_LABELS[id], MENU_ORDER.indexOf(id)));
  }

  closeMenus(): void {
    for (const menu of Object.values(this.menus)) menu.close();
  }

  /** 조종 요령의 조언을 조작대의 바로 위에 한 줄로 잠시 표시한다. */
  showTip(text: string): void {
    this.tip.textContent = text;
    this.tip.style.bottom = `${Math.round(this.consoleHeight + 10)}px`;
    this.tip.hidden = false;
    this.tipUntil = performance.now() + TIP_HOLD_MS;
  }

  /** 타임어택의 코스를 지도에 표시한다. 코스를 지정하지 않으면 지운다. 도전하는 동안에는 파도의 세기를 바꿀 수 없게 한다. */
  setCourse(course?: Course): void {
    this.minimap.setCourse(course);
    this.root.classList.toggle('hud-racing', course !== undefined);
  }

  /** 다음에 지나야 하는 관문을 지도에서 강조한다. */
  setNextGate(index: number): void {
    this.minimap.setNextGate(index);
  }

  /** 배를 다른 곳으로 옮겼을 때 지도의 항적을 지운다. */
  resetTrack(): void {
    this.minimap.resetTrack();
  }

  update({ frameTime, camera, state, controls, wind, engine, heel, fetch, shipLength, alert, focus }: HudFrame): void {
    this.minimap.update(state, focus);
    this.modeHint.hidden = !focus;
    this.instruments.update(state, controls, wind, engine, heel, this.weather.swell);
    this.environment.update(fetch);
    this.radar.update(frameTime, state, shipLength);
    this.compass.update(camera, state);
    if (!this.tip.hidden && performance.now() > this.tipUntil) this.tip.hidden = true;
    this.alert.hidden = performance.now() - alert.at > ALERT_HOLD_MS;
    if (!this.alert.hidden && this.alert.textContent !== alert.message) this.alert.textContent = alert.message;
  }
}
