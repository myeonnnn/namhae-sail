import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { createOceanMaterial } from './oceanMaterial';
import { GRID_SIZE, PRIMARY_TILE, sampleSea, shapeSea } from './seaSpectrum';
import { SeaSurface, type SeaCascade } from './seaSurface';

// 이 파일은 실제 브라우저에서 돈다 (vitest.config.ts의 browser 프로젝트). WebGL이 있어야 하는 검증을 모았다.

const renderer = new THREE.WebGLRenderer();
renderer.setSize(64, 64);
const shaderErrors: string[] = [];
// 셰이더 컴파일이 실패하면 Three.js는 콘솔에 남기고 그리기만 건너뛴다. 테스트가 실패하도록 내용을 모은다.
renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
  shaderErrors.push(
    [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertexShader), gl.getShaderInfoLog(fragmentShader)]
      .filter(Boolean)
      .join('\n'),
  );
};
const sea = new SeaSurface(renderer);

afterAll(() => renderer.dispose());

/** 렌더 타깃의 RGBA 값을 읽는다. 렌더 타깃은 16비트 실수이므로 32비트로 바꾼다. */
function readTarget(target: THREE.WebGLRenderTarget): Float32Array {
  const raw = new Uint16Array(GRID_SIZE * GRID_SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, GRID_SIZE, GRID_SIZE, raw);
  return Float32Array.from(raw, (value) => THREE.DataUtils.fromHalfFloat(value));
}

/** 두 값의 목록이 얼마나 다른지를, 값 자체의 크기에 대한 비율로 나타낸다. */
function relativeError(actual: number[], expected: number[]): number {
  let error = 0;
  let size = 0;
  for (let i = 0; i < actual.length; i++) {
    error += (actual[i] - expected[i]) ** 2;
    size += expected[i] ** 2;
  }
  return Math.sqrt(error / size);
}

describe('GPU가 만드는 수면', () => {
  it('수면을 만드는 셰이더와 수면을 그리는 셰이더가 컴파일된다', () => {
    shapeSea(1.5, 1.2, 90, 0.8, 130);
    sea.update(10);

    // 하늘과 잔물결, 항적은 이 검증과 무관하므로 빈 텍스처로 채운다.
    const blank = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    blank.needsUpdate = true;
    const material = createOceanMaterial({
      sky: new THREE.CubeTexture(),
      detailNormals: blank,
      sunDirection: new THREE.Vector3(0, 1, 0),
      wake: { texture: blank, center: new THREE.Vector2(), halfExtent: 100 },
      hazeDistance: 9000,
      cascades: sea.cascades as [SeaCascade, SeaCascade, SeaCascade],
      detailDisplaceRange: 140,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2), material));
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 1000);
    camera.position.set(0, 20, 40);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    expect(shaderErrors).toEqual([]);
  });

  it('배가 타는 층의 높이와 수평 변위가 CPU의 계산과 일치한다', () => {
    const time = 123.4;
    shapeSea(2, 1.0, 200, 1.2, 240);
    sea.update(time);
    const pixels = readTarget(sea.cascades[0].displacementTarget);

    const gpu = { height: [] as number[], offsetX: [] as number[], offsetZ: [] as number[] };
    const cpu = { height: [] as number[], offsetX: [] as number[], offsetZ: [] as number[] };
    for (let row = 3; row < GRID_SIZE; row += 17) {
      for (let column = 5; column < GRID_SIZE; column += 13) {
        // 텍스처의 column번째 칸에는 x = column × (무늬의 길이 / 칸 수) 지점의 값이 들어 있다.
        const sample = sampleSea((column * PRIMARY_TILE) / GRID_SIZE, (row * PRIMARY_TILE) / GRID_SIZE, time);
        const index = (row * GRID_SIZE + column) * 4;
        gpu.offsetX.push(pixels[index]);
        gpu.height.push(pixels[index + 1]);
        gpu.offsetZ.push(pixels[index + 2]);
        cpu.offsetX.push(sample.offsetX);
        cpu.height.push(sample.height);
        cpu.offsetZ.push(sample.offsetZ);
      }
    }

    // 16비트 실수로 저장하므로 아주 작은 차이는 남는다. 반 칸만 어긋나도 수십 %가 벌어진다.
    expect(relativeError(gpu.height, cpu.height)).toBeLessThan(0.01);
    expect(relativeError(gpu.offsetX, cpu.offsetX)).toBeLessThan(0.01);
    expect(relativeError(gpu.offsetZ, cpu.offsetZ)).toBeLessThan(0.01);
  });

  it('물거품을 그리는 마루의 가파름이 선체를 넘어뜨리는 가파름과 일치한다', () => {
    const time = 45.6;
    shapeSea(3, 0.9, 30, 0, 0);
    sea.update(time);
    const pixels = readTarget(sea.cascades[0].gradientTarget);

    const gpu: number[] = [];
    const cpu: number[] = [];
    for (let row = 7; row < GRID_SIZE; row += 19) {
      for (let column = 2; column < GRID_SIZE; column += 11) {
        gpu.push(pixels[(row * GRID_SIZE + column) * 4 + 3]);
        cpu.push(sampleSea((column * PRIMARY_TILE) / GRID_SIZE, (row * PRIMARY_TILE) / GRID_SIZE, time).steepness);
      }
    }

    // GPU는 이웃한 칸의 차이로 미분하고 CPU는 수식으로 미분하므로, 짧은 파도일수록 조금씩 다르다.
    expect(relativeError(gpu, cpu)).toBeLessThan(0.1);
  });
});
