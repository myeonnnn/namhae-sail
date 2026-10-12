import { sunPosition, type TimeOfDay } from '../environment/sun';
import { compassName, MAX_WIND_SPEED, type Wind } from '../environment/wind';
import { WORLD_ORIGIN } from '../geo/projection';
import { formatBearing, MS_TO_KNOTS } from '../geo/units';
import { significantWaveHeight } from '../ocean/waves';
import { createButton } from './dom';

// 조절 막대 세 개를 나란히 그린 아이콘. 값을 조정하는 설정을 나타내는 데 널리 쓰이는 형태이다.
const SLIDERS_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <path d="M2 4h5M11 4h3M2 8h1M7 8h7M2 12h7M13 12h1" />
    <circle cx="9" cy="4" r="1.8" />
    <circle cx="5" cy="8" r="1.8" />
    <circle cx="11" cy="12" r="1.8" />
  </svg>`;
const TOGGLE_LABEL = '시각과 바람 설정';

/**
 * 시각과 바람, 파도의 상태를 요약해서 표시한다.
 * 조절 막대는 평소에는 접혀 있고, 버튼을 누르면 펼쳐진다. 값을 바꾸면 전달받은 객체에 즉시 반영한다.
 */
export class EnvironmentPanel {
  private readonly timeSummary = document.createElement('div');
  private readonly windSummary = document.createElement('div');
  private readonly waveSummary = document.createElement('div');

  constructor(
    root: HTMLElement,
    private readonly wind: Wind,
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

    const controls = document.createElement('div');
    controls.className = 'hud-environment-controls';
    controls.hidden = true;
    controls.append(
      this.createSlider('시각', 5, 20, 0.25, timeOfDay.hour, (value) => (timeOfDay.hour = value)),
      this.createSlider('풍속', 0, MAX_WIND_SPEED, 0.5, wind.speed, (value) => (wind.speed = value)),
      this.createSlider('풍향', 0, 355, 5, wind.fromDeg, (value) => (wind.fromDeg = value)),
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

    summary.append(lines, toggle);
    panel.append(summary, controls);
    root.append(panel);
    this.refresh();
  }

  private refresh(): void {
    const { hour } = this.timeOfDay;
    const { elevationDeg } = sunPosition(this.timeOfDay, WORLD_ORIGIN);
    const clock = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;
    this.timeSummary.textContent =
      elevationDeg > 0 ? `${clock} · 태양 고도 ${elevationDeg.toFixed(0)}°` : `${clock} · 해가 진 상태`;

    const { speed, fromDeg } = this.wind;
    this.windSummary.textContent =
      speed < 0.1
        ? '바람 없음'
        : `${compassName(fromDeg)}풍 ${formatBearing((fromDeg * Math.PI) / 180)} · ${speed.toFixed(1)} m/s (${(speed * MS_TO_KNOTS).toFixed(0)} kn)`;
    this.waveSummary.textContent = `유의파고 ${significantWaveHeight(speed).toFixed(1)} m`;
  }

  private createSlider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
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
    slider.value = String(value);
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
