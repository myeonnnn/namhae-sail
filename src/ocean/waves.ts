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
// 파도가 진행하는 주 방향. 북쪽을 0으로 하는 시계 방향 각도이며, 남서풍이 만드는 북동향의 파도이다.
const MAIN_DIRECTION_DEG = 50;
// 모든 파도의 마루가 겹쳤을 때의 뾰족한 정도. 1 이상이면 수면이 꼬인다.
const TOTAL_STEEPNESS = 0.7;

const WAVE_TABLE: ReadonlyArray<{ wavelength: number; amplitude: number; spreadDeg: number }> = [
  { wavelength: 150, amplitude: 0.9, spreadDeg: -10 },
  { wavelength: 95, amplitude: 0.6, spreadDeg: 25 },
  { wavelength: 62, amplitude: 0.42, spreadDeg: -35 },
  { wavelength: 41, amplitude: 0.28, spreadDeg: 15 },
  { wavelength: 27, amplitude: 0.18, spreadDeg: -50 },
  { wavelength: 17, amplitude: 0.11, spreadDeg: 40 },
  { wavelength: 11, amplitude: 0.07, spreadDeg: -20 },
  { wavelength: 7.5, amplitude: 0.045, spreadDeg: 60 },
];

export const WAVES: ReadonlyArray<Wave> = WAVE_TABLE.map(({ wavelength, amplitude, spreadDeg }) => {
  const angle = ((MAIN_DIRECTION_DEG + spreadDeg) * Math.PI) / 180;
  const k = (Math.PI * 2) / wavelength;
  return {
    dirX: Math.sin(angle),
    dirZ: -Math.cos(angle),
    wavelength,
    amplitude,
    k,
    omega: Math.sqrt(GRAVITY * k),
    q: TOTAL_STEEPNESS / (k * amplitude * WAVE_TABLE.length),
  };
});

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
