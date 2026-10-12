import * as THREE from 'three';

/** 표고 타일 한 변의 픽셀 수 */
export const TILE_PIXELS = 256;
/** 지형 메시의 한 변을 나누는 칸의 수 */
export const TERRAIN_SEGMENTS = 128;
const SEGMENTS = TERRAIN_SEGMENTS;
// 표고가 이 값보다 낮은 지점은 바다로 취급한다. 표고 자료에서 수면은 0m 부근의 값으로 기록되어 있다.
const SEA_LEVEL_THRESHOLD = 1;
// 바다로 취급한 지점은 수면 아래로 내려서 파도와 겹치지 않게 한다.
const SEABED_Y = -6;
// 파도의 마루가 낮은 해안의 땅 위로 솟아오르지 않도록 육지 전체를 조금 들어 올린다.
const LAND_LIFT = 2.5;
const SKIRT_Y = -30;

const COLOR_STOPS: ReadonlyArray<{ height: number; color: THREE.Color }> = [
  { height: 0, color: new THREE.Color(0xbdb59c) },
  { height: 6, color: new THREE.Color(0x9aa873) },
  { height: 60, color: new THREE.Color(0x5f8a4c) },
  { height: 300, color: new THREE.Color(0x45703f) },
  { height: 700, color: new THREE.Color(0x7a7a66) },
];
const ROCK_COLOR = new THREE.Color(0x7d7667);

/**
 * Terrarium 형식의 표고 타일을 미터 단위의 높이 배열로 변환한다.
 * 이 형식은 높이를 색상으로 저장하며, 높이 = (R × 256 + G + B ÷ 256) − 32768이다.
 */
export function decodeTerrarium(pixels: Uint8ClampedArray): Float32Array {
  const heights = new Float32Array(TILE_PIXELS * TILE_PIXELS);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = pixels[i * 4] * 256 + pixels[i * 4 + 1] + pixels[i * 4 + 2] / 256 - 32768;
  }
  return heights;
}

// 한 픽셀이 주변 여덟 픽셀의 중앙값보다 이만큼(m) 높으면 자료의 오류로 보고 중앙값으로 바꾼다.
// 한 픽셀이 약 31m이므로, 실제 지형에서 이런 솟음이 나오려면 사방이 60°에 가까운 절벽이어야 한다.
const SPIKE_THRESHOLD = 50;
// 해안선 자료가 육지라고 판정했는데 표고가 수면 이하인 곳에 주는 높이 (m). 표고 자료에 빠져 있는 작은 섬이 여기에 해당한다.
const MIN_LAND_HEIGHT = 1.5;
// 해안선 자료의 범위 밖에서, 서로 붙어 있는 육지 픽셀이 이 개수 이하이고 낮으면 바다 위의 잡음으로 보고 지운다.
const SPECK_MAX_PIXELS = 12;
const SPECK_MAX_HEIGHT = 10;
const SEA_HEIGHT = -1;

/**
 * 표고 자료의 오류를 정리한다. heights를 직접 수정한다.
 * mask는 LandMask.rasterize의 결과이며(1 육지, 0 바다, 255 범위 밖), 없으면 표고만으로 판정한다.
 */
export function cleanHeights(heights: Float32Array, mask?: Uint8Array): void {
  const size = TILE_PIXELS;

  // 1. 한두 픽셀이 수백 미터씩 솟은 값을 제거한다. 두 픽셀이 붙어 있는 경우를 위해서 두 번 반복한다.
  const neighbours = new Float32Array(8);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const index = y * size + x;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx !== 0 || dy !== 0) neighbours[n++] = heights[index + dy * size + dx];
          }
        }
        neighbours.sort();
        const median = (neighbours[3] + neighbours[4]) / 2;
        if (heights[index] - median > SPIKE_THRESHOLD) heights[index] = median;
      }
    }
  }

  // 2. 해안선 자료가 있는 곳에서는 그 판정을 따른다.
  if (mask) {
    for (let i = 0; i < heights.length; i++) {
      if (mask[i] === 1) heights[i] = Math.max(heights[i], MIN_LAND_HEIGHT);
      else if (mask[i] === 0) heights[i] = Math.min(heights[i], SEA_HEIGHT);
    }
  }

  // 3. 해안선 자료가 없는 곳에서는, 바다 위에 흩어진 작고 낮은 조각을 지운다.
  const visited = new Uint8Array(heights.length);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < heights.length; start++) {
    if (visited[start] || heights[start] < SEA_LEVEL_THRESHOLD || (mask && mask[start] !== 255)) continue;
    members.length = 0;
    let highest = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length) {
      const index = stack.pop()!;
      members.push(index);
      highest = Math.max(highest, heights[index]);
      const x = index % size;
      const y = (index - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const next = ny * size + nx;
        if (!visited[next] && heights[next] >= SEA_LEVEL_THRESHOLD) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }
    if (members.length <= SPECK_MAX_PIXELS && highest < SPECK_MAX_HEIGHT) {
      for (const index of members) heights[index] = SEA_HEIGHT;
    }
  }
}

export interface TerrainSurface {
  geometry: THREE.BufferGeometry;
  /** 메시의 각 정점의 높이 (m). 수면이 0이며, 한 변의 정점 수는 TERRAIN_SEGMENTS + 1이다. */
  surface: Float32Array;
}

/**
 * 높이 배열로 지형의 메시를 생성한다. 육지가 전혀 없는 타일이면 null을 반환한다.
 * 메시의 원점은 타일의 북서쪽 모서리이고, +X(동쪽)와 +Z(남쪽)로 size만큼 펼쳐진다.
 */
export function buildTerrainGeometry(heights: Float32Array, size: number): TerrainSurface | null {
  const side = SEGMENTS + 1;
  const spacing = size / SEGMENTS;
  const pixelStep = TILE_PIXELS / SEGMENTS;

  const raw = new Float32Array(side * side);
  const surface = new Float32Array(side * side);
  let hasLand = false;
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const px = Math.min(TILE_PIXELS - 1, Math.round(column * pixelStep));
      const py = Math.min(TILE_PIXELS - 1, Math.round(row * pixelStep));
      const height = heights[py * TILE_PIXELS + px];
      const index = row * side + column;
      raw[index] = height;
      if (height >= SEA_LEVEL_THRESHOLD) {
        surface[index] = height + LAND_LIFT;
        hasLand = true;
      } else {
        surface[index] = SEABED_Y;
      }
    }
  }
  if (!hasLand) return null;

  // 타일의 가장자리에는 아래로 늘어뜨린 벽(스커트)을 추가한다.
  // 이웃한 타일은 경계에서 서로 다른 픽셀을 읽기 때문에 높이가 조금 어긋나는데, 이 벽이 그 틈을 가린다.
  const edge = edgeIndices(side);
  const vertexCount = side * side + edge.length;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const normal = new THREE.Vector3();
  const color = new THREE.Color();

  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const index = row * side + column;
      // 이웃한 정점과의 높이 차이로 경사를 구한다. 가장자리에서는 자기 자신을 이웃으로 사용한다.
      const west = surface[row * side + Math.max(column - 1, 0)];
      const east = surface[row * side + Math.min(column + 1, side - 1)];
      const north = surface[Math.max(row - 1, 0) * side + column];
      const south = surface[Math.min(row + 1, side - 1) * side + column];
      normal.set(west - east, 2 * spacing, north - south).normalize();

      positions.set([column * spacing, surface[index], row * spacing], index * 3);
      normals.set([normal.x, normal.y, normal.z], index * 3);
      heightColor(raw[index], normal.y, color);
      colors.set([color.r, color.g, color.b], index * 3);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < SEGMENTS; row++) {
    for (let column = 0; column < SEGMENTS; column++) {
      const a = row * side + column;
      const b = a + side;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  edge.forEach((source, i) => {
    const skirt = side * side + i;
    positions.set([positions[source * 3], SKIRT_Y, positions[source * 3 + 2]], skirt * 3);
    normals.set(normals.subarray(source * 3, source * 3 + 3), skirt * 3);
    colors.set(colors.subarray(source * 3, source * 3 + 3), skirt * 3);

    const nextSource = edge[(i + 1) % edge.length];
    const nextSkirt = side * side + ((i + 1) % edge.length);
    indices.push(source, nextSource, skirt, nextSource, nextSkirt, skirt);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, surface };
}

/** 격자의 테두리를 한 바퀴 도는 정점 번호의 목록 */
function edgeIndices(side: number): number[] {
  const last = side - 1;
  const result: number[] = [];
  for (let column = 0; column < last; column++) result.push(column);
  for (let row = 0; row < last; row++) result.push(row * side + last);
  for (let column = last; column > 0; column--) result.push(last * side + column);
  for (let row = last; row > 0; row--) result.push(row * side);
  return result;
}

/** 표고에 따라 해안의 모래색에서 숲의 녹색, 고지대의 암석색으로 변하고, 경사가 급한 곳은 암석색을 섞는다. */
function heightColor(height: number, normalY: number, target: THREE.Color): void {
  let lower = COLOR_STOPS[0];
  let upper = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (height < COLOR_STOPS[i + 1].height) {
      lower = COLOR_STOPS[i];
      upper = COLOR_STOPS[i + 1];
      break;
    }
    lower = upper;
  }
  const span = upper.height - lower.height;
  const t = span > 0 ? THREE.MathUtils.clamp((height - lower.height) / span, 0, 1) : 0;
  target.copy(lower.color).lerp(upper.color, t);
  target.lerp(ROCK_COLOR, THREE.MathUtils.smoothstep(1 - normalY, 0.12, 0.4));
}
