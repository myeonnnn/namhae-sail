import { describe, expect, it } from 'vitest';
import { seededRandom } from '../core/random';
import { buildTerrainGeometry, cleanHeights, TERRAIN_SEGMENTS, TILE_PIXELS } from './terrainTile';

const at = (x: number, y: number) => y * TILE_PIXELS + x;
const sea = () => new Float32Array(TILE_PIXELS * TILE_PIXELS).fill(-5);

describe('cleanHeights', () => {
  it('removes a one-pixel spike but keeps a broad hill', () => {
    const heights = sea();
    // 완만한 언덕: 가운데가 120m이고 한 픽셀마다 4m씩 낮아진다.
    for (let y = 60; y <= 140; y++) {
      for (let x = 60; x <= 140; x++)
        heights[at(x, y)] = Math.max(2, 120 - 4 * Math.max(Math.abs(x - 100), Math.abs(y - 100)));
    }
    heights[at(100, 100)] = 120;
    heights[at(70, 70)] = 900;
    cleanHeights(heights);
    expect(heights[at(70, 70)]).toBeLessThan(20);
    expect(heights[at(100, 100)]).toBe(120);
    expect(heights[at(110, 100)]).toBe(80);
  });

  it('erases small low specks in the sea but keeps a tall rock and a real island', () => {
    const heights = sea();
    heights[at(20, 20)] = 3;
    heights[at(21, 20)] = 4;
    // 작지만 높은 바위섬
    heights[at(50, 50)] = 25;
    heights[at(51, 50)] = 30;
    // 넓고 낮은 섬
    for (let y = 150; y < 160; y++) for (let x = 150; x < 160; x++) heights[at(x, y)] = 3;
    cleanHeights(heights);
    expect(heights[at(20, 20)]).toBeLessThan(0);
    expect(heights[at(21, 20)]).toBeLessThan(0);
    expect(heights[at(51, 50)]).toBe(30);
    expect(heights[at(155, 155)]).toBe(3);
  });

  it('follows the coastline mask where it is available', () => {
    const heights = sea();
    const mask = new Uint8Array(TILE_PIXELS * TILE_PIXELS).fill(255);
    // 표고에는 땅으로 기록되어 있지만 해안선 자료로는 바다인 곳
    heights[at(30, 30)] = 6;
    mask[at(30, 30)] = 0;
    // 표고에는 빠져 있지만 해안선 자료로는 육지인 곳
    mask[at(40, 40)] = 1;
    cleanHeights(heights, mask);
    expect(heights[at(30, 30)]).toBeLessThan(0);
    expect(heights[at(40, 40)]).toBeGreaterThan(1);
  });
});

// 게임의 지형 타일은 한 변이 약 8 km이고 격자 간격은 약 63 m이다 (docs/spec.md 3절).
const TILE_SIZE = 63 * TERRAIN_SEGMENTS;
const SIDE = TERRAIN_SEGMENTS + 1;
const PIXEL_STEP = TILE_PIXELS / TERRAIN_SEGMENTS;
// 육지로 보는 표고 기준(1 m)을 겨우 넘는 가장 낮은 해안
const LOWEST_LAND = 1.01;

/** 정점 (row, column)이 읽는 표고 픽셀의 값. 이 값이 1 m 이상이면 "육지 꼭짓점"이다. */
function vertexPixel(heights: Float32Array, row: number, column: number): number {
  const x = Math.min(TILE_PIXELS - 1, Math.round(column * PIXEL_STEP));
  const y = Math.min(TILE_PIXELS - 1, Math.round(row * PIXEL_STEP));
  return heights[at(x, y)];
}

/**
 * 높이 land(> 0)인 꼭짓점에서 높이 seaHeight인 이웃 꼭짓점까지 직선으로 이었을 때,
 * 높이가 level이 되는 곳까지의 거리를 격자 한 칸에 대한 비율로 돌려준다.
 * 이웃 꼭짓점이 level보다 높으면 그 칸 안에서는 level에 닿지 않으므로, 물가선은 적어도 칸 끝까지 간다.
 * 이때는 1을 돌려준다 (실제 거리의 하한).
 */
function crossing(land: number, seaHeight: number, level: number): number {
  if (seaHeight >= level) return 1;
  return (land - level) / (land - seaHeight);
}

interface CoastEdge {
  land: number;
  sea: number;
}

/** 표고 픽셀로 육지인 꼭짓점과, 그 상하좌우로 이웃한 바다 꼭짓점의 쌍을 모두 모은다. */
function coastEdges(heights: Float32Array, surface: Float32Array): CoastEdge[] {
  const edges: CoastEdge[] = [];
  for (let row = 0; row < SIDE; row++) {
    for (let column = 0; column < SIDE; column++) {
      if (vertexPixel(heights, row, column) < 1) continue;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || c < 0 || r >= SIDE || c >= SIDE) continue;
        if (vertexPixel(heights, r, c) >= 1) continue;
        edges.push({ land: surface[row * SIDE + column], sea: surface[r * SIDE + c] });
      }
    }
  }
  return edges;
}

/** 서쪽 절반은 높이 landHeight인 육지, 동쪽 절반은 표고 seaHeight인 바다인 곧은 해안 */
function straightCoast(landHeight: number, seaHeight: number): Float32Array {
  const heights = new Float32Array(TILE_PIXELS * TILE_PIXELS);
  for (let y = 0; y < TILE_PIXELS; y++)
    for (let x = 0; x < TILE_PIXELS; x++) heights[at(x, y)] = x < TILE_PIXELS / 2 ? landHeight : seaHeight;
  return heights;
}

/** 무작위 바다 깊이 위에 낮은 섬 여러 개가 흩어진 타일. 해안이 여러 방향으로 꺾인다. */
function scatteredIslands(seed: number): Float32Array {
  const random = seededRandom(seed);
  const heights = new Float32Array(TILE_PIXELS * TILE_PIXELS);
  // 바다는 거의 수면(0.9 m, 육지 기준 바로 아래)부터 깊은 곳(-30 m)까지 섞는다.
  for (let i = 0; i < heights.length; i++) heights[i] = 0.9 - random() * 30.9;
  for (let island = 0; island < 25; island++) {
    const cx = random() * TILE_PIXELS;
    const cy = random() * TILE_PIXELS;
    const radius = 2 + random() * 20;
    for (let y = 0; y < TILE_PIXELS; y++)
      for (let x = 0; x < TILE_PIXELS; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) heights[at(x, y)] = 1 + random() * 0.5;
  }
  return heights;
}

const SEA_HEIGHTS = [0.9, 0.5, 0, -0.5, -1, -2, -5, -30];

describe('buildTerrainGeometry의 해안 비탈', () => {
  it('가장 낮은 해안에서도 육지 꼭짓점은 0 m보다 높고, 이웃한 바다 꼭짓점은 0 m보다 낮다', () => {
    for (const seaHeight of SEA_HEIGHTS) {
      const heights = straightCoast(LOWEST_LAND, seaHeight);
      const built = buildTerrainGeometry(heights, TILE_SIZE);
      expect(built, `바다 ${seaHeight} m`).not.toBeNull();
      const edges = coastEdges(heights, built!.surface);
      expect(edges.length).toBeGreaterThan(0);
      for (const edge of edges) {
        expect(edge.land, `바다 ${seaHeight} m의 육지 꼭짓점`).toBeGreaterThan(0);
        expect(edge.sea, `바다 ${seaHeight} m의 바다 꼭짓점`).toBeLessThan(0);
      }
    }
  });

  it('가장 낮은 해안에서 좌초 경계(높이 0 m)는 육지 꼭짓점에서 격자 한 칸의 12% 이내에 있다', () => {
    for (const seaHeight of SEA_HEIGHTS) {
      const heights = straightCoast(LOWEST_LAND, seaHeight);
      const edges = coastEdges(heights, buildTerrainGeometry(heights, TILE_SIZE)!.surface);
      for (const edge of edges)
        expect(crossing(edge.land, edge.sea, 0), `바다 ${seaHeight} m`).toBeLessThanOrEqual(0.12);
    }
  });

  it('가장 낮은 해안에서 수면이 2 m 내려가도 물가선은 바다 쪽으로 격자 한 칸의 7% 이내만 움직인다', () => {
    for (const seaHeight of SEA_HEIGHTS) {
      const heights = straightCoast(LOWEST_LAND, seaHeight);
      const edges = coastEdges(heights, buildTerrainGeometry(heights, TILE_SIZE)!.surface);
      for (const edge of edges) {
        const shift = crossing(edge.land, edge.sea, -2) - crossing(edge.land, edge.sea, 0);
        expect(shift, `바다 ${seaHeight} m`).toBeLessThanOrEqual(0.07);
      }
    }
  });

  it('63 m 간격에서 물가선의 이동은 4.5 m 이내이다', () => {
    const heights = straightCoast(LOWEST_LAND, -1);
    const edges = coastEdges(heights, buildTerrainGeometry(heights, TILE_SIZE)!.surface);
    const spacing = TILE_SIZE / TERRAIN_SEGMENTS;
    expect(spacing).toBeCloseTo(63, 6);
    for (const edge of edges) {
      const shift = (crossing(edge.land, edge.sea, -2) - crossing(edge.land, edge.sea, 0)) * spacing;
      expect(shift).toBeLessThanOrEqual(4.5);
    }
  });

  it('여러 방향으로 꺾인 낮은 섬들의 해안에서도 두 조건을 지킨다', () => {
    const heights = scatteredIslands(20261016);
    const built = buildTerrainGeometry(heights, TILE_SIZE);
    expect(built).not.toBeNull();
    const edges = coastEdges(heights, built!.surface);
    expect(edges.length).toBeGreaterThan(100);
    for (const edge of edges) {
      expect(edge.land).toBeGreaterThan(0);
      expect(crossing(edge.land, edge.sea, 0)).toBeLessThanOrEqual(0.12);
      expect(crossing(edge.land, edge.sea, -2) - crossing(edge.land, edge.sea, 0)).toBeLessThanOrEqual(0.07);
    }
  });

  it('바다 한가운데의 꼭짓점 하나짜리 바위도 두 조건을 지킨다', () => {
    const heights = sea();
    // 정점 (64, 64)가 읽는 픽셀 하나만 육지이다.
    heights[at(64 * PIXEL_STEP, 64 * PIXEL_STEP)] = LOWEST_LAND;
    const built = buildTerrainGeometry(heights, TILE_SIZE);
    expect(built).not.toBeNull();
    const edges = coastEdges(heights, built!.surface);
    expect(edges).toHaveLength(4);
    for (const edge of edges) {
      expect(edge.land).toBeGreaterThan(0);
      expect(crossing(edge.land, edge.sea, 0)).toBeLessThanOrEqual(0.12);
      expect(crossing(edge.land, edge.sea, -2) - crossing(edge.land, edge.sea, 0)).toBeLessThanOrEqual(0.07);
    }
  });

  it('육지가 없는 타일은 null을 돌려준다', () => {
    expect(buildTerrainGeometry(sea(), TILE_SIZE)).toBeNull();
  });
});
