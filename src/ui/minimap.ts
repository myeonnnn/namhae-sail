import { latLonToTile, metersPerTilePixel, worldToLatLon } from '../geo/projection';
import type { ShipState } from '../ship/shipPhysics';

// 높이는 계기판의 높이에 맞춘 값이며, 계기판의 구성을 바꾸면 함께 조정한다.
// 폭은 아래에 표시하는 경위도의 글자 폭보다 넓게 잡아서, 지도의 옆에 빈 공간이 남지 않게 한다.
const VIEW_WIDTH = 196;
const VIEW_HEIGHT = 169;
const TILE_SIZE = 256;
const MIN_ZOOM = 7;
const MAX_ZOOM = 16;
const DEFAULT_ZOOM = 10;
const REDRAW_INTERVAL_MS = 100;
const MAX_CACHED_TILES = 300;
// 줌을 한 단계 바꾸는 데 필요한 스크롤의 양. 마우스 휠의 한 칸이 대략 100이다.
const WHEEL_STEP = 100;
// 이어지는 스크롤에서 줌을 바꾼 뒤에 다음 단계를 허용하기까지의 간격
const ZOOM_COOLDOWN_MS = 500;
// 스크롤 이벤트 사이의 멈춤이 이보다 길면 마우스 휠의 새로운 한 칸으로 본다.
const WHEEL_NOTCH_PAUSE_MS = 120;
// 스크롤이 이 시간 동안 멈추면 모아 둔 양을 버린다.
const WHEEL_IDLE_RESET_MS = 300;
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
  private readonly position = document.createElement('div');
  private zoom = DEFAULT_ZOOM;
  private lastDrawTime = -Infinity;
  private wheelAccumulated = 0;
  private lastWheelTime = -Infinity;
  private lastZoomTime = -Infinity;

  constructor(root: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-minimap';

    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = VIEW_WIDTH * pixelRatio;
    this.canvas.height = VIEW_HEIGHT * pixelRatio;
    this.canvas.style.width = `${VIEW_WIDTH}px`;
    this.canvas.style.height = `${VIEW_HEIGHT}px`;
    this.context = this.canvas.getContext('2d')!;
    this.context.scale(pixelRatio, pixelRatio);
    this.canvas.dataset['zoom'] = String(this.zoom);

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        // 트랙패드는 한 번의 손동작에 수십 개의 작은 이벤트를 보낸다.
        // 이벤트마다 줌을 바꾸면 한꺼번에 여러 단계가 넘어가므로, 스크롤한 양을 모아서 일정량이 될 때마다 한 단계만 바꾼다.
        const now = performance.now();
        const pause = now - this.lastWheelTime;
        if (pause > WHEEL_IDLE_RESET_MS) this.wheelAccumulated = 0;
        this.lastWheelTime = now;
        this.wheelAccumulated += event.deltaY;
        if (Math.abs(this.wheelAccumulated) < WHEEL_STEP) return;
        // 끊기지 않고 이어지는 스크롤(트랙패드의 관성 포함)에서는 일정한 간격으로만 다음 단계를 허용한다.
        // 마우스 휠처럼 칸마다 멈춤이 있는 입력은 칸마다 한 단계씩 바로 반응한다.
        if (pause < WHEEL_NOTCH_PAUSE_MS && now - this.lastZoomTime < ZOOM_COOLDOWN_MS) return;

        this.setZoom(this.zoom - Math.sign(this.wheelAccumulated));
        this.wheelAccumulated = 0;
        this.lastZoomTime = now;
      },
      { passive: false },
    );

    const attribution = document.createElement('div');
    attribution.className = 'hud-minimap-attribution';
    attribution.textContent = '© OpenStreetMap · OpenSeaMap';

    this.position.className = 'hud-minimap-position';

    // 출처 표기는 지도의 영역 위에 겹쳐서 놓는다.
    const view = document.createElement('div');
    view.className = 'hud-minimap-view';
    view.append(this.canvas, attribution);

    panel.append(view, this.position);
    root.append(panel);
  }

  update(ship: ShipState): void {
    const now = performance.now();
    if (now - this.lastDrawTime < REDRAW_INTERVAL_MS) return;
    this.lastDrawTime = now;

    const { context, zoom } = this;
    const position = worldToLatLon(ship.x, ship.z);
    this.position.textContent = `${formatAngle(position.lat, 'N', 'S')}  ${formatAngle(position.lon, 'E', 'W')}`;
    const center = latLonToTile(position, zoom);
    // 화면의 왼쪽 위 모서리가 전 세계를 하나의 이미지로 펼친 좌표에서 어디인지 계산한다.
    const left = center.x * TILE_SIZE - VIEW_WIDTH / 2;
    const top = center.y * TILE_SIZE - VIEW_HEIGHT / 2;
    const tileCount = 2 ** zoom;

    context.fillStyle = SEA_COLOR;
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    for (const layer of LAYERS) {
      for (let ty = Math.floor(top / TILE_SIZE); ty * TILE_SIZE < top + VIEW_HEIGHT; ty++) {
        for (let tx = Math.floor(left / TILE_SIZE); tx * TILE_SIZE < left + VIEW_WIDTH; tx++) {
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
    this.canvas.dataset['zoom'] = String(this.zoom);
    this.lastDrawTime = -Infinity;
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
    context.translate(VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
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
    const y = VIEW_HEIGHT - 12;

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

/** 해도에서 사용하는 도와 분의 형식으로 표시한다. 위도 1분은 1해리(1852m)에 해당한다. */
function formatAngle(value: number, positive: string, negative: string): string {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return `${degrees}°${minutes.toFixed(3).padStart(6, '0')}′${value >= 0 ? positive : negative}`;
}
