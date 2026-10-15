import { SEA_LEVELS, selectSeaLevel } from '../environment/seaState';
import { sunPosition, type TimeOfDay } from '../environment/sun';
import type { Weather } from '../environment/weather';
import { compassName } from '../environment/wind';
import { WORLD_ORIGIN } from '../geo/projection';
import { formatBearing, MS_TO_KNOTS } from '../geo/units';
import { currentWaveHeight } from '../ocean/waves';
import { OPEN_SEA_FETCH } from '../world/shelter';
import { createButton, writeAttribute, writeText } from './dom';
import { createEnvironmentDevControls } from './environmentDevControls';

// 파도의 높이는 배가 움직이는 동안 서서히 변하므로, 이 간격(ms)으로만 표시를 갱신한다.
const REFRESH_INTERVAL_MS = 500;

// 시각과 바람, 너울을 하나씩 조절하는 막대는 로컬의 개발 서버에서만 보인다.
const DEV_CONTROLS = import.meta.env.DEV;

/**
 * 시각과 바람, 파도의 상태를 요약해서 표시하고, 파도의 세기를 다섯 단계 가운데에서 고르게 한다.
 * 개발 서버에서는 값을 하나씩 조절하는 막대(environmentDevControls.ts)가 함께 제공된다.
 */
export class EnvironmentPanel {
  private readonly timeSummary = document.createElement('div');
  private readonly windSummary = document.createElement('div');
  private readonly waveSummary = document.createElement('div');
  private readonly levelName = document.createElement('span');
  private readonly levelButtons: HTMLButtonElement[] = [];
  /** 개발용 막대의 위치를 지금의 값에 맞춘다. 막대가 없으면 아무것도 하지 않는다. */
  private syncDevControls: () => void = () => {};
  private lastRefreshTime = -Infinity;
  private fetch = 0;

  constructor(
    root: HTMLElement,
    private readonly weather: Weather,
    private readonly timeOfDay: TimeOfDay,
  ) {
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
        onClick: () => this.selectLevel(index + 1),
      });
      this.levelButtons.push(button);
      levelRow.append(button);
    });
    levels.append(levelHead, levelRow);

    summary.append(lines);
    panel.append(summary, levels);

    if (DEV_CONTROLS) {
      const dev = createEnvironmentDevControls(weather, timeOfDay, () => this.refresh());
      summary.append(dev.toggle);
      panel.append(dev.element);
      this.syncDevControls = dev.sync;
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

  /** 파도 세기(1~5)를 바꾼다. 버튼을 눌렀을 때와 핸드폰에서 바꿀 때 같은 일을 한다. */
  selectLevel(level: number): void {
    const { sea, wind, swell } = this.weather;
    selectSeaLevel(sea, level, wind, swell);
    this.refresh();
  }

  private refresh(): void {
    const { hour } = this.timeOfDay;
    const { elevationDeg } = sunPosition(this.timeOfDay, WORLD_ORIGIN);
    const clock = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;
    writeText(
      this.timeSummary,
      elevationDeg > 0 ? `${clock} · 태양 고도 ${elevationDeg.toFixed(0)}°` : `${clock} · 해가 진 상태`,
    );

    const { wind, swell, sea } = this.weather;
    const { speed, fromDeg } = wind;
    writeText(
      this.windSummary,
      speed < 0.1
        ? '바람 없음'
        : `${compassName(fromDeg)}풍 ${formatBearing((fromDeg * Math.PI) / 180)} · ${speed.toFixed(1)} m/s (${(speed * MS_TO_KNOTS).toFixed(0)} kn)`,
    );
    // 파도는 바람과 위치가 바뀐 뒤에 서서히 자라므로, 조건으로 계산한 값이 아니라 지금 수면의 값을 표시한다.
    const swellText = swell.height >= 0.05 ? ` · 너울 ${swell.height.toFixed(1)} m` : '';
    const level = sea.manual ? undefined : sea.level;
    writeText(this.levelName, level === undefined ? '직접 조절' : SEA_LEVELS[level - 1].name);
    // 풍속과 너울은 시간에 따라 저절로 변하므로, 개발용 막대의 위치도 따라가게 한다.
    this.syncDevControls();
    this.levelButtons.forEach((button, index) => writeAttribute(button, 'aria-pressed', String(index + 1 === level)));
    writeText(
      this.waveSummary,
      `유의파고 ${currentWaveHeight().toFixed(1)} m · 취주 ${formatFetch(this.fetch)}${swellText}`,
    );
  }
}

/** 취주 거리를 표시한다. 측정의 상한에 닿았으면 육지에 막히지 않은 것이다. */
function formatFetch(meters: number): string {
  if (meters >= OPEN_SEA_FETCH) return '열린 바다';
  return meters < 1000
    ? `${Math.round(meters / 100) * 100} m`
    : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}
