import { METERS_PER_NAUTICAL_MILE } from '../geo/units';
import type { ShipState } from '../ship/shipPhysics';
import { WheelStepper } from './wheelStepper';

/** 레이더가 주변을 탐지하는 데 사용하는 정보 */
export interface RadarProbe {
  /** 월드의 (x, z) 지점이 전파를 반사하는 넓은 물체(육지, 방파제와 부두, 지나갈 수 없는 낮은 다리)이면 true */
  isSolid(x: number, z: number): boolean;
  /**
   * 점으로 표시할 물체의 위치. 광선의 간격보다 작아서 넓은 물체처럼 탐지하면 놓치는 것들이다.
   * structure가 true이면 교각과 같은 구조물이고, 아니면 등대, 등표, 부표와 같은 항로 표지이다.
   */
  marks(): Iterable<{ x: number; z: number; structure?: boolean }>;
}

const VIEW_SIZE = 196;
const CENTER = VIEW_SIZE / 2;
const RADIUS = CENTER - 3;
// 탐지 거리의 단계 (해리). 레이더 위에서 휠을 돌리면 단계가 바뀐다.
const RANGES = [0.25, 0.5, 1, 2, 4];
const DEFAULT_RANGE_INDEX = 2;
// 안테나가 한 바퀴 도는 데 걸리는 시간 (초). 실제 선박용 레이더는 2~3초이다.
const ROTATION_PERIOD = 2.5;
// 한 바퀴를 나누는 광선의 수와, 광선 하나를 따라 물체를 확인하는 지점의 수
const RAYS_PER_ROTATION = 720;
const SAMPLES_PER_RAY = 220;
// 육지에 닿은 뒤로 화면에서 이 두께(픽셀)까지만 표시한다.
const LAND_ECHO_PIXELS = 5;
// 지나간 자리의 영상이 흐려지는 빠르기 (초). 한 바퀴가 돌아오기 전에 완전히 사라지지 않을 정도로 잡는다.
const AFTERGLOW_SECONDS = 1.7;
const ECHO_COLOUR = '#8dffa6';
const MARK_COLOUR = '#f6ffb0';
const GRID_COLOUR = 'rgba(141, 255, 166, 0.3)';
const LABEL_COLOUR = 'rgba(141, 255, 166, 0.75)';
// 이어지는 스크롤에서 탐지 거리를 바꾼 뒤에 다음 단계를 허용하기까지의 간격
const RANGE_COOLDOWN_MS = 350;

/**
 * 선수가 위쪽을 향하는 레이더 화면.
 *
 * 실제 레이더와 같은 방식으로 동작한다: 회전하는 안테나의 방향으로 광선을 쏘아서 처음 닿는 물체까지의 거리를 구하고,
 * 그 방위와 거리에 점을 찍는다. 그래서 섬이나 방파제의 뒤쪽은 전파가 닿지 않아서 표시되지 않고,
 * 주사선이 지나간 자리만 갱신되며 이전의 영상은 서서히 흐려진다.
 */
export class Radar {
  readonly element = document.createElement('div');
  private readonly truth: CanvasRenderingContext2D | null;
  private readonly echoes: CanvasRenderingContext2D;
  private readonly overlay: CanvasRenderingContext2D;
  private rangeIndex = DEFAULT_RANGE_INDEX;
  /** 안테나가 향하는 방향. 선수를 0으로 하는 시계 방향의 각도 (rad) */
  private sweep = 0;
  /** 탐지한 물체의 위치(월드 좌표)와 탐지한 시각 */
  private detections: { x: number; z: number; time: number; mark: boolean; point: boolean }[] = [];
  private clock = 0;
  private readonly wheel = new WheelStepper({ cooldownMs: RANGE_COOLDOWN_MS });

  constructor(
    private readonly probe: RadarProbe,
    private readonly onRangeChange: (nauticalMiles: number) => void,
  ) {
    this.element.className = 'hud-radar';
    this.element.title = '휠을 돌리면 탐지 거리가 바뀝니다';
    // 개발 서버에서 주소에 ?radarTruth를 붙이면, 실제로 장애물이 있는 곳을 붉은색으로 깔아서 영상과 비교할 수 있다.
    this.truth = import.meta.env.DEV && new URLSearchParams(location.search).has('radarTruth') ? this.createLayer() : null;
    this.echoes = this.createLayer();
    this.overlay = this.createLayer();

    // 휠을 위로 돌리면 가까운 곳을 크게 보고(탐지 거리 축소), 아래로 돌리면 먼 곳까지 본다(탐지 거리 확대).
    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const next = clamp(this.rangeIndex + this.wheel.feed(event.deltaY), 0, RANGES.length - 1);
        if (next === this.rangeIndex) return;
        this.rangeIndex = next;
        // 탐지 거리가 바뀌면 탐지하는 간격도 달라지므로, 이전의 기록을 지우고 새로 모은다.
        this.detections.length = 0;
        this.onRangeChange(RANGES[this.rangeIndex]);
      },
      { passive: false },
    );
    this.onRangeChange(RANGES[this.rangeIndex]);
  }

  update(frameTime: number, ship: ShipState, shipLength: number): void {
    const range = RANGES[this.rangeIndex] * METERS_PER_NAUTICAL_MILE;
    const scale = RADIUS / range;
    this.clock += frameTime;

    // 이번 프레임 동안 안테나가 돌아간 각도만큼만 새로 탐지한다.
    const previous = this.sweep;
    const advance = Math.min((frameTime / ROTATION_PERIOD) * Math.PI * 2, Math.PI / 2);
    const rayStep = (Math.PI * 2) / RAYS_PER_ROTATION;
    const step = range / SAMPLES_PER_RAY;
    // 자선의 선체가 영상에 잡히지 않도록, 선체의 길이만큼 떨어진 곳부터 확인한다.
    const firstSample = Math.max(1, Math.ceil(shipLength / step));
    // 육지에 닿은 뒤로 화면에서 일정한 두께가 될 때까지만 기록한다. 그 뒤는 전파가 닿지 않는 그늘이다.
    const echoDepth = Math.max(2, Math.round(LAND_ECHO_PIXELS / (step * scale)));

    for (let angle = previous; angle < previous + advance; angle += rayStep) {
      const sin = Math.sin(ship.heading + angle);
      const cos = Math.cos(ship.heading + angle);
      let depth = 0;
      for (let i = firstSample; i <= SAMPLES_PER_RAY; i++) {
        const x = ship.x + sin * i * step;
        const z = ship.z - cos * i * step;
        if (this.probe.isSolid(x, z)) {
          this.detections.push({ x, z, time: this.clock, mark: false, point: false });
          if (++depth >= echoDepth) break;
        } else if (depth > 0) {
          break;
        }
      }
    }

    // 등대와 부표는 작아서 광선의 간격 사이로 빠질 수 있으므로, 방위가 이번에 지나간 범위에 드는지를 따로 확인한다.
    for (const mark of this.probe.marks()) {
      const dx = mark.x - ship.x;
      const dz = mark.z - ship.z;
      const distance = Math.hypot(dx, dz);
      if (distance > range || distance < shipLength) continue;
      const bearing = normalize(Math.atan2(dx, -dz) - ship.heading);
      if (normalize(bearing - previous) >= advance) continue;
      if (this.isShadowed(ship, bearing, distance, step)) continue;
      this.detections.push({ x: mark.x, z: mark.z, time: this.clock, mark: !mark.structure, point: true });
    }

    this.drawDetections(ship, scale);
    this.sweep = normalize(previous + advance);
    this.drawOverlay();
    if (this.truth) this.drawTruth(this.truth, ship, scale);
  }

  /** 비교용: 화면의 모든 칸에 대해서 그곳에 장애물이 있는지를 직접 물어서 칠한다. 가려짐과 주사선을 거치지 않은 정답이다. */
  private drawTruth(context: CanvasRenderingContext2D, ship: ShipState, scale: number): void {
    const cell = 3;
    const sin = Math.sin(ship.heading);
    const cos = Math.cos(ship.heading);
    context.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    context.fillStyle = 'rgba(255, 70, 70, 0.55)';
    for (let py = 0; py < VIEW_SIZE; py += cell) {
      for (let px = 0; px < VIEW_SIZE; px += cell) {
        // 화면의 좌표를 선체 기준의 거리(우현, 선수 방향)로 바꾼 다음에 월드 좌표로 돌린다.
        const starboard = (px + cell / 2 - CENTER) / scale;
        const forward = (CENTER - (py + cell / 2)) / scale;
        if (Math.hypot(starboard, forward) > RADIUS / scale) continue;
        const x = ship.x + forward * sin + starboard * cos;
        const z = ship.z - forward * cos + starboard * sin;
        if (this.probe.isSolid(x, z)) context.fillRect(px, py, cell, cell);
      }
    }
  }

  /**
   * 기록해 둔 탐지 결과를 현재의 자선 위치와 선수 방위를 기준으로 다시 그린다.
   *
   * 탐지한 물체는 화면의 좌표가 아니라 월드 좌표로 기억한다. 화면에 찍은 점을 그대로 두면,
   * 주사선이 한 바퀴를 도는 2.5초 동안 배가 이동하거나 선회한 만큼 이전의 영상이 실제 위치에서 어긋난다.
   * 전속으로 선회할 때에는 이 어긋남이 수십 도에 달했다.
   */
  private drawDetections(ship: ShipState, scale: number): void {
    const { echoes } = this;
    const sin = Math.sin(ship.heading);
    const cos = Math.cos(ship.heading);
    echoes.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    let kept = 0;
    for (const detection of this.detections) {
      const age = this.clock - detection.time;
      // 주사선이 한 바퀴를 돌아서 같은 자리를 다시 탐지했을 시점이 지나면 버린다.
      if (age > ROTATION_PERIOD * 1.1) continue;
      this.detections[kept++] = detection;

      // 월드 좌표를 선체 기준의 거리(선수 방향, 우현 방향)로 바꾼다.
      const dx = detection.x - ship.x;
      const dz = detection.z - ship.z;
      const forward = dx * sin - dz * cos;
      const starboard = dx * cos + dz * sin;
      if (Math.hypot(forward, starboard) * scale > RADIUS) continue;

      // 점으로 탐지한 물체(항로 표지, 교각)는 해안선의 띠보다 크게 그려서 구분한다.
      const size = detection.point ? 4 : 2.2;
      // 오래된 탐지일수록 흐리게 그려서, 주사선이 지나간 지 얼마나 되었는지를 나타낸다.
      echoes.globalAlpha = Math.max(0.25, Math.exp(-age / AFTERGLOW_SECONDS));
      echoes.fillStyle = detection.mark ? MARK_COLOUR : ECHO_COLOUR;
      echoes.fillRect(CENTER + starboard * scale - size / 2, CENTER - forward * scale - size / 2, size, size);
    }
    this.detections.length = kept;
    echoes.globalAlpha = 1;
  }

  /** 자선과 물체의 사이에 육지나 구조물이 있어서 전파가 닿지 않으면 true */
  private isShadowed(ship: ShipState, bearing: number, distance: number, step: number): boolean {
    const sin = Math.sin(ship.heading + bearing);
    const cos = Math.cos(ship.heading + bearing);
    // 물체가 놓인 곳(방파제 위의 등대 등)은 제외하도록 조금 앞까지만 확인한다.
    for (let d = step; d < distance - step * 2; d += step) {
      if (this.probe.isSolid(ship.x + sin * d, ship.z - cos * d)) return true;
    }
    return false;
  }

  /** 거리 고정환, 선수선, 주사선을 그린다. 영상과 겹쳐서 표시되는 별도의 층이다. */
  private drawOverlay(): void {
    const { overlay } = this;
    overlay.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    overlay.strokeStyle = GRID_COLOUR;
    overlay.lineWidth = 1;
    // 거리 고정환: 탐지 거리의 절반과 전체에 원을 그리고, 그 거리를 해리로 적는다.
    overlay.fillStyle = LABEL_COLOUR;
    overlay.font = '10px ui-monospace, Menlo, monospace';
    overlay.textAlign = 'left';
    overlay.textBaseline = 'middle';
    const range = RANGES[this.rangeIndex];
    for (const ratio of [0.5, 1]) {
      overlay.beginPath();
      overlay.arc(CENTER, CENTER, RADIUS * ratio, 0, Math.PI * 2);
      overlay.stroke();
      // 숫자는 선수선과 겹치지 않도록 원의 오른쪽 위에 적는다.
      const labelRadius = RADIUS * ratio - 10;
      overlay.fillText(String(range * ratio), CENTER + labelRadius * 0.62, CENTER - labelRadius * 0.78);
    }
    // 선수선: 화면의 위쪽이 항상 선수이다.
    overlay.beginPath();
    overlay.moveTo(CENTER, CENTER);
    overlay.lineTo(CENTER, CENTER - RADIUS);
    overlay.stroke();

    overlay.strokeStyle = 'rgba(141, 255, 166, 0.9)';
    overlay.lineWidth = 1.5;
    overlay.beginPath();
    overlay.moveTo(CENTER, CENTER);
    overlay.lineTo(CENTER + Math.sin(this.sweep) * RADIUS, CENTER - Math.cos(this.sweep) * RADIUS);
    overlay.stroke();

    overlay.fillStyle = ECHO_COLOUR;
    overlay.beginPath();
    overlay.arc(CENTER, CENTER, 3, 0, Math.PI * 2);
    overlay.fill();
  }

  private createLayer(): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    canvas.width = VIEW_SIZE * pixelRatio;
    canvas.height = VIEW_SIZE * pixelRatio;
    this.element.append(canvas);
    const context = canvas.getContext('2d')!;
    context.scale(pixelRatio, pixelRatio);
    return context;
  }
}

/** 각도를 [0, 2π) 범위로 정규화한다. */
function normalize(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
