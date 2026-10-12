import { latLonToTile } from '../geo/projection';
import { REGION } from '../geo/region';

const LAND_URL = '/data/land.json';

interface LandPolygon {
  /** 타일 좌표로 변환한 꼭짓점 (x, y가 번갈아 들어 있다) */
  points: Float64Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 해안선 자료(public/data/land.json)로 "어디가 육지인가"를 판정하는 마스크를 만든다.
 *
 * 표고 자료에는 바다 위에 1~8m 높이의 작은 잡음이 흩어져 있어서, 표고만으로 육지를 판정하면
 * 바다에 납작한 땅 조각이 떠 있는 것처럼 보인다. 육지의 범위는 해안선 자료로 정하고, 표고 자료는 높이에만 사용한다.
 * 해도도 같은 해안선 자료로 그리므로, 3D 화면의 해안선과 해도의 해안선이 일치하게 된다.
 */
export class LandMask {
  private readonly polygons: LandPolygon[] = [];
  private readonly context: OffscreenCanvasRenderingContext2D;
  // 해안선 자료가 있는 범위. 이 범위의 바깥은 판정할 수 없으므로 표고 자료를 그대로 사용한다.
  private readonly covered = {
    west: REGION.bounds.west - REGION.dataMargin,
    east: REGION.bounds.east + REGION.dataMargin,
    south: REGION.bounds.south - REGION.dataMargin,
    north: REGION.bounds.north + REGION.dataMargin,
  };

  private constructor(
    private readonly zoom: number,
    private readonly tilePixels: number,
  ) {
    this.context = new OffscreenCanvas(tilePixels, tilePixels).getContext('2d', { willReadFrequently: true })!;
  }

  static async load(zoom: number, tilePixels: number): Promise<LandMask> {
    const mask = new LandMask(zoom, tilePixels);
    const response = await fetch(LAND_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const land = (await response.json()) as { geometry: { coordinates: [number, number][][][] } };

    // 타일마다 경위도를 다시 변환하지 않도록, 모든 꼭짓점을 타일 좌표로 한 번만 바꿔 둔다.
    for (const [ring] of land.geometry.coordinates) {
      const points = new Float64Array(ring.length * 2);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      ring.forEach(([lon, lat], i) => {
        const { x, y } = latLonToTile({ lat, lon }, zoom);
        points[i * 2] = x;
        points[i * 2 + 1] = y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
      mask.polygons.push({ points, minX, maxX, minY, maxY });
    }
    return mask;
  }

  /**
   * 타일 한 장의 픽셀마다 판정한 결과를 반환한다: 1은 육지, 0은 바다, 255는 해안선 자료의 범위 밖이다.
   * 폴리곤의 안쪽을 직접 계산하지 않고, 캔버스에 폴리곤을 칠한 다음에 픽셀을 읽는다.
   */
  rasterize(tileX: number, tileY: number): Uint8Array {
    const { context, tilePixels, zoom } = this;
    context.clearRect(0, 0, tilePixels, tilePixels);
    context.fillStyle = '#000';
    context.beginPath();
    for (const polygon of this.polygons) {
      // 이 타일과 겹치지 않는 폴리곤은 건너뛴다.
      if (polygon.maxX < tileX || polygon.minX > tileX + 1 || polygon.maxY < tileY || polygon.minY > tileY + 1) continue;
      const { points } = polygon;
      context.moveTo((points[0] - tileX) * tilePixels, (points[1] - tileY) * tilePixels);
      for (let i = 2; i < points.length; i += 2) {
        context.lineTo((points[i] - tileX) * tilePixels, (points[i + 1] - tileY) * tilePixels);
      }
      context.closePath();
    }
    context.fill();
    const alpha = context.getImageData(0, 0, tilePixels, tilePixels).data;

    // 해안선 자료가 있는 범위를 이 타일의 픽셀 좌표로 바꾼다.
    const northWest = latLonToTile({ lat: this.covered.north, lon: this.covered.west }, zoom);
    const southEast = latLonToTile({ lat: this.covered.south, lon: this.covered.east }, zoom);
    const left = (northWest.x - tileX) * tilePixels;
    const right = (southEast.x - tileX) * tilePixels;
    const top = (northWest.y - tileY) * tilePixels;
    const bottom = (southEast.y - tileY) * tilePixels;

    const result = new Uint8Array(tilePixels * tilePixels);
    for (let y = 0; y < tilePixels; y++) {
      for (let x = 0; x < tilePixels; x++) {
        const index = y * tilePixels + x;
        const inside = x + 0.5 >= left && x + 0.5 <= right && y + 0.5 >= top && y + 0.5 <= bottom;
        result[index] = inside ? (alpha[index * 4 + 3] > 127 ? 1 : 0) : 255;
      }
    }
    return result;
  }
}
