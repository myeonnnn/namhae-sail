import type { Swell } from '../environment/swell';
import type { Wind } from '../environment/wind';

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

const GRAVITY = 9.81;
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

// 각 파도가 대표하는 진동수의 구간 [낮은 쪽, 높은 쪽]. 이웃한 파도와의 기하 평균을 경계로 삼는다.
// 양 끝의 파도는 목록에 없는 더 긴 파도와 더 짧은 파도의 에너지까지 맡는다.
// 그러지 않으면 취주 거리가 짧은 곳에서는 파도가 목록의 가장 짧은 파장보다도 짧아서, 수면이 완전히 평평해진다.
const TAIL_RATIO = 3;
const BAND_EDGES = WIND_WAVES.map((wave, i) => {
  const longer = WIND_WAVES[i - 1]?.omega ?? wave.omega / TAIL_RATIO ** 2;
  const shorter = WIND_WAVES[i + 1]?.omega ?? wave.omega * TAIL_RATIO ** 2;
  return [Math.sqrt(longer * wave.omega), Math.sqrt(wave.omega * shorter)] as const;
});
// 한 구간의 에너지를 구할 때 스펙트럼을 읽는 횟수. 봉우리가 좁아서, 구간의 가운데 한 곳만 읽으면 봉우리를 놓친다.
const BAND_SAMPLES = 8;

// 섬에 가려진 곳에서도 취주 거리를 이보다 짧게는 계산하지 않는다 (m).
// 실제의 내해는 강풍에도 파고가 수십 cm에 그치지만, 그대로 따르면 구역의 대부분에서 배가 거의 흔들리지 않아서 게임으로서 밋밋하다.
// 섬 뒤가 열린 바다보다 조금 잔잔하다는 차이만 남기고, 내해에서도 파도가 충분히 높도록 크게 과장한 값이다.
const SHELTERED_FETCH = 35000;

// 바람이 충분히 멀리, 오래 불어서 파도가 더 자라지 않는 상태의 값 (Pierson–Moskowitz)
const DEVELOPED_PEAK = 0.88;
const DEVELOPED_ALPHA = 0.0081;
// 아직 자라고 있는 파도는 에너지가 봉우리 주변에 몰려 있다. 그 정도를 나타내는 JONSWAP의 계수
const YOUNG_SEA_PEAKEDNESS = 3.3;

/**
 * 풍속과 취주 거리에 대응하는 각 파도의 진폭을 JONSWAP 스펙트럼으로 구한다.
 *
 * 스펙트럼은 진동수별로 파도의 에너지가 어떻게 분포하는지를 나타내는 경험식이다.
 * 바람이 수면 위를 불어온 거리(취주 거리)가 짧으면 파도가 덜 자라서, 낮고 파장이 짧다.
 * 그래서 같은 바람이 불어도 섬의 뒤쪽은 잔잔하고, 열린 바다로 나갈수록 파도가 높고 길어진다.
 * 취주 거리가 충분히 길면 Pierson–Moskowitz 스펙트럼과 같아진다.
 */
function windWaveAmplitudes(windSpeed: number, fetch: number): number[] {
  if (windSpeed < 0.1) return WIND_WAVES.map(() => 0);
  const scale = GRAVITY / windSpeed;
  const dimensionlessFetch = (GRAVITY * Math.max(fetch, SHELTERED_FETCH)) / windSpeed ** 2;
  const developedPeak = DEVELOPED_PEAK * scale;
  const peak = Math.max(22 * scale * dimensionlessFetch ** -0.33, developedPeak);
  const alpha = Math.max(0.076 * dimensionlessFetch ** -0.22, DEVELOPED_ALPHA);
  // 다 자란 바다에 가까워질수록 봉우리가 완만해진다.
  const youth = Math.min(Math.max((peak / developedPeak - 1) / 0.3, 0), 1);
  const peakedness = 1 + (YOUNG_SEA_PEAKEDNESS - 1) * youth;

  const spectrum = (omega: number) => {
    const sigma = omega <= peak ? 0.07 : 0.09;
    const enhancement = peakedness ** Math.exp(-((omega - peak) ** 2) / (2 * sigma ** 2 * peak ** 2));
    return ((alpha * GRAVITY ** 2) / omega ** 5) * Math.exp(-1.25 * (peak / omega) ** 4) * enhancement;
  };

  return BAND_EDGES.map(([low, high]) => {
    // 스펙트럼은 진동수가 높아질수록 급하게 줄어들므로, 구간을 같은 비율로 나누어서 읽는다.
    const ratio = (high / low) ** (1 / BAND_SAMPLES);
    let energy = 0;
    for (let i = 0, from = low; i < BAND_SAMPLES; i++, from *= ratio) {
      energy += spectrum(from * Math.sqrt(ratio)) * from * (ratio - 1);
    }
    // 진폭이 a인 파도 하나의 에너지는 a²/2이다.
    return Math.sqrt(2 * energy);
  });
}

/** 진폭의 목록에 대응하는 유의파고 (m). 수면 높이의 표준편차에 4를 곱한 값이다. */
function heightOf(amplitudes: Iterable<number>): number {
  let variance = 0;
  for (const amplitude of amplitudes) variance += amplitude ** 2 / 2;
  return 4 * Math.sqrt(variance);
}

/** 풍속과 취주 거리(m)에 대응하는, 바람이 만든 파도의 유의파고 (m) */
export function significantWaveHeight(windSpeed: number, fetch: number): number {
  return heightOf(windWaveAmplitudes(windSpeed, fetch));
}

/** 지금 수면을 이루고 있는 파도(바람이 만든 파도와 너울)의 유의파고 (m) */
export function currentWaveHeight(): number {
  return heightOf(WAVES.map((wave) => wave.amplitude));
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

  const aim = (wave: Wave, towardDeg: number, target: number) => {
    const angle = (towardDeg * Math.PI) / 180;
    wave.dirX = Math.sin(angle);
    wave.dirZ = -Math.cos(angle);
    wave.amplitude += (target - wave.amplitude) * blend;
  };

  // 풍향과 너울의 방향은 불어오는 쪽이므로, 파도는 그 반대쪽으로 진행한다.
  const windTargets = windWaveAmplitudes(wind.speed, exposure.fetch);
  WIND_WAVES.forEach((wave, i) => aim(wave, wind.fromDeg + 180 + BANDS[i].spreadDeg, windTargets[i]));

  // 유의파고 H인 너울을 진폭이 같은 파도 여러 개로 나눈다: 전체 에너지 H²/16 = 개수 × a²/2
  const shadow = SWELL_LEAK + (1 - SWELL_LEAK) * smoothstep(exposure.swellFetch, SWELL_SHADOW[0], SWELL_SHADOW[1]);
  const swellAmplitude = (swell.height * shadow) / Math.sqrt(8 * SWELL_WAVES.length);
  SWELL_WAVES.forEach((wave, i) => aim(wave, swell.fromDeg + 180 + SWELL_BANDS[i].spreadDeg, swellAmplitude));

  let totalSteepness = 0;
  for (const wave of WAVES) totalSteepness += wave.k * wave.amplitude;

  // 파도가 낮을 때에는 마루를 일정한 비율로 뾰족하게 만들고, 높을 때에는 수면이 꼬이지 않도록 비율을 낮춘다.
  const q = Math.min(MAX_Q, MAX_TOTAL_STEEPNESS / Math.max(totalSteepness, 1e-6));
  for (const wave of WAVES) wave.q = q;
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
