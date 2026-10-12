import * as THREE from 'three';

const SEGMENTS = 400;
const HALF_EXTENT = 15000;
// 격자의 중심부에서 선형으로 늘어나는 비율. 값이 작을수록 중심부의 정점이 촘촘해진다.
const LINEAR_RATIO = 1 / 30;

/** 격자의 중심부에서 정점 사이의 간격 (m). 격자를 이 간격의 배수로만 이동시키면 수면이 일렁이지 않는다. */
export const OCEAN_CELL_SIZE = (HALF_EXTENT * LINEAR_RATIO) / (SEGMENTS / 2);

/**
 * 수평면(XZ)에 놓인 격자를 생성한다.
 * 배 주변은 파도의 형태를 표현할 수 있도록 촘촘하게, 먼 곳은 성기게 배치해서 정점의 수를 절약한다.
 */
export function createOceanGeometry(): THREE.BufferGeometry {
  const side = SEGMENTS + 1;
  const coordinates = new Float32Array(side);
  for (let i = 0; i < side; i++) {
    const u = (i / SEGMENTS) * 2 - 1;
    const r = Math.abs(u);
    coordinates[i] = Math.sign(u) * HALF_EXTENT * (LINEAR_RATIO * r + (1 - LINEAR_RATIO) * r ** 4);
  }

  const positions = new Float32Array(side * side * 3);
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const index = (row * side + column) * 3;
      positions[index] = coordinates[column];
      positions[index + 2] = coordinates[row];
    }
  }

  const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6);
  let cursor = 0;
  for (let row = 0; row < SEGMENTS; row++) {
    for (let column = 0; column < SEGMENTS; column++) {
      const a = row * side + column;
      const b = a + side;
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = a + 1;
      indices[cursor++] = a + 1;
      indices[cursor++] = b;
      indices[cursor++] = b + 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}
