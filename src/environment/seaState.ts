import type { Swell } from './swell';
import type { Wind } from './wind';

/** 파도의 환경 한 가지. 풍속과 너울의 높이를 함께 정한다. */
export interface SeaStep {
  /** 풍속 (m/s) */
  windSpeed: number;
  /** 너울의 유의파고 (m) */
  swellHeight: number;
}

/** 화면에서 고르는 파도의 세기 한 단계. 비슷한 환경 세 가지를 묶은 것이다. */
export interface SeaLevel {
  name: string;
  steps: readonly [SeaStep, SeaStep, SeaStep];
}

/**
 * 파도의 환경은 잔잔한 것부터 거친 것까지 모두 15가지이고, 세 가지씩 묶어서 다섯 단계로 제공한다.
 * 한 단계를 고르면 그 안의 세 가지 사이를 시간에 따라 오가므로, 같은 단계에서도 바다가 잠잠해졌다가 거칠어지기를 반복한다.
 * 가장 거친 환경의 풍속은 MAX_WIND_SPEED와 같다. 3단계까지는 파도를 옆으로 받아도 배가 거의 뒤집히지 않고,
 * 4단계부터는 파도를 받는 방향을 골라야 한다.
 */
export const SEA_LEVELS: readonly SeaLevel[] = [
  { name: '잔잔함', steps: [step(2, 0), step(3, 0.1), step(4.5, 0.2)] },
  { name: '약함', steps: [step(5.5, 0.3), step(7, 0.4), step(8.5, 0.5)] },
  { name: '보통', steps: [step(10, 0.6), step(12, 0.8), step(14, 1)] },
  { name: '거침', steps: [step(17, 1.4), step(20, 1.8), step(23, 2.2)] },
  { name: '폭풍', steps: [step(27, 2.6), step(31, 3.2), step(35, 3.8)] },
];

function step(windSpeed: number, swellHeight: number): SeaStep {
  return { windSpeed, swellHeight };
}

export const DEFAULT_SEA_LEVEL = 3;

// 한 가지 환경에 머무르는 시간의 범위 (초)
const HOLD_SECONDS = [25, 55] as const;
// 풍속과 너울이 다음 환경의 값으로 옮겨 가는 빠르기 (1/s). 바람이 갑자기 바뀌지 않고 수십 초에 걸쳐서 변한다.
const TRANSITION_RATE = 0.08;

/** 지금 고른 단계와, 그 단계의 세 가지 환경 가운데 어느 것을 향하고 있는지를 기록한다. */
export interface SeaState {
  /** 고른 단계 (1~5) */
  level: number;
  /** 단계 안에서 지금 향하고 있는 환경 (0~2) */
  step: number;
  /** 다음 환경으로 넘어가기까지 남은 시간 (초) */
  holdRemaining: number;
  /** 개발 도구로 풍속이나 너울을 직접 바꿨으면 true. 다시 단계를 고를 때까지 환경을 자동으로 바꾸지 않는다. */
  manual: boolean;
  /** 타임어택 코스가 환경 하나를 골랐으면 true. 풀어 줄 때까지 그 환경에 머문다. */
  fixed: boolean;
}

/** 단계를 고른다. 바람과 너울은 그 단계의 가운데 환경으로 바로 바뀐다. */
export function selectSeaLevel(state: SeaState, level: number, wind: Wind, swell: Swell): void {
  state.level = level;
  state.step = 1;
  state.holdRemaining = HOLD_SECONDS[0];
  state.manual = false;
  state.fixed = false;
  const { windSpeed, swellHeight } = SEA_LEVELS[level - 1].steps[1];
  wind.speed = windSpeed;
  swell.height = swellHeight;
}

/**
 * 단계 안의 환경 하나를 골라서 그 환경에 머물게 한다. 바람과 너울은 그 환경의 값으로 바로 바뀌고,
 * releaseSeaStep이나 selectSeaLevel을 부르기 전까지 updateSeaState가 바꾸지 않는다.
 * @param step 0 잔잔한 쪽, 1 가운데, 2 거친 쪽
 */
export function fixSeaStep(state: SeaState, level: number, step: number, wind: Wind, swell: Swell): void {
  selectSeaLevel(state, level, wind, swell);
  state.step = step;
  state.fixed = true;
  const target = SEA_LEVELS[level - 1].steps[step];
  wind.speed = target.windSpeed;
  swell.height = target.swellHeight;
}

/** fixSeaStep으로 고정한 환경을 풀어서, 다시 단계 안의 환경 사이를 오가게 한다. 고정하지 않았으면 아무것도 하지 않는다. */
export function releaseSeaStep(state: SeaState): void {
  state.fixed = false;
}

export function createSeaState(wind: Wind, swell: Swell, level = DEFAULT_SEA_LEVEL): SeaState {
  const state: SeaState = { level, step: 1, holdRemaining: 0, manual: false, fixed: false };
  selectSeaLevel(state, level, wind, swell);
  return state;
}

/**
 * 시간이 지남에 따라 단계 안의 환경을 바꾼다. 매 프레임 호출한다.
 * @param random 0 이상 1 미만의 난수를 반환하는 함수. 테스트에서 결과를 고정하는 데 사용한다.
 */
export function updateSeaState(state: SeaState, wind: Wind, swell: Swell, dt: number, random = Math.random): void {
  if (state.manual || state.fixed) return;

  state.holdRemaining -= dt;
  if (state.holdRemaining <= 0) {
    // 이웃한 환경으로만 옮겨 간다. 가장 잔잔한 것에서 가장 거친 것으로 한 번에 건너뛰지 않는다.
    if (state.step === 1) state.step = random() < 0.5 ? 0 : 2;
    else state.step = 1;
    state.holdRemaining = HOLD_SECONDS[0] + random() * (HOLD_SECONDS[1] - HOLD_SECONDS[0]);
  }

  const target = SEA_LEVELS[state.level - 1].steps[state.step];
  const blend = 1 - Math.exp(-TRANSITION_RATE * dt);
  wind.speed += (target.windSpeed - wind.speed) * blend;
  swell.height += (target.swellHeight - swell.height) * blend;
}
