import { createSeaState, updateSeaState, type SeaState } from './seaState';
import { createSwell, type Swell } from './swell';
import { createWind, type Wind } from './wind';

/** 날씨를 이루는 값들. 화면의 버튼과 막대가 이 객체들의 값을 직접 변경한다. */
export interface Weather {
  wind: Wind;
  swell: Swell;
  /** 고른 파도의 세기와, 그 안에서 지금 향하고 있는 환경 */
  sea: SeaState;
}

/** 풍향은 무작위로, 풍속과 너울은 기본 단계의 값으로 시작한다. */
export function createWeather(): Weather {
  const wind = createWind();
  const swell = createSwell();
  return { wind, swell, sea: createSeaState(wind, swell) };
}

/** 고른 단계의 범위 안에서 풍속과 너울을 시간에 따라 바꾼다. 매 프레임 호출한다. */
export function updateWeather({ wind, swell, sea }: Weather, dt: number): void {
  updateSeaState(sea, wind, swell, dt);
}
