import { SEA_LEVELS, selectSeaLevel, type SeaState } from '../environment/seaState';
import { sunPosition, type TimeOfDay } from '../environment/sun';
import { MAX_SWELL_HEIGHT, type Swell } from '../environment/swell';
import { compassName, MAX_WIND_SPEED, WIND_DIRECTION_STEP, type Wind } from '../environment/wind';
import { WORLD_ORIGIN } from '../geo/projection';
import { formatBearing, MS_TO_KNOTS } from '../geo/units';
import { currentWaveHeight } from '../ocean/waves';
import { OPEN_SEA_FETCH } from '../world/shelter';
import { createButton } from './dom';

// 조절 막대 세 개를 나란히 그린 아이콘. 값을 조정하는 설정을 나타내는 데 널리 쓰이는 형태이다.
const SLIDERS_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <path d="M2 4h5M11 4h3M2 8h1M7 8h7M2 12h7M13 12h1" />
    <circle cx="9" cy="4" r="1.8" />
    <circle cx="5" cy="8" r="1.8" />
    <circle cx="11" cy="12" r="1.8" />
  </svg>`;
const TOGGLE_LABEL = '시각과 바람, 너울을 직접 조절 (개발용)';
// 파도의 높이는 배가 움직이는 동안 서서히 변하므로, 이 간격(ms)으로만 표시를 갱신한다.
const REFRESH_INTERVAL_MS = 500;

// 시각과 바람, 너울을 하나씩 조절하는 막대는 로컬의 개발 서버에서만 보인다.
const DEV_CONTROLS = import.meta.env.DEV;

/**
 * 시각과 바람, 파도의 상태를 요약해서 표시하고, 파도의 세기를 다섯 단계 가운데에서 고르게 한다.
 * 개발 서버에서는 값을 하나씩 조절하는 막대가 함께 제공되며, 평소에는 접혀 있다가 버튼을 누르면 펼쳐진다.
 */
/** 날씨를 이루는 값들. 화면의 버튼과 막대가 이 객체들의 값을 직접 변경한다. */
export interface Weather {
  wind: Wind;
  swell: Swell;
  sea: SeaState;
}

export class EnvironmentPanel {
  private readonly timeSummary = document.createElement('div');
  private readonly windSummary = document.createElement('div');
  private readonly waveSummary = document.createElement('div');
  private readonly levelName = document.createElement('span');
  private readonly levelButtons: HTMLButtonElement[] = [];
  /** 값이 밖에서 바뀌었을 때 막대의 위치를 다시 맞추는 함수들 */
  private readonly sliderSyncs: (() => void)[] = [];
  private lastRefreshTime = -Infinity;
  private fetch = 0;

  constructor(
    root: HTMLElement,
    private readonly weather: Weather,
    private readonly timeOfDay: TimeOfDay,
  ) {
    const { wind, swell, sea } = weather;
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-environment';

    const summary = document.createElement('div');
    summary.className = 'hud-environment-summary';
    const lines = document.createElement('div');
    this.windSummary.className = 'hud-environment-wind';
    this.waveSummary.className = 'hud-label';
    this.timeSummary.className = 'hud-environment-wind';
    lines.append(this.timeSummary, this.windSummary, this.waveSummary);

    // 파도의 세기: 단계를 고르면 풍속과 너울의 높이가 함께 바뀐다.
    const levels = document.createElement('div');
    levels.className = 'hud-sea-levels';
    const levelHead = document.createElement('div');
    levelHead.className = 'hud-sea-level-head';
    const levelLabel = document.createElement('span');
    levelLabel.className = 'hud-label';
    levelLabel.textContent = '파도 세기';
    this.levelName.className = 'hud-value';
    levelHead.append(levelLabel, this.levelName);
    const levelRow = document.createElement('div');
    levelRow.className = 'hud-sea-level-buttons';
    SEA_LEVELS.forEach((level, index) => {
      const button = createButton({
        content: String(index + 1),
        label: `${index + 1}단계: ${level.name}`,
        onClick: () => {
          selectSeaLevel(sea, index + 1, wind, swell);
          this.refresh();
        },
      });
      this.levelButtons.push(button);
      levelRow.append(button);
    });
    levels.append(levelHead, levelRow);

    summary.append(lines);
    panel.append(summary, levels);

    if (DEV_CONTROLS) {
      const controls = document.createElement('div');
      controls.className = 'hud-environment-controls';
      controls.hidden = true;
      controls.append(
        this.createSlider(
          '시각',
          5,
          20,
          0.25,
          () => timeOfDay.hour,
          (value) => (timeOfDay.hour = value),
        ),
        this.createSlider(
          '풍속',
          0,
          MAX_WIND_SPEED,
          0.5,
          () => wind.speed,
          (value) => {
            wind.speed = value;
            sea.manual = true;
          },
        ),
        this.createSlider(
          '풍향',
          0,
          360 - WIND_DIRECTION_STEP,
          WIND_DIRECTION_STEP,
          () => wind.fromDeg,
          (value) => (wind.fromDeg = value),
        ),
        this.createSlider(
          '너울',
          0,
          MAX_SWELL_HEIGHT,
          0.25,
          () => swell.height,
          (value) => {
            swell.height = value;
            sea.manual = true;
          },
        ),
        this.createSlider(
          '너울 방향',
          0,
          355,
          5,
          () => swell.fromDeg,
          (value) => (swell.fromDeg = value),
        ),
      );
      const toggle = createButton({
        html: SLIDERS_ICON,
        className: 'hud-icon-button',
        label: TOGGLE_LABEL,
        onClick: () => {
          controls.hidden = !controls.hidden;
          toggle.setAttribute('aria-expanded', String(!controls.hidden));
        },
      });
      toggle.setAttribute('aria-expanded', 'false');
      summary.append(toggle);
      panel.append(controls);
    }

    root.append(panel);
    this.refresh();
  }

  /** @param fetch 바람이 육지에 막히지 않고 불어온 거리 (m) */
  update(fetch: number): void {
    const now = performance.now();
    if (now - this.lastRefreshTime < REFRESH_INTERVAL_MS) return;
    this.lastRefreshTime = now;
    this.fetch = fetch;
    this.refresh();
  }

  private refresh(): void {
    const { hour } = this.timeOfDay;
    const { elevationDeg } = sunPosition(this.timeOfDay, WORLD_ORIGIN);
    const clock = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;
    this.timeSummary.textContent =
      elevationDeg > 0 ? `${clock} · 태양 고도 ${elevationDeg.toFixed(0)}°` : `${clock} · 해가 진 상태`;

    const { wind, swell, sea } = this.weather;
    const { speed, fromDeg } = wind;
    this.windSummary.textContent =
      speed < 0.1
        ? '바람 없음'
        : `${compassName(fromDeg)}풍 ${formatBearing((fromDeg * Math.PI) / 180)} · ${speed.toFixed(1)} m/s (${(speed * MS_TO_KNOTS).toFixed(0)} kn)`;
    // 파도는 바람과 위치가 바뀐 뒤에 서서히 자라므로, 조건으로 계산한 값이 아니라 지금 수면의 값을 표시한다.
    const swellText = swell.height >= 0.05 ? ` · 너울 ${swell.height.toFixed(1)} m` : '';
    const level = sea.manual ? undefined : sea.level;
    this.levelName.textContent = level === undefined ? '직접 조절' : SEA_LEVELS[level - 1].name;
    // 풍속과 너울은 시간에 따라 저절로 변하므로, 개발용 막대의 위치도 따라가게 한다.
    this.sliderSyncs.forEach((sync) => sync());
    this.levelButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index + 1 === level)));
    this.waveSummary.textContent = `유의파고 ${currentWaveHeight().toFixed(1)} m · 취주 ${formatFetch(this.fetch)}${swellText}`;
  }

  private createSlider(
    label: string,
    min: number,
    max: number,
    step: number,
    read: () => number,
    onChange: (value: number) => void,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.className = 'hud-label';
    name.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    // 막대를 끌고 있는 동안에는 손에서 벗어나지 않도록 그대로 둔다.
    const sync = () => {
      if (!slider.matches(':active')) slider.value = String(read());
    };
    sync();
    this.sliderSyncs.push(sync);
    slider.tabIndex = -1;
    slider.addEventListener('input', () => {
      onChange(Number(slider.value));
      this.refresh();
    });
    // 막대에 포커스가 남아 있으면 조종에 사용하는 방향키가 막대의 값을 바꾸게 된다.
    slider.addEventListener('change', () => slider.blur());

    row.append(name, slider);
    return row;
  }
}

/** 취주 거리를 표시한다. 측정의 상한에 닿았으면 육지에 막히지 않은 것이다. */
function formatFetch(meters: number): string {
  if (meters >= OPEN_SEA_FETCH) return '열린 바다';
  return meters < 1000
    ? `${Math.round(meters / 100) * 100} m`
    : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}
