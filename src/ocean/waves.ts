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
// 연안은 바람이 파도를 키울 수 있는 거리가 짧아서, 먼바다를 가정한 수식보다 파도가 낮다.
const COASTAL_FACTOR = 0.7;
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

export const WAVES: Wave[] = BANDS.map(({ wavelength }) => {
  const k = (Math.PI * 2) / wavelength;
  return { dirX: 0, dirZ: -1, wavelength, amplitude: 0, k, omega: Math.sqrt(GRAVITY * k), q: 1 };
});

// 각 파도가 대표하는 진동수의 구간. 이웃한 파도와의 기하 평균을 경계로 삼는다.
const BAND_WIDTHS = WAVES.map((wave, i) => {
  const previous = WAVES[i - 1]?.omega ?? wave.omega ** 2 / WAVES[i + 1].omega;
  const next = WAVES[i + 1]?.omega ?? wave.omega ** 2 / WAVES[i - 1].omega;
  return Math.sqrt(wave.omega * next) - Math.sqrt(previous * wave.omega);
});

/**
 * 풍속에 대응하는 각 파도의 진폭을 Pierson–Moskowitz 스펙트럼으로 구한다.
 * 이 스펙트럼은 일정한 바람이 오래 불었을 때 진동수별로 파도의 에너지가 어떻게 분포하는지를 나타내는 경험식이며,
 * 바람이 강할수록 파장이 긴 파도에 에너지가 실린다.
 */
function targetAmplitudes(windSpeed: number): number[] {
  if (windSpeed < 0.1) return WAVES.map(() => 0);
  return WAVES.map((wave, i) => {
    const spectrum =
      ((8.1e-3 * GRAVITY ** 2) / wave.omega ** 5) * Math.exp(-0.74 * (GRAVITY / (windSpeed * wave.omega)) ** 4);
    return COASTAL_FACTOR * Math.sqrt(2 * spectrum * BAND_WIDTHS[i]);
  });
}

/** 풍속에 대응하는 유의파고 (m). 수면 높이의 표준편차에 4를 곱한 값이다. */
export function significantWaveHeight(windSpeed: number): number {
  const variance = targetAmplitudes(windSpeed).reduce((sum, amplitude) => sum + amplitude ** 2 / 2, 0);
  return 4 * Math.sqrt(variance);
}

let initialized = false;

/** 바람의 상태에 맞춰서 파도의 방향과 높이를 갱신한다. 매 프레임 호출한다. */
export function updateWaves(wind: Wind, frameTime: number): void {
  const targets = targetAmplitudes(wind.speed);
  const blend = initialized ? 1 - Math.exp(-AMPLITUDE_RESPONSE * frameTime) : 1;
  initialized = true;

  let totalSteepness = 0;
  WAVES.forEach((wave, i) => {
    const angle = ((wind.fromDeg + 180 + BANDS[i].spreadDeg) * Math.PI) / 180;
    wave.dirX = Math.sin(angle);
    wave.dirZ = -Math.cos(angle);
    wave.amplitude += (targets[i] - wave.amplitude) * blend;
    totalSteepness += wave.k * wave.amplitude;
  });

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

function phase(wave: Wave, x: number, z: number, time: number): number {
  return wave.k * (wave.dirX * x + wave.dirZ * z) - wave.omega * time;
}
