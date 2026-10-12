import * as THREE from 'three';
import { tileToWorld, worldToTile } from '../geo/projection';
import { buildTerrainGeometry, decodeTerrarium, TERRAIN_SEGMENTS, TILE_PIXELS } from './terrainTile';

// 줌 12에서 타일 한 장은 약 8km이고, 표고 한 픽셀은 약 31m이다.
const TILE_ZOOM = 12;
const LOAD_RADIUS = 14000;
// 불러오는 거리보다 멀리 설정해서, 경계 부근을 오갈 때 같은 타일을 반복해서 불러오지 않게 한다.
const UNLOAD_RADIUS = 17000;
const REFRESH_INTERVAL_MS = 500;

/**
 * AWS 공개 데이터의 표고 타일(Mapzen Terrain Tiles, Terrarium 형식).
 * 육지의 표고는 SRTM을 기반으로 하며, 자료의 출처를 화면에 표기해야 한다.
 */
const tileUrl = (zoom: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;

interface TerrainTile {
  x: number;
  z: number;
  size: number;
  /** 메시의 정점별 높이. 불러오는 중이거나 실패한 타일, 육지가 없는 타일에는 없으며 바다로 취급한다. */
  surface?: Float32Array;
  mesh?: THREE.Mesh;
}

/** 배 주변의 표고 타일을 불러와서 지형으로 표시하고, 멀어진 타일은 해제한다. */
export class Terrain {
  private readonly tiles = new Map<string, TerrainTile>();
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    // 스커트는 바깥쪽에서 보이는 면의 방향이 변마다 다르므로 양면을 모두 그린다.
    side: THREE.DoubleSide,
  });
  private readonly decodeContext: OffscreenCanvasRenderingContext2D;
  private lastRefreshTime = -Infinity;

  constructor(private readonly scene: THREE.Scene) {
    this.decodeContext = new OffscreenCanvas(TILE_PIXELS, TILE_PIXELS).getContext('2d', {
      willReadFrequently: true,
    })!;
  }

  update(focusX: number, focusZ: number): void {
    const now = performance.now();
    if (now - this.lastRefreshTime < REFRESH_INTERVAL_MS) return;
    this.lastRefreshTime = now;

    const center = worldToTile(focusX, focusZ, TILE_ZOOM);
    const { size } = tileToWorld(0, 0, TILE_ZOOM);
    const reach = Math.ceil(LOAD_RADIUS / size);

    for (let ty = Math.floor(center.y) - reach; ty <= Math.floor(center.y) + reach; ty++) {
      for (let tx = Math.floor(center.x) - reach; tx <= Math.floor(center.x) + reach; tx++) {
        const key = `${tx}/${ty}`;
        if (this.tiles.has(key)) continue;
        const tile: TerrainTile = tileToWorld(tx, ty, TILE_ZOOM);
        if (distanceToTile(tile, focusX, focusZ) > LOAD_RADIUS) continue;
        this.tiles.set(key, tile);
        void this.loadTile(key, tile, tileUrl(TILE_ZOOM, tx, ty));
      }
    }

    for (const [key, tile] of this.tiles) {
      if (distanceToTile(tile, focusX, focusZ) <= UNLOAD_RADIUS) continue;
      if (tile.mesh) {
        this.scene.remove(tile.mesh);
        // 지오메트리는 GPU의 메모리를 사용하므로 직접 해제해야 한다.
        tile.mesh.geometry.dispose();
      }
      this.tiles.delete(key);
    }
  }

  /**
   * 월드의 (x, z) 지점이 수면 위로 솟은 땅인지 판정한다.
   * 원본 표고가 아니라 화면에 그려진 메시의 높이를 읽으므로, 눈에 보이는 해안선과 판정이 일치한다.
   */
  isLand(x: number, z: number): boolean {
    return (this.heightAt(x, z) ?? -1) > 0;
  }

  /**
   * 월드의 (x, z) 지점에서 화면에 그려진 지형의 높이 (m). 수면이 0이다.
   * 지형이 아직 불러와지지 않았거나 육지가 없는 타일이면 undefined를 반환한다.
   */
  heightAt(x: number, z: number): number | undefined {
    const tileCoord = worldToTile(x, z, TILE_ZOOM);
    const tx = Math.floor(tileCoord.x);
    const ty = Math.floor(tileCoord.y);
    const surface = this.tiles.get(`${tx}/${ty}`)?.surface;
    if (!surface) return undefined;

    // 지점을 둘러싼 네 정점의 높이를 거리에 따라 섞는다(쌍선형 보간).
    const side = TERRAIN_SEGMENTS + 1;
    const gridX = (tileCoord.x - tx) * TERRAIN_SEGMENTS;
    const gridZ = (tileCoord.y - ty) * TERRAIN_SEGMENTS;
    const column = Math.min(Math.floor(gridX), TERRAIN_SEGMENTS - 1);
    const row = Math.min(Math.floor(gridZ), TERRAIN_SEGMENTS - 1);
    const fx = gridX - column;
    const fz = gridZ - row;
    const index = row * side + column;
    const north = surface[index] * (1 - fx) + surface[index + 1] * fx;
    const south = surface[index + side] * (1 - fx) + surface[index + side + 1] * fx;
    return north * (1 - fz) + south * fz;
  }

  private async loadTile(key: string, tile: TerrainTile, url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      // 응답을 기다리는 동안 배가 멀어져서 이미 해제된 타일이면 버린다.
      if (this.tiles.get(key) !== tile) return;

      this.decodeContext.drawImage(bitmap, 0, 0);
      bitmap.close();
      const heights = decodeTerrarium(this.decodeContext.getImageData(0, 0, TILE_PIXELS, TILE_PIXELS).data);

      const built = buildTerrainGeometry(heights, tile.size);
      if (!built) return;
      tile.surface = built.surface;
      tile.mesh = new THREE.Mesh(built.geometry, this.material);
      tile.mesh.position.set(tile.x, 0, tile.z);
      this.scene.add(tile.mesh);
    } catch (error) {
      // 실패한 타일은 목록에 남겨 두어서 반복해서 요청하지 않는다. 배가 멀어졌다가 돌아오면 다시 시도한다.
      console.warn(`표고 타일을 불러오지 못했습니다: ${url}`, error);
    }
  }
}

/** 한 지점에서 타일의 영역까지의 최단 거리. 지점이 타일 안에 있으면 0이다. */
function distanceToTile(tile: TerrainTile, x: number, z: number): number {
  const dx = Math.max(tile.x - x, 0, x - (tile.x + tile.size));
  const dz = Math.max(tile.z - z, 0, z - (tile.z + tile.size));
  return Math.hypot(dx, dz);
}
