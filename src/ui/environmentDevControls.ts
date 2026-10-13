import type { TimeOfDay } from '../environment/sun';
import { MAX_SWELL_HEIGHT } from '../environment/swell';
import type { Weather } from '../environment/weather';
import { MAX_WIND_SPEED, WIND_DIRECTION_STEP } from '../environment/wind';
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

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  read(): number;
  write(value: number): void;
}

export interface EnvironmentDevControls {
  /** 막대를 펼치고 접는 버튼 */
  toggle: HTMLButtonElement;
  /** 막대들을 담은 요소. 처음에는 접혀 있다. */
  element: HTMLElement;
  /** 값이 밖에서 바뀌었을 때 막대의 위치를 다시 맞춘다. */
  sync(): void;
}

/**
 * 시각과 바람, 너울을 하나씩 조절하는 막대. 로컬의 개발 서버에서만 사용한다.
 * 풍속이나 너울의 높이를 직접 바꾸면, 파도의 세기를 다시 고를 때까지 날씨가 저절로 변하지 않게 한다.
 *
 * @param onChange 막대로 값을 바꿨을 때 호출한다.
 */
export function createEnvironmentDevControls(
  { wind, swell, sea }: Weather,
  timeOfDay: TimeOfDay,
  onChange: () => void,
): EnvironmentDevControls {
  const sliders: SliderSpec[] = [
    {
      label: '시각',
      min: 5,
      max: 20,
      step: 0.25,
      read: () => timeOfDay.hour,
      write: (value) => (timeOfDay.hour = value),
    },
    {
      label: '풍속',
      min: 0,
      max: MAX_WIND_SPEED,
      step: 0.5,
      read: () => wind.speed,
      write: (value) => {
        wind.speed = value;
        sea.manual = true;
      },
    },
    {
      label: '풍향',
      min: 0,
      max: 360 - WIND_DIRECTION_STEP,
      step: WIND_DIRECTION_STEP,
      read: () => wind.fromDeg,
      write: (value) => (wind.fromDeg = value),
    },
    {
      label: '너울',
      min: 0,
      max: MAX_SWELL_HEIGHT,
      step: 0.25,
      read: () => swell.height,
      write: (value) => {
        swell.height = value;
        sea.manual = true;
      },
    },
    {
      label: '너울 방향',
      min: 0,
      max: 355,
      step: 5,
      read: () => swell.fromDeg,
      write: (value) => (swell.fromDeg = value),
    },
  ];

  const element = document.createElement('div');
  element.className = 'hud-environment-controls';
  element.hidden = true;
  const syncs = sliders.map((spec) => {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.className = 'hud-label';
    name.textContent = spec.label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.tabIndex = -1;
    slider.addEventListener('input', () => {
      spec.write(Number(slider.value));
      onChange();
    });
    // 막대에 포커스가 남아 있으면 조종에 사용하는 방향키가 막대의 값을 바꾸게 된다.
    slider.addEventListener('change', () => slider.blur());

    row.append(name, slider);
    element.append(row);
    // 막대를 끌고 있는 동안에는 손에서 벗어나지 않도록 그대로 둔다.
    return () => {
      if (!slider.matches(':active')) slider.value = String(spec.read());
    };
  });
  const sync = () => syncs.forEach((syncSlider) => syncSlider());
  sync();

  const toggle = createButton({
    html: SLIDERS_ICON,
    className: 'hud-icon-button',
    label: TOGGLE_LABEL,
    onClick: () => {
      element.hidden = !element.hidden;
      toggle.setAttribute('aria-expanded', String(!element.hidden));
    },
  });
  toggle.setAttribute('aria-expanded', 'false');

  return { toggle, element, sync };
}
