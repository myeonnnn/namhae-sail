import { latLonToTile, metersPerTilePixel, worldToLatLon } from '../geo/projection';
import type { ShipState } from '../ship/shipPhysics';

const VIEW_SIZE = 280;
const TILE_SIZE = 256;
const MIN_ZOOM = 7;
const MAX_ZOOM = 16;
const DEFAULT_ZOOM = 10;
const REDRAW_INTERVAL_MS = 100;
const MAX_CACHED_TILES = 300;
const SEA_COLOR = '#aad3df';

/** 아래에서 위의 순서로 겹쳐서 그리는 타일 레이어 */
const LAYERS = [
  // 육지, 섬, 지명, 항만 시설을 표시하는 기본 지도
  { name: 'base', url: (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
  // 등대, 부표, 항로 표지를 표시하는 투명한 해상 표지 레이어
  { name: 'seamark', url: (z: number, x: number, y: number) => `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png` },
] as const;

/**
 * 배의 위치를 중심으로 하는 북쪽 고정 지도.
 * 표시하는 타일의 수가 적으므로 공개 타일 서버를 직접 사용하며, 한 번 받은 타일은 메모리에 보관한다.
 */
export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly tiles = new Map<string, HTMLImageElement>();
  private zoom = DEFAULT_ZOOM;
  private lastDrawTime = -Infinity;

  constructor(root: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-minimap';

    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = VIEW_SIZE * pixelRatio;
    this.canvas.height = VIEW_SIZE * pixelRatio;
    this.canvas.style.width = `${VIEW_SIZE}px`;
    this.canvas.style.height = `${VIEW_SIZE}px`;
    this.context = this.canvas.getContext('2d')!;
    this.context.scale(pixelRatio, pixelRatio);

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.setZoom(this.zoom - Math.sign(event.deltaY));
      },
      { passive: false },
    );

    const controls = document.createElement('div');
    controls.className = 'hud-minimap-zoom';
    controls.append(this.createZoomButton('+', 1), this.createZoomButton('−', -1));

    const attribution = document.createElement('div');
    attribution.className = 'hud-minimap-attribution';
    attribution.textContent = '© OpenStreetMap contributors · OpenSeaMap';

    panel.append(this.canvas, controls, attribution);
    root.append(panel);
  }

  update(ship: ShipState): void {
    const now = performance.now();
    if (now - this.lastDrawTime < REDRAW_INTERVAL_MS) return;
    this.lastDrawTime = now;

    const { context, zoom } = this;
    const position = worldToLatLon(ship.x, ship.z);
    const center = latLonToTile(position, zoom);
    // 화면의 왼쪽 위 모서리가 전 세계를 하나의 이미지로 펼친 좌표에서 어디인지 계산한다.
    const left = center.x * TILE_SIZE - VIEW_SIZE / 2;
    const top = center.y * TILE_SIZE - VIEW_SIZE / 2;
    const tileCount = 2 ** zoom;

    context.fillStyle = SEA_COLOR;
    context.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    for (const layer of LAYERS) {
      for (let ty = Math.floor(top / TILE_SIZE); ty * TILE_SIZE < top + VIEW_SIZE; ty++) {
        for (let tx = Math.floor(left / TILE_SIZE); tx * TILE_SIZE < left + VIEW_SIZE; tx++) {
          if (tx < 0 || ty < 0 || tx >= tileCount || ty >= tileCount) continue;
          const image = this.getTile(`${layer.name}/${zoom}/${tx}/${ty}`, layer.url(zoom, tx, ty));
          if (!image.complete || image.naturalWidth === 0) continue;
          context.drawImage(image, Math.round(tx * TILE_SIZE - left), Math.round(ty * TILE_SIZE - top));
        }
      }
    }

    this.drawScaleBar(metersPerTilePixel(position.lat, zoom));
    this.drawShip(ship.heading);
  }

  private setZoom(zoom: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.lastDrawTime = -Infinity;
  }

  private createZoomButton(label: string, delta: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.tabIndex = -1;
    button.addEventListener('click', () => {
      this.setZoom(this.zoom + delta);
      // 버튼에 포커스가 남아 있으면 스로틀 중립 키인 Space가 버튼을 누르게 된다.
      button.blur();
    });
    return button;
  }

  private getTile(key: string, url: string): HTMLImageElement {
    let image = this.tiles.get(key);
    if (!image) {
      image = new Image();
      image.addEventListener('load', () => (this.lastDrawTime = -Infinity));
      image.src = url;
      this.tiles.set(key, image);
      // Map은 삽입한 순서를 유지하므로 첫 번째 항목이 가장 오래된 타일이다.
      if (this.tiles.size > MAX_CACHED_TILES) this.tiles.delete(this.tiles.keys().next().value!);
    }
    return image;
  }

  private drawShip(heading: number): void {
    const { context } = this;
    context.save();
    context.translate(VIEW_SIZE / 2, VIEW_SIZE / 2);
    context.rotate(heading);
    context.beginPath();
    context.moveTo(0, -11);
    context.lineTo(7, 8);
    context.lineTo(0, 4);
    context.lineTo(-7, 8);
    context.closePath();
    context.fillStyle = '#e5352b';
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.lineJoin = 'round';
    context.stroke();
    context.fill();
    context.restore();
  }

  private drawScaleBar(metersPerPixel: number): void {
    const { context } = this;
    // 길이가 80픽셀을 넘지 않는 범위에서 1, 2, 5로 시작하는 가장 큰 거리를 고른다.
    const maxMeters = metersPerPixel * 80;
    const magnitude = 10 ** Math.floor(Math.log10(maxMeters));
    const meters = [5, 2, 1].map((step) => step * magnitude).find((value) => value <= maxMeters)!;
    const width = meters / metersPerPixel;
    const x = 10;
    const y = VIEW_SIZE - 12;

    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
    context.fillRect(x - 4, y - 16, width + 8, 22);
    context.strokeStyle = '#1b2733';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, y - 5);
    context.lineTo(x, y);
    context.lineTo(x + width, y);
    context.lineTo(x + width, y - 5);
    context.stroke();
    context.fillStyle = '#1b2733';
    context.font = '11px ui-monospace, Menlo, monospace';
    context.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, x + 4, y - 5);
  }
}
