import * as THREE from 'three';

const SIZE = 512;
const WAVE_COUNT = 14;
const MIN_FREQUENCY = 5;
const MAX_FREQUENCY = 22;
const SLOPE_SCALE = 0.9;

/**
 * 정수 주파수의 사인파를 합성해서 경계가 이어지는 물결 노멀 맵을 생성한다.
 * 외부 이미지 파일에 의존하지 않기 위한 절차적 텍스처이다.
 */
export function createWaterNormals(): THREE.DataTexture {
  const random = mulberry32(7);
  const waves = Array.from({ length: WAVE_COUNT }, () => {
    const kx = Math.round((random() * 2 - 1) * MAX_FREQUENCY);
    const ky = Math.sign(random() - 0.5) * Math.round(MIN_FREQUENCY + random() * (MAX_FREQUENCY - MIN_FREQUENCY));
    return { kx, ky, amplitude: 1 / Math.hypot(kx, ky), phase: random() * Math.PI * 2 };
  });

  const data = new Uint8Array(SIZE * SIZE * 4);
  const twoPi = Math.PI * 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let slopeX = 0;
      let slopeY = 0;
      for (const wave of waves) {
        const slope = wave.amplitude * Math.cos((twoPi * (wave.kx * x + wave.ky * y)) / SIZE + wave.phase);
        slopeX += slope * wave.kx;
        slopeY += slope * wave.ky;
      }

      const nx = -slopeX * SLOPE_SCALE;
      const ny = -slopeY * SLOPE_SCALE;
      const inverseLength = 1 / Math.hypot(nx, ny, 1);
      const index = (y * SIZE + x) * 4;
      data[index] = (nx * inverseLength * 0.5 + 0.5) * 255;
      data[index + 1] = (ny * inverseLength * 0.5 + 0.5) * 255;
      data[index + 2] = (inverseLength * 0.5 + 0.5) * 255;
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
