/**
 * 파도의 스펙트럼: 진동수별로 파도의 에너지가 어떻게 분포하는지를 나타내는 경험식.
 * 수면을 이루는 파도 하나하나의 진폭을, 풍속과 취주 거리로부터 정하는 데 사용한다.
 */

export const GRAVITY = 9.81;

/** 파도 하나가 대표하는 각진동수의 구간 [낮은 쪽, 높은 쪽] (rad/s) */
export type Band = readonly [low: number, high: number];

// 목록의 양 끝에 있는 파도가 맡는 구간을, 바깥쪽으로 이 비율만큼 넓힌다.
const TAIL_RATIO = 3;
// 한 구간의 에너지를 구할 때 스펙트럼을 읽는 횟수. 봉우리가 좁아서, 구간의 가운데 한 곳만 읽으면 봉우리를 놓친다.
const BAND_SAMPLES = 8;

// 바람이 충분히 멀리, 오래 불어서 파도가 더 자라지 않는 상태의 값 (Pierson–Moskowitz)
const DEVELOPED_PEAK = 0.88;
const DEVELOPED_ALPHA = 0.0081;
// 아직 자라고 있는 파도는 에너지가 봉우리 주변에 몰려 있다. 그 정도를 나타내는 JONSWAP의 계수
const YOUNG_SEA_PEAKEDNESS = 3.3;

/**
 * 각진동수의 목록(낮은 것부터)을 받아서, 각각이 대표하는 구간을 정한다. 이웃한 진동수와의 기하 평균을 경계로 삼는다.
 * 양 끝의 구간은 바깥쪽으로 넓혀서, 목록에 없는 더 긴 파도와 더 짧은 파도의 에너지까지 맡긴다.
 * 그러지 않으면 취주 거리가 짧은 곳에서는 파도가 목록의 가장 짧은 파장보다도 짧아서, 수면이 완전히 평평해진다.
 */
export function createBands(frequencies: readonly number[]): Band[] {
  return frequencies.map((omega, i) => {
    const lower = frequencies[i - 1] ?? omega / TAIL_RATIO ** 2;
    const higher = frequencies[i + 1] ?? omega * TAIL_RATIO ** 2;
    return [Math.sqrt(lower * omega), Math.sqrt(omega * higher)];
  });
}

/**
 * 풍속과 취주 거리에 대응하는, 에너지가 가장 큰 각진동수 (rad/s).
 * 취주 거리가 짧으면 파도가 덜 자라서 진동수가 높고(파장이 짧고), 충분히 길면 다 자란 바다의 값에서 멈춘다.
 */
export function peakFrequency(windSpeed: number, fetch: number): number {
  const scale = GRAVITY / windSpeed;
  const dimensionlessFetch = (GRAVITY * fetch) / windSpeed ** 2;
  return Math.max(22 * scale * dimensionlessFetch ** -0.33, DEVELOPED_PEAK * scale);
}

/**
 * 풍속과 취주 거리에 대응하는 각 구간의 진폭(m)을 JONSWAP 스펙트럼으로 구해서 out에 적는다.
 *
 * 바람이 수면 위를 불어온 거리(취주 거리)가 짧으면 파도가 덜 자라서, 낮고 파장이 짧다.
 * 그래서 같은 바람이 불어도 섬의 뒤쪽은 잔잔하고, 열린 바다로 나갈수록 파도가 높고 길어진다.
 * 취주 거리가 충분히 길면 Pierson–Moskowitz 스펙트럼과 같아진다.
 *
 * @param windSpeed 풍속 (m/s)
 * @param fetch 취주 거리 (m)
 * @param out 결과를 적을 배열. 매 프레임 호출하므로 새 배열을 만들지 않고 받은 배열을 다시 사용한다.
 */
export function jonswapAmplitudes(windSpeed: number, fetch: number, bands: readonly Band[], out: number[]): number[] {
  if (windSpeed < 0.1) {
    for (let i = 0; i < bands.length; i++) out[i] = 0;
    return out;
  }
  const scale = GRAVITY / windSpeed;
  const dimensionlessFetch = (GRAVITY * fetch) / windSpeed ** 2;
  const developedPeak = DEVELOPED_PEAK * scale;
  const peak = peakFrequency(windSpeed, fetch);
  const alpha = Math.max(0.076 * dimensionlessFetch ** -0.22, DEVELOPED_ALPHA);
  // 다 자란 바다에 가까워질수록 봉우리가 완만해진다.
  const youth = Math.min(Math.max((peak / developedPeak - 1) / 0.3, 0), 1);
  const peakedness = 1 + (YOUNG_SEA_PEAKEDNESS - 1) * youth;

  for (let band = 0; band < bands.length; band++) {
    const [low, high] = bands[band];
    // 스펙트럼은 진동수가 높아질수록 급하게 줄어들므로, 구간을 같은 비율로 나누어서 읽는다.
    const ratio = (high / low) ** (1 / BAND_SAMPLES);
    const toMiddle = Math.sqrt(ratio);
    let energy = 0;
    for (let i = 0, from = low; i < BAND_SAMPLES; i++, from *= ratio) {
      const omega = from * toMiddle;
      const sigma = omega <= peak ? 0.07 : 0.09;
      const enhancement = peakedness ** Math.exp(-((omega - peak) ** 2) / (2 * sigma ** 2 * peak ** 2));
      const density = ((alpha * GRAVITY ** 2) / omega ** 5) * Math.exp(-1.25 * (peak / omega) ** 4) * enhancement;
      energy += density * from * (ratio - 1);
    }
    // 진폭이 a인 파도 하나의 에너지는 a²/2이다.
    out[band] = Math.sqrt(2 * energy);
  }
  return out;
}

/** 진폭의 목록에 대응하는 유의파고 (m). 수면 높이의 표준편차에 4를 곱한 값이다. */
export function significantHeight(amplitudes: Iterable<number>): number {
  let variance = 0;
  for (const amplitude of amplitudes) variance += amplitude ** 2 / 2;
  return 4 * Math.sqrt(variance);
}
