import type { Swell } from '../environment/swell';
import type { Wind } from '../environment/wind';
import { sampleSea, shapeSea } from './seaSpectrum';
import { createBands, GRAVITY, jonswapAmplitudes, peakFrequency, significantHeight } from './spectrum';

/**
 * 바람과 너울, 배가 있는 위치로부터 수면의 상태를 정하고, 배가 타는 수면을 읽는다.
 * 수면은 방향과 파장이 조금씩 다른 파도 수만 개의 합이다 (seaSpectrum.ts). 화면의 수면은 GPU가 푸리에 변환으로 만들고,
 * 배가 타는 수면은 그 가운데 파장이 긴 파도를 CPU가 직접 더해서 구한다.
 */

// 바람이 만든 파도의 유의파고를 구할 때 스펙트럼을 읽는 파장의 목록 (m)
const HEIGHT_WAVELENGTHS = [350, 230, 150, 95, 62, 41, 27, 17, 11, 7.5];
const HEIGHT_BANDS = createBands(
  HEIGHT_WAVELENGTHS.map((wavelength) => Math.sqrt((GRAVITY * Math.PI * 2) / wavelength)),
);
const heightAmplitudes: number[] = HEIGHT_WAVELENGTHS.map(() => 0);

// 섬에 가려진 곳에서도 취주 거리를 이보다 짧게는 계산하지 않는다 (m).
// 실제의 내해는 강풍에도 파고가 수십 cm에 그치지만, 그대로 따르면 구역의 대부분에서 배가 거의 흔들리지 않아서 게임으로서 밋밋하다.
// 섬 뒤가 열린 바다보다 조금 잔잔하다는 차이만 남기고, 내해에서도 파도가 충분히 높도록 크게 과장한 값이다.
const SHELTERED_FETCH = 35000;
// 바람이 바뀌었을 때 파도의 높이와 파장이 새 값으로 수렴하는 빠르기 (1/s)
const RESPONSE = 0.6;
// 바람이 거의 없을 때에도 수식이 깨지지 않도록, 풍속을 이보다 낮게는 계산하지 않는다 (m/s).
const MIN_WIND_SPEED = 0.5;

/** 풍속과 취주 거리(m)에 대응하는, 바람이 만든 파도의 유의파고 (m) */
export function significantWaveHeight(windSpeed: number, fetch: number): number {
  return significantHeight(
    jonswapAmplitudes(windSpeed, Math.max(fetch, SHELTERED_FETCH), HEIGHT_BANDS, heightAmplitudes),
  );
}

/** 파도가 자라는 조건 가운데, 배가 있는 위치에 따라 달라지는 것 */
export interface Exposure {
  /** 바람이 육지에 막히지 않고 수면 위를 불어온 거리 (m) */
  fetch: number;
  /** 너울이 오는 쪽으로 열려 있는 수면의 거리 (m) */
  swellFetch: number;
}

// 너울이 오는 쪽으로 열린 거리가 이 범위(m)의 아래쪽이면 섬에 완전히 가려진 것으로, 위쪽이면 그대로 들어오는 것으로 본다.
const SWELL_SHADOW = [1500, 12000] as const;
// 섬에 완전히 가려진 곳에도 너울의 이만큼은 들어온다. 실제로는 거의 들어오지 않지만, 내해의 파도를 키우기 위해서 남긴다.
const SWELL_LEAK = 0.5;

// 지금 수면에 반영되어 있는 값. 바람이 바뀌면 목표를 향해서 서서히 따라간다.
let windHeight = 0;
let swellHeight = 0;
let peak = 1;
let initialized = false;

/** 바람과 너울, 배가 있는 위치의 조건에 맞춰서 수면의 상태를 갱신한다. 매 프레임 호출한다. */
export function updateWaves(wind: Wind, swell: Swell, exposure: Exposure, frameTime: number): void {
  const blend = initialized ? 1 - Math.exp(-RESPONSE * frameTime) : 1;
  initialized = true;

  const fetch = Math.max(exposure.fetch, SHELTERED_FETCH);
  windHeight += (significantWaveHeight(wind.speed, fetch) - windHeight) * blend;
  peak += (peakFrequency(Math.max(wind.speed, MIN_WIND_SPEED), fetch) - peak) * blend;

  const shadow = SWELL_LEAK + (1 - SWELL_LEAK) * smoothstep(exposure.swellFetch, SWELL_SHADOW[0], SWELL_SHADOW[1]);
  swellHeight += (swell.height * shadow - swellHeight) * blend;

  // 풍향과 너울의 방향은 불어오는 쪽이므로, 파도는 그 반대쪽으로 진행한다.
  shapeSea(windHeight, peak, wind.fromDeg + 180, swellHeight, swell.fromDeg + 180);
}

/** 지금 수면을 이루고 있는 파도(바람이 만든 파도와 너울)의 유의파고 (m) */
export function currentWaveHeight(): number {
  return Math.hypot(windHeight, swellHeight);
}

const DISPLACEMENT_ITERATIONS = 2;
const base = { x: 0, z: 0 };

/**
 * 수면의 점은 수평으로도 이동한다. 이동한 결과가 (x, z)가 되는 원래의 위치를 반복 계산으로 찾는다.
 * 매 프레임 호출하므로 같은 객체를 다시 사용해서 반환한다.
 */
export function findBasePosition(x: number, z: number, time: number): { x: number; z: number } {
  base.x = x;
  base.z = z;
  for (let i = 0; i < DISPLACEMENT_ITERATIONS; i++) {
    const sample = sampleSea(base.x, base.z, time);
    base.x = x - sample.offsetX;
    base.z = z - sample.offsetZ;
  }
  return base;
}

/** 수평으로 이동하기 전의 위치 (baseX, baseZ)에 있던 수면의 높이 */
export function sampleBaseHeight(baseX: number, baseZ: number, time: number): number {
  return sampleSea(baseX, baseZ, time).height;
}

/** 월드의 (x, z) 지점에서 수면의 높이를 반환한다. */
export function sampleWaveHeight(x: number, z: number, time: number): number {
  const { x: baseX, z: baseZ } = findBasePosition(x, z, time);
  return sampleSea(baseX, baseZ, time).height;
}

/**
 * 마루의 가파름이 이 값을 넘으면 부서지는 것으로 본다. 선체를 넘어뜨리는 힘의 계산과, 수면에 흰 물거품을 그리는 셰이더가 함께 사용한다.
 * 파도 세기 3단계에서는 기울기만 하고, 4단계에서는 크게 기울다가 드물게, 5단계에서는 방향을 잘못 잡으면 뒤집히도록 맞춘 값이다.
 */
export const BREAKING_STEEPNESS = 0.185;

/** 한 지점을 지나고 있는 파도의 마루가 얼마나 가파른지를 나타낸다. */
export interface Crest {
  /** 마루의 가파름. 수평 변위가 수면을 모으는 정도이며, 마루에서 양수이고 골에서 음수이다. */
  steepness: number;
  /** 가파름을 만든 파도들이 진행하는 방향 (월드의 x, z 성분). 길이는 1 이하이며, 여러 방향의 파도가 섞여 있을수록 짧다. */
  dirX: number;
  dirZ: number;
}

/**
 * 수평으로 이동하기 전의 위치 (baseX, baseZ)에서 마루의 가파름을 읽는다. 선체가 부서지는 파도에 맞는지를 판정하는 데 사용한다.
 * 매 프레임 호출하므로 같은 객체를 다시 사용해서 반환한다.
 */
export function sampleCrest(baseX: number, baseZ: number, time: number): Crest {
  return sampleSea(baseX, baseZ, time);
}

function smoothstep(value: number, min: number, max: number): number {
  const t = Math.min(Math.max((value - min) / (max - min), 0), 1);
  return t * t * (3 - 2 * t);
}
