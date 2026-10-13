import type { Swell } from '../environment/swell';
import type { Wind } from '../environment/wind';
import { createBands, GRAVITY, jonswapAmplitudes, significantHeight } from './spectrum';

/**
 * 수면을 구성하는 Gerstner 파도의 목록.
 * GPU의 셰이더와 CPU의 부력 계산이 이 목록을 공유하므로, 화면에 보이는 수면과 배가 타는 수면이 일치한다.
 */
export interface Wave {
  /** 파도가 진행하는 방향 (월드의 x, z 성분, 단위 벡터) */
  dirX: number;
  dirZ: number;
  wavelength: number;
  amplitude: number;
  /** 파수 2π/λ */
  k: number;
  /** 각진동수. 심해파의 분산 관계 ω = √(g·k)를 따르므로 긴 파도일수록 빠르게 진행한다. */
  omega: number;
  /** 마루를 뾰족하게 만드는 수평 변위의 비율 */
  q: number;
}

// 모든 파도의 마루가 겹쳤을 때의 뾰족한 정도의 상한. 1 이상이면 수면이 꼬인다.
const MAX_TOTAL_STEEPNESS = 0.7;
const MAX_Q = 2;
// 바람이 바뀌었을 때 파도의 높이가 새 값으로 수렴하는 빠르기 (1/s)
const AMPLITUDE_RESPONSE = 0.6;

/**
 * 파장은 고정하고, 바람에 따라 각 파장의 진폭만 변경한다.
 * 파장을 바꾸면 모든 지점에서 파도의 위상이 한꺼번에 어긋나서 수면이 튀기 때문이다.
 * spreadDeg는 바람이 불어 가는 방향을 기준으로 각 파도가 벌어지는 각도이다.
 */
const BANDS: ReadonlyArray<{ wavelength: number; spreadDeg: number }> = [
  { wavelength: 350, spreadDeg: 5 },
  { wavelength: 230, spreadDeg: -15 },
  { wavelength: 150, spreadDeg: -10 },
  { wavelength: 95, spreadDeg: 25 },
  { wavelength: 62, spreadDeg: -35 },
  { wavelength: 41, spreadDeg: 15 },
  { wavelength: 27, spreadDeg: -50 },
  { wavelength: 17, spreadDeg: 40 },
  { wavelength: 11, spreadDeg: -20 },
  { wavelength: 7.5, spreadDeg: 60 },
];

/**
 * 너울을 이루는 파도. 파장이 비슷한 두 파도를 조금 다른 방향으로 겹치면, 마루가 서로 맞는 곳에서는 높아지고
 * 어긋나는 곳에서는 낮아져서 큰 파도가 몇 개씩 무리를 지어 지나간다. 실제 바다에서 "세 번째 파도가 크다"고 하는 현상이다.
 */
const SWELL_BANDS: ReadonlyArray<{ wavelength: number; spreadDeg: number }> = [
  { wavelength: 112, spreadDeg: 7 },
  { wavelength: 88, spreadDeg: -9 },
];

const createWave = ({ wavelength }: { wavelength: number }): Wave => {
  const k = (Math.PI * 2) / wavelength;
  return { dirX: 0, dirZ: -1, wavelength, amplitude: 0, k, omega: Math.sqrt(GRAVITY * k), q: 1 };
};

const WIND_WAVES: Wave[] = BANDS.map(createWave);
const SWELL_WAVES: Wave[] = SWELL_BANDS.map(createWave);
/** 바람이 만든 파도와 너울을 합친 전체 목록 */
export const WAVES: Wave[] = [...WIND_WAVES, ...SWELL_WAVES];

// 바람이 만든 파도 각각이 대표하는 진동수의 구간과, 그 구간의 진폭을 계산해서 담아 두는 배열
const WIND_BANDS = createBands(WIND_WAVES.map((wave) => wave.omega));
const windTargets: number[] = WIND_WAVES.map(() => 0);

// 섬에 가려진 곳에서도 취주 거리를 이보다 짧게는 계산하지 않는다 (m).
// 실제의 내해는 강풍에도 파고가 수십 cm에 그치지만, 그대로 따르면 구역의 대부분에서 배가 거의 흔들리지 않아서 게임으로서 밋밋하다.
// 섬 뒤가 열린 바다보다 조금 잔잔하다는 차이만 남기고, 내해에서도 파도가 충분히 높도록 크게 과장한 값이다.
const SHELTERED_FETCH = 35000;

/** 풍속과 취주 거리(m)에 대응하는, 바람이 만든 파도의 유의파고 (m) */
export function significantWaveHeight(windSpeed: number, fetch: number): number {
  return significantHeight(jonswapAmplitudes(windSpeed, Math.max(fetch, SHELTERED_FETCH), WIND_BANDS, []));
}

/** 지금 수면을 이루고 있는 파도(바람이 만든 파도와 너울)의 유의파고 (m) */
export function currentWaveHeight(): number {
  let variance = 0;
  for (const wave of WAVES) variance += wave.amplitude ** 2 / 2;
  return 4 * Math.sqrt(variance);
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

let initialized = false;

/** 바람과 너울, 배가 있는 위치의 조건에 맞춰서 파도의 방향과 높이를 갱신한다. 매 프레임 호출한다. */
export function updateWaves(wind: Wind, swell: Swell, exposure: Exposure, frameTime: number): void {
  const blend = initialized ? 1 - Math.exp(-AMPLITUDE_RESPONSE * frameTime) : 1;
  initialized = true;

  // 풍향과 너울의 방향은 불어오는 쪽이므로, 파도는 그 반대쪽으로 진행한다.
  jonswapAmplitudes(wind.speed, Math.max(exposure.fetch, SHELTERED_FETCH), WIND_BANDS, windTargets);
  for (let i = 0; i < WIND_WAVES.length; i++) {
    aim(WIND_WAVES[i], wind.fromDeg + 180 + BANDS[i].spreadDeg, windTargets[i], blend);
  }

  // 유의파고 H인 너울을 진폭이 같은 파도 여러 개로 나눈다: 전체 에너지 H²/16 = 개수 × a²/2
  const shadow = SWELL_LEAK + (1 - SWELL_LEAK) * smoothstep(exposure.swellFetch, SWELL_SHADOW[0], SWELL_SHADOW[1]);
  const swellAmplitude = (swell.height * shadow) / Math.sqrt(8 * SWELL_WAVES.length);
  for (let i = 0; i < SWELL_WAVES.length; i++) {
    aim(SWELL_WAVES[i], swell.fromDeg + 180 + SWELL_BANDS[i].spreadDeg, swellAmplitude, blend);
  }

  let totalSteepness = 0;
  for (const wave of WAVES) totalSteepness += wave.k * wave.amplitude;

  // 파도가 낮을 때에는 마루를 일정한 비율로 뾰족하게 만들고, 높을 때에는 수면이 꼬이지 않도록 비율을 낮춘다.
  const q = Math.min(MAX_Q, MAX_TOTAL_STEEPNESS / Math.max(totalSteepness, 1e-6));
  for (const wave of WAVES) wave.q = q;
}

/** 파도가 towardDeg(방위, 도) 쪽으로 진행하게 하고, 진폭을 target에 가까워지게 한다. */
function aim(wave: Wave, towardDeg: number, target: number, blend: number): void {
  const angle = (towardDeg * Math.PI) / 180;
  wave.dirX = Math.sin(angle);
  wave.dirZ = -Math.cos(angle);
  wave.amplitude += (target - wave.amplitude) * blend;
}

const DISPLACEMENT_ITERATIONS = 3;

/** 월드의 (x, z) 지점에서 수면의 높이를 반환한다. */
export function sampleWaveHeight(x: number, z: number, time: number): number {
  // Gerstner 파도는 수면의 점을 수평으로도 이동시킨다.
  // 따라서 이동한 결과가 (x, z)가 되는 원래의 위치를 반복 계산으로 먼저 찾는다.
  let baseX = x;
  let baseZ = z;
  for (let i = 0; i < DISPLACEMENT_ITERATIONS; i++) {
    let offsetX = 0;
    let offsetZ = 0;
    for (const wave of WAVES) {
      const horizontal = wave.q * wave.amplitude * Math.cos(phase(wave, baseX, baseZ, time));
      offsetX += wave.dirX * horizontal;
      offsetZ += wave.dirZ * horizontal;
    }
    baseX = x - offsetX;
    baseZ = z - offsetZ;
  }

  let height = 0;
  for (const wave of WAVES) height += wave.amplitude * Math.sin(phase(wave, baseX, baseZ, time));
  return height;
}

/**
 * 마루의 가파름이 이 값을 넘으면 부서지는 것으로 본다. 선체를 넘어뜨리는 힘의 계산과, 수면에 흰 물거품을 그리는 셰이더가 함께 사용한다.
 * 하나의 파도는 0.4 부근에서 부서지지만, 이 프로젝트의 수면은 파도 12개의 합이어서 실제 바다보다 완만하다.
 * 파도 세기 3단계에서는 기울기만 하고, 4단계에서는 크게 기울다가 드물게, 5단계에서는 방향을 잘못 잡으면 뒤집히도록 맞춘 값이다.
 */
export const BREAKING_STEEPNESS = 0.24;

/** 한 지점을 지나고 있는 파도의 마루가 얼마나 가파른지를 나타낸다. */
export interface Crest {
  /**
   * 마루의 가파름. 겹쳐진 파도들의 기울기를 마루의 위치에서 더한 값이며, 0.4 부근에서 실제의 파도가 부서지기 시작한다.
   * 골에서는 음수이다.
   */
  steepness: number;
  /** 가파름을 만든 파도들이 진행하는 방향 (월드의 x, z 성분). 길이는 1 이하이며, 여러 방향의 파도가 섞여 있을수록 짧다. */
  dirX: number;
  dirZ: number;
}

const crest: Crest = { steepness: 0, dirX: 0, dirZ: 0 };

/**
 * 월드의 (x, z) 지점에서 마루의 가파름을 읽는다. 선체가 부서지는 파도에 맞는지를 판정하는 데 사용한다.
 * 매 프레임 호출하므로 같은 객체를 다시 사용해서 반환한다.
 */
export function sampleCrest(x: number, z: number, time: number): Crest {
  let steepness = 0;
  let dirX = 0;
  let dirZ = 0;
  let total = 0;
  for (const wave of WAVES) {
    const slope = wave.k * wave.amplitude;
    const contribution = slope * Math.sin(phase(wave, x, z, time));
    steepness += contribution;
    // 마루를 지나고 있는 파도만 방향에 반영한다.
    if (contribution > 0) {
      dirX += wave.dirX * contribution;
      dirZ += wave.dirZ * contribution;
      total += contribution;
    }
  }
  crest.steepness = steepness;
  crest.dirX = total > 0 ? dirX / total : 0;
  crest.dirZ = total > 0 ? dirZ / total : 0;
  return crest;
}

function smoothstep(value: number, min: number, max: number): number {
  const t = Math.min(Math.max((value - min) / (max - min), 0), 1);
  return t * t * (3 - 2 * t);
}

function phase(wave: Wave, x: number, z: number, time: number): number {
  return wave.k * (wave.dirX * x + wave.dirZ * z) - wave.omega * time;
}
