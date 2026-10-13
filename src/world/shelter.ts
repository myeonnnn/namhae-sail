import { latLonToWorld } from '../geo/projection';
import { REGION } from '../geo/region';
import { distanceToLand } from './shoreDistance';

const LAND_URL = '/data/land.json';
// 육지를 기록하는 격자의 한 칸 (m). 파도를 막는 섬을 구분하는 데에는 이 정도면 충분하다.
const CELL_SIZE = 100;
// 바람이 불어온 거리를 재는 간격 (m)
const RAY_STEP = 100;
// 육지를 만나지 않아도 이 거리(m)에서 측정을 멈춘다. 구역의 남쪽과 동쪽은 대한해협으로 열려 있다.
export const OPEN_SEA_FETCH = 80000;
// 해안에 붙어 있어도 파도가 완전히 사라지지는 않으므로, 이보다 짧게는 보지 않는다 (m).
const MIN_FETCH = 200;
// 바람은 한 줄로 불어오지 않으므로, 풍향의 좌우로 벌린 여러 방향을 함께 잰다 (도).
const RAY_OFFSETS = [-30, -15, 0, 15, 30];

/** 구역 전체에서 해안이 얼마나 가까운지를 기록한 지도. 수면의 셰이더가 얕은 물의 색을 정하는 데 사용한다. */
export interface ShoreMap {
  /** 칸마다의 값: 해안에 닿아 있으면 255, range만큼 떨어져 있으면 0 */
  data: Uint8Array;
  columns: number;
  rows: number;
  /** 지도의 북서쪽 모서리 (월드 좌표, m) */
  minX: number;
  minZ: number;
  cellSize: number;
}

/**
 * 한 지점에서 바람이 불어오는 쪽으로 육지를 만날 때까지의 거리(취주 거리, m)를 잰다.
 * 풍향의 좌우 방향도 함께 재서, 풍향에 가까울수록 큰 비중으로 평균한다.
 * 좁은 수로처럼 한 방향으로만 길게 열린 곳에서 거리가 과장되지 않게 한다.
 */
export function measureFetch(
  isLand: (x: number, z: number) => boolean,
  x: number,
  z: number,
  fromDeg: number,
  maxFetch = OPEN_SEA_FETCH,
): number {
  let weighted = 0;
  let weights = 0;
  for (const offset of RAY_OFFSETS) {
    const angle = ((fromDeg + offset) * Math.PI) / 180;
    // 북쪽이 -Z이므로, 방위 angle을 향하는 단위 벡터는 (sin, -cos)이다.
    const dirX = Math.sin(angle);
    const dirZ = -Math.cos(angle);
    let distance = RAY_STEP;
    while (distance < maxFetch && !isLand(x + dirX * distance, z + dirZ * distance)) distance += RAY_STEP;
    const weight = Math.cos((offset * Math.PI) / 180);
    weighted += Math.min(distance, maxFetch) * weight;
    weights += weight;
  }
  return Math.max(weighted / weights, MIN_FETCH);
}

/**
 * 구역 전체의 육지를 성긴 격자로 기록해 두고, 바람과 너울이 섬에 얼마나 가려지는지를 판정한다.
 * 지형의 메시는 배 주변만 불러오므로, 수십 km 떨어진 섬까지 확인하려면 별도의 자료가 필요하다.
 */
export class Shelter {
  private constructor(
    private readonly land: Uint8Array,
    private readonly columns: number,
    private readonly rows: number,
    private readonly minX: number,
    private readonly minZ: number,
  ) {}

  static async load(): Promise<Shelter> {
    const response = await fetch(LAND_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { geometry } = (await response.json()) as { geometry: { coordinates: [number, number][][][] } };

    // 해안선 자료가 있는 범위를 월드 좌표의 격자로 덮는다. 북쪽이 -Z이므로 북서쪽 모서리가 격자의 원점이 된다.
    const { bounds, dataMargin } = REGION;
    const min = latLonToWorld({ lat: bounds.north + dataMargin, lon: bounds.west - dataMargin });
    const max = latLonToWorld({ lat: bounds.south - dataMargin, lon: bounds.east + dataMargin });
    const columns = Math.ceil((max.x - min.x) / CELL_SIZE);
    const rows = Math.ceil((max.z - min.z) / CELL_SIZE);

    // 폴리곤의 안쪽을 직접 계산하지 않고, 캔버스에 폴리곤을 칠한 다음에 픽셀을 읽는다.
    const context = new OffscreenCanvas(columns, rows).getContext('2d')!;
    context.beginPath();
    for (const [ring] of geometry.coordinates) {
      ring.forEach(([lon, lat], i) => {
        const { x, z } = latLonToWorld({ lat, lon });
        const px = (x - min.x) / CELL_SIZE;
        const py = (z - min.z) / CELL_SIZE;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.closePath();
    }
    context.fill();
    const pixels = context.getImageData(0, 0, columns, rows).data;
    const land = new Uint8Array(columns * rows);
    for (let i = 0; i < land.length; i++) land[i] = pixels[i * 4 + 3] > 127 ? 1 : 0;
    return new Shelter(land, columns, rows, min.x, min.z);
  }

  /** 월드의 (x, z) 지점이 육지이면 true. 자료의 범위 밖은 열린 바다로 본다. */
  isLand(x: number, z: number): boolean {
    const column = Math.floor((x - this.minX) / CELL_SIZE);
    const row = Math.floor((z - this.minZ) / CELL_SIZE);
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return false;
    return this.land[row * this.columns + column] === 1;
  }

  /**
   * 해안에서 range(m) 이내의 수면을 가까울수록 큰 값으로 기록한 지도를 만든다.
   * 수심 자료가 없으므로, 해안에 가까운 곳을 얕은 물로 간주하는 데 사용한다.
   */
  shoreMap(range: number): ShoreMap {
    const distance = distanceToLand(this.land, this.columns, this.rows);
    const data = new Uint8Array(distance.length);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.round(255 * Math.max(1 - (distance[i] * CELL_SIZE) / range, 0));
    }
    return { data, columns: this.columns, rows: this.rows, minX: this.minX, minZ: this.minZ, cellSize: CELL_SIZE };
  }

  /** 한 지점에서 fromDeg 방향으로 열려 있는 수면의 거리 (m) */
  fetch(x: number, z: number, fromDeg: number): number {
    return measureFetch((px, pz) => this.isLand(px, pz), x, z, fromDeg);
  }
}
