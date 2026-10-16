import { seededRandom } from '../core/random';
import { GRAVITY } from './spectrum';

/**
 * 수면을 이루는 파도 수만 개의 진폭을 정하는 스펙트럼.
 *
 * 화면의 수면은 GPU가 푸리에 변환으로 만들고(seaSurface.ts), 배가 타는 수면은 CPU가 같은 파도들을 직접 더해서 구한다.
 * 두 쪽이 같은 난수와 같은 수식을 쓰므로, 화면에 보이는 수면과 배가 타는 수면이 일치한다.
 * 이 파일에는 두 쪽이 함께 쓰는 값과 수식을 모아 둔다. 수식을 고칠 때에는 TypeScript와 GLSL을 함께 고쳐야 한다.
 */

/** 한 변의 격자 수. 2의 거듭제곱이어야 한다. 한 층이 GRID_SIZE × GRID_SIZE개의 파도를 더한다. */
export const GRID_SIZE = 256;
/** 배가 타는 큰 파도를 맡는 층의 무늬 한 장이 덮는 한 변 (m) */
export const PRIMARY_TILE = 389;
/** 큰 파도의 마루를 뾰족하게 만드는 수평 변위의 비율 */
export const PRIMARY_CHOPPINESS = 1;
// 배가 타는 층에서 CPU가 더하는 파도의 범위. 격자의 중심에서 이 칸 수 이내의 파도만 사용한다.
// 파장으로는 PRIMARY_TILE / PRIMARY_RADIUS ≈ 13m 이상이다. 15m급 선체는 이보다 짧은 물결을 거의 타지 않는다.
// 반지름을 키우면 CPU가 더할 파도가 제곱으로 늘어난다.
const PRIMARY_RADIUS = 30;
/** 배가 타는 층이 맡는 가장 큰 파수. 이보다 짧은 물결은 화면에만 보이는 층이 맡는다. */
export const PRIMARY_MAX_WAVENUMBER = (Math.PI * 2 * (PRIMARY_RADIUS + 0.5)) / PRIMARY_TILE;

// 바람을 가로지르는 방향과 거스르는 방향으로도 조금은 파도가 진행한다. 그 비율이다.
const CROSS_WIND_SHARE = 0.06;
// 너울의 파장 (m)과, 파수가 그 주변으로 퍼진 정도(가운데 파수에 대한 비율)
const SWELL_WAVELENGTH = 100;
const SWELL_SPREAD = 0.35;

/** 바람이 불어 가는 방향과 이루는 각의 코사인으로, 그 방향으로 진행하는 파도의 비중을 구한다. */
function directionalWeight(along: number): number {
  return along > 0 ? CROSS_WIND_SHARE + (1 - CROSS_WIND_SHARE) * along ** 4 : CROSS_WIND_SHARE * (1 + along);
}

// 모든 방향에 대해서 비중을 더한 값. 에너지의 합이 원하는 파고가 되도록 나누는 데 쓴다.
const DIRECTIONAL_TOTAL = (() => {
  const steps = 3600;
  let total = 0;
  for (let i = 0; i < steps; i++) total += directionalWeight(Math.cos((i / steps) * Math.PI * 2));
  return (total / steps) * Math.PI * 2;
})();

/** 스펙트럼의 형태를 정하는 값. CPU와 GPU가 같은 값을 받는다. */
export interface SeaShape {
  /** 바람이 만든 파도의 에너지 배율 */
  windEnergy: number;
  /** 에너지가 가장 큰 파수 (rad/m). 이보다 긴 파도는 급격히 줄어든다. */
  peak: number;
  /** 바람이 불어 가는 방향 (월드의 x, z 성분, 단위 벡터) */
  windX: number;
  windZ: number;
  /** 너울의 에너지 배율 */
  swellEnergy: number;
  /** 너울의 가운데 파수 벡터 (rad/m). 너울이 진행하는 방향을 향한다. */
  swellX: number;
  swellZ: number;
  /** 너울의 파수가 퍼진 정도 (rad/m) */
  swellSpread: number;
}

export const SEA_SHAPE: SeaShape = {
  windEnergy: 0,
  peak: 1,
  windX: 0,
  windZ: -1,
  swellEnergy: 0,
  swellX: 0,
  swellZ: -1,
  swellSpread: 1,
};

/**
 * 파수 벡터 (kx, kz)인 파도 하나의 진폭 (m).
 * 바람이 만든 파도는 Pierson–Moskowitz 스펙트럼을 파수로 옮긴 형태이고, 너울은 한 파수의 주변에 모인 덩어리이다.
 */
function amplitude(kx: number, kz: number, tileSize: number, shape: SeaShape, withSwell: boolean): number {
  const k = Math.hypot(kx, kz);
  // GLSL과 같은 범위로 자른다. 수학적으로는 -1~1이지만, 셰이더의 32비트 계산에서는 반올림 때문에 벗어날 수 있다.
  const along = Math.min(Math.max((kx * shape.windX + kz * shape.windZ) / k, -1), 1);
  let energy = (shape.windEnergy * directionalWeight(along) * Math.exp(-1.25 * (shape.peak / k) ** 2)) / k ** 4;
  if (withSwell) {
    const distance = (kx - shape.swellX) ** 2 + (kz - shape.swellZ) ** 2;
    energy += shape.swellEnergy * Math.exp(-distance / (2 * shape.swellSpread ** 2));
  }
  // 파도 하나가 대표하는 파수의 넓이(Δk²)를 곱해야 격자의 크기와 무관하게 같은 높이가 된다.
  return (0.5 * Math.sqrt(energy) * Math.PI * 2) / tileSize;
}

/** 위의 amplitude와 같은 계산을 하는 GLSL. 스펙트럼을 만드는 셰이더가 포함한다. */
export const AMPLITUDE_GLSL = /* glsl */ `
  uniform float uWindEnergy;
  uniform float uPeak;
  uniform vec2 uWindDirection;
  uniform float uSwellEnergy;
  uniform vec2 uSwellCenter;
  uniform float uSwellSpread;

  float amplitude(vec2 k, float kLength, float tileSize) {
    // 풍향이 정확히 축 방향이면 바람과 정반대인 파도에서 반올림 때문에 -1보다 조금 작아진다.
    // 그러면 비중이 음수가 되어 sqrt가 NaN을 내고, 푸리에 변환을 거치며 층 전체로 퍼진다.
    float along = clamp(dot(k / kLength, uWindDirection), -1.0, 1.0);
    float directional = along > 0.0
      ? ${CROSS_WIND_SHARE} + ${1 - CROSS_WIND_SHARE} * along * along * along * along
      : ${CROSS_WIND_SHARE} * (1.0 + along);
    float ratio = uPeak / kLength;
    float energy = uWindEnergy * directional * exp(-1.25 * ratio * ratio) / (kLength * kLength * kLength * kLength);
    vec2 offset = k - uSwellCenter;
    energy += uSwellEnergy * exp(-dot(offset, offset) / (2.0 * uSwellSpread * uSwellSpread));
    return 0.5 * sqrt(energy) * 6.283185307 / tileSize;
  }
`;

/**
 * 스펙트럼의 형태를 정한다.
 *
 * @param windHeight 바람이 만든 파도의 유의파고 (m)
 * @param peakFrequency 에너지가 가장 큰 각진동수 (rad/s)
 * @param windTowardDeg 바람이 불어 가는 방위 (도)
 * @param swellHeight 너울의 유의파고 (m)
 * @param swellTowardDeg 너울이 진행하는 방위 (도)
 */
export function shapeSea(
  windHeight: number,
  peakFrequency: number,
  windTowardDeg: number,
  swellHeight: number,
  swellTowardDeg: number,
): void {
  const shape = SEA_SHAPE;
  // 심해파의 분산 관계 ω² = g·k로 각진동수를 파수로 바꾼다.
  shape.peak = peakFrequency ** 2 / GRAVITY;
  // 스펙트럼을 모든 파수에 대해서 더하면 windEnergy × DIRECTIONAL_TOTAL / (2.5 × peak²)이 된다.
  // 이 값이 수면 높이의 분산 (유의파고 / 4)²과 같아지도록 배율을 정한다.
  shape.windEnergy = ((windHeight / 4) ** 2 * 2.5 * shape.peak ** 2) / DIRECTIONAL_TOTAL;
  const wind = (windTowardDeg * Math.PI) / 180;
  shape.windX = Math.sin(wind);
  shape.windZ = -Math.cos(wind);

  const swellWavenumber = (Math.PI * 2) / SWELL_WAVELENGTH;
  const swell = (swellTowardDeg * Math.PI) / 180;
  shape.swellX = Math.sin(swell) * swellWavenumber;
  shape.swellZ = -Math.cos(swell) * swellWavenumber;
  shape.swellSpread = SWELL_SPREAD * swellWavenumber;
  // 너울은 몇 안 되는 파도에 에너지가 몰려 있어서, 난수에 따라 높이가 크게 달라진다.
  // 실제로 쓰이는 난수로 에너지를 더해 보고, 그 합이 원하는 파고가 되도록 배율을 맞춘다.
  shape.swellEnergy = 0;
  if (swellHeight > 0) {
    let variance = 0;
    for (let i = 0; i < MODE_COUNT; i++) {
      const distance = (modeKx[i] - shape.swellX) ** 2 + (modeKz[i] - shape.swellZ) ** 2;
      const unit = (0.5 * Math.exp(-distance / (4 * shape.swellSpread ** 2)) * Math.PI * 2) / PRIMARY_TILE;
      variance += 2 * unit * unit * (noiseReal[i] ** 2 + noiseImaginary[i] ** 2);
    }
    shape.swellEnergy = (swellHeight / 4) ** 2 / variance;
  }

  for (let i = 0; i < MODE_COUNT; i++) {
    const a = amplitude(modeKx[i], modeKz[i], PRIMARY_TILE, shape, true);
    baseReal[i] = noiseReal[i] * a;
    baseImaginary[i] = noiseImaginary[i] * a;
  }
  evolvedTime = NaN;
}

/**
 * 파도마다 진폭과 위상을 정하는 정규 분포의 난수. 한 칸에 두 개씩(복소수의 실수부와 허수부) 들어 있다.
 * 씨앗 값이 고정되어 있으므로 접속할 때마다 같은 수면이 만들어지고, GPU의 텍스처도 이 배열로 만든다.
 */
export const SEA_NOISE: Float32Array = (() => {
  const random = seededRandom(20261014);
  const noise = new Float32Array(GRID_SIZE * GRID_SIZE * 2);
  // Box-Muller 변환: 고르게 분포한 난수 두 개로 정규 분포의 난수 두 개를 만든다.
  for (let i = 0; i < noise.length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - random()));
    const angle = Math.PI * 2 * random();
    noise[i] = radius * Math.cos(angle);
    noise[i + 1] = radius * Math.sin(angle);
  }
  return noise;
})();

// 배가 타는 층의 파도 목록. 격자의 칸 (nx, nz)가 파수 벡터 2π/L × (nx, nz)인 파도 하나에 해당한다.
const TABLE_SIZE = PRIMARY_RADIUS * 2 + 1;
const modes: { nx: number; nz: number }[] = [];
for (let nz = -PRIMARY_RADIUS; nz <= PRIMARY_RADIUS; nz++) {
  for (let nx = -PRIMARY_RADIUS; nx <= PRIMARY_RADIUS; nx++) {
    const squared = nx * nx + nz * nz;
    if (squared > 0 && squared <= PRIMARY_RADIUS * (PRIMARY_RADIUS + 1)) modes.push({ nx, nz });
  }
}
const MODE_COUNT = modes.length;
const modeKx = new Float64Array(MODE_COUNT);
const modeKz = new Float64Array(MODE_COUNT);
const modeK = new Float64Array(MODE_COUNT);
const modeOmega = new Float64Array(MODE_COUNT);
// 위치에 따른 위상을 읽을 표의 자리 (x 방향, z 방향)
const modeColumn = new Uint16Array(MODE_COUNT);
const modeRow = new Uint16Array(MODE_COUNT);
const noiseReal = new Float64Array(MODE_COUNT);
const noiseImaginary = new Float64Array(MODE_COUNT);
modes.forEach(({ nx, nz }, i) => {
  modeKx[i] = (Math.PI * 2 * nx) / PRIMARY_TILE;
  modeKz[i] = (Math.PI * 2 * nz) / PRIMARY_TILE;
  modeK[i] = Math.hypot(modeKx[i], modeKz[i]);
  modeOmega[i] = Math.sqrt(GRAVITY * modeK[i]);
  modeColumn[i] = nx + PRIMARY_RADIUS;
  modeRow[i] = nz + PRIMARY_RADIUS;
  // 음의 파수는 격자의 뒤쪽 절반에 들어 있다.
  const cell = ((nz + GRID_SIZE) % GRID_SIZE) * GRID_SIZE + ((nx + GRID_SIZE) % GRID_SIZE);
  noiseReal[i] = SEA_NOISE[cell * 2];
  noiseImaginary[i] = SEA_NOISE[cell * 2 + 1];
});

// 시각 0에서의 파도(난수 × 진폭)와, 지금 시각까지 위상을 돌린 파도
const baseReal = new Float64Array(MODE_COUNT);
const baseImaginary = new Float64Array(MODE_COUNT);
const waveReal = new Float64Array(MODE_COUNT);
const waveImaginary = new Float64Array(MODE_COUNT);
let evolvedTime = NaN;

/** 모든 파도의 위상을 주어진 시각까지 돌린다. 같은 시각으로 여러 지점을 읽을 때에는 한 번만 계산한다. */
function evolve(time: number): void {
  if (time === evolvedTime) return;
  evolvedTime = time;
  for (let i = 0; i < MODE_COUNT; i++) {
    const phase = modeOmega[i] * time;
    const cos = Math.cos(phase);
    const sin = Math.sin(phase);
    waveReal[i] = baseReal[i] * cos - baseImaginary[i] * sin;
    waveImaginary[i] = baseReal[i] * sin + baseImaginary[i] * cos;
  }
}

/** 수면의 한 지점에서 읽은 값 */
export interface SurfaceSample {
  /** 높이 (m) */
  height: number;
  /** 마루 쪽으로 수면을 끌어당기는 수평 변위 (m) */
  offsetX: number;
  offsetZ: number;
  /** 마루의 가파름. 수평 변위가 수면을 모으는 정도이며, 마루에서 양수이고 골에서 음수이다. */
  steepness: number;
  /** 가파름을 만든 파도들이 진행하는 방향 (월드의 x, z 성분). 여러 방향의 파도가 섞여 있을수록 짧다. */
  dirX: number;
  dirZ: number;
}

const sample: SurfaceSample = { height: 0, offsetX: 0, offsetZ: 0, steepness: 0, dirX: 0, dirZ: 0 };
// e^(-i·k·x)를 x 방향과 z 방향으로 나눠서 적어 두는 표. 파도마다 삼각함수를 부르지 않고 표의 두 값을 곱해서 쓴다.
const columnReal = new Float64Array(TABLE_SIZE);
const columnImaginary = new Float64Array(TABLE_SIZE);
const rowReal = new Float64Array(TABLE_SIZE);
const rowImaginary = new Float64Array(TABLE_SIZE);

function fillPhaseTable(real: Float64Array, imaginary: Float64Array, position: number): void {
  const angle = (-Math.PI * 2 * position) / PRIMARY_TILE;
  const stepReal = Math.cos(angle);
  const stepImaginary = Math.sin(angle);
  real[PRIMARY_RADIUS] = 1;
  imaginary[PRIMARY_RADIUS] = 0;
  for (let n = 1; n <= PRIMARY_RADIUS; n++) {
    const previousReal = real[PRIMARY_RADIUS + n - 1];
    const previousImaginary = imaginary[PRIMARY_RADIUS + n - 1];
    real[PRIMARY_RADIUS + n] = previousReal * stepReal - previousImaginary * stepImaginary;
    imaginary[PRIMARY_RADIUS + n] = previousReal * stepImaginary + previousImaginary * stepReal;
    // 음의 파수는 켤레이다.
    real[PRIMARY_RADIUS - n] = real[PRIMARY_RADIUS + n];
    imaginary[PRIMARY_RADIUS - n] = -imaginary[PRIMARY_RADIUS + n];
  }
}

/**
 * 수평 변위를 적용하기 전의 위치 (x, z)에서 수면을 읽는다. GPU의 텍스처 한 칸에 들어 있는 값과 같다.
 * 수면은 진행하는 파도의 합이다: h = Σ 2·Re(h0(k)·e^(i(ωt − k·x))).
 * 매 프레임 여러 번 호출하므로 같은 객체를 다시 사용해서 반환한다.
 */
export function sampleSea(x: number, z: number, time: number): SurfaceSample {
  evolve(time);
  fillPhaseTable(columnReal, columnImaginary, x);
  fillPhaseTable(rowReal, rowImaginary, z);

  let height = 0;
  let offsetX = 0;
  let offsetZ = 0;
  let steepness = 0;
  let dirX = 0;
  let dirZ = 0;
  let rising = 0;
  for (let i = 0; i < MODE_COUNT; i++) {
    const column = modeColumn[i];
    const row = modeRow[i];
    const phaseReal = columnReal[column] * rowReal[row] - columnImaginary[column] * rowImaginary[row];
    const phaseImaginary = columnReal[column] * rowImaginary[row] + columnImaginary[column] * rowReal[row];
    const real = 2 * (waveReal[i] * phaseReal - waveImaginary[i] * phaseImaginary);
    const imaginary = 2 * (waveReal[i] * phaseImaginary + waveImaginary[i] * phaseReal);
    const k = modeK[i];
    height += real;
    // 수평 변위는 높이보다 위상이 90° 늦고, 파도가 진행하는 방향을 따른다.
    offsetX += (modeKx[i] / k) * imaginary;
    offsetZ += (modeKz[i] / k) * imaginary;
    const sharp = k * real;
    steepness += sharp;
    // 마루를 지나고 있는 파도만 방향에 반영한다.
    if (sharp > 0) {
      dirX += (modeKx[i] / k) * sharp;
      dirZ += (modeKz[i] / k) * sharp;
      rising += sharp;
    }
  }
  sample.height = height;
  sample.offsetX = offsetX * PRIMARY_CHOPPINESS;
  sample.offsetZ = offsetZ * PRIMARY_CHOPPINESS;
  sample.steepness = steepness;
  sample.dirX = rising > 0 ? dirX / rising : 0;
  sample.dirZ = rising > 0 ? dirZ / rising : 0;
  return sample;
}

/** CPU가 더하는 파도의 수. 성능을 가늠하는 데 쓴다. */
export const PRIMARY_MODE_COUNT = MODE_COUNT;
