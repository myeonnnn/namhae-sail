import * as THREE from 'three';
import type { Wind } from '../environment/wind';
import type { ShipState } from '../ship/shipPhysics';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_SIZE = 108;
const CENTER = VIEW_SIZE / 2;
const SPHERE_RADIUS = 50;
const AXIS_LENGTH = 39;
const BUBBLE_RADIUS = 8.5;
const EQUATOR_SEGMENTS = 48;
const MOTION_COLOR = '#ffd24a';
const WIND_COLOR = '#7fd0ff';
const UP_COLOR = '#6ddc6d';
// 이 속력보다 느리면 이동 방향이 불안정하므로 선수 방향을 대신 표시한다.
const MIN_COURSE_SPEED = 0.2;

const CARDINALS = [
  { direction: new THREE.Vector3(0, 0, -1), label: 'N', color: '#ff6b6b' },
  { direction: new THREE.Vector3(1, 0, 0), label: 'E', color: '#e8f1f8' },
  { direction: new THREE.Vector3(0, 0, 1), label: 'S', color: '#e8f1f8' },
  { direction: new THREE.Vector3(-1, 0, 0), label: 'W', color: '#e8f1f8' },
] as const;

interface CardinalElements {
  group: SVGGElement;
  line: SVGLineElement;
  bubble: SVGCircleElement;
  text: SVGTextElement;
  depth: number;
}

/**
 * 3D 편집 도구의 시점 표시기와 같은 구 형태의 나침반.
 * 월드의 방위를 현재 카메라의 회전 그대로 투영하므로, 카메라를 돌리면 구가 함께 돌아간다.
 * 노란색 화살표는 배가 실제로 이동하는 방향이고, 하늘색 화살표는 바람이 불어 가는 방향이다.
 */
export class Compass {
  readonly element = createSvg('svg');
  private readonly equator = createSvg('polygon');
  private readonly upLine = createSvg('line');
  private readonly upBubble = createSvg('circle');
  private readonly motionShaft = createSvg('line');
  private readonly motionHead = createSvg('polygon');
  private readonly motion = createSvg('g');
  private readonly windShaft = createSvg('line');
  private readonly windHead = createSvg('polygon');
  private readonly windArrow = createSvg('g');
  private readonly cardinals: CardinalElements[];
  private readonly inverseRotation = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();

  constructor() {
    const { element } = this;
    element.setAttribute('viewBox', `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`);
    element.setAttribute('width', String(VIEW_SIZE));
    element.setAttribute('height', String(VIEW_SIZE));
    element.classList.add('hud-compass');

    const sphere = createSvg('circle');
    sphere.setAttribute('cx', String(CENTER));
    sphere.setAttribute('cy', String(CENTER));
    sphere.setAttribute('r', String(SPHERE_RADIUS));
    sphere.setAttribute('fill', 'rgba(232, 241, 248, 0.1)');
    sphere.setAttribute('stroke', 'rgba(232, 241, 248, 0.25)');

    // 수평면과 구가 만나는 원. 구가 얼마나 기울어져 있는지 알려 준다.
    this.equator.setAttribute('fill', 'rgba(232, 241, 248, 0.07)');
    this.equator.setAttribute('stroke', 'rgba(232, 241, 248, 0.35)');
    this.equator.setAttribute('stroke-width', '1');

    // 위쪽(+Y)을 가리키는 축. 방위는 아니지만, 이 축이 있어야 구의 기울기가 입체로 읽힌다.
    this.upLine.setAttribute('x1', String(CENTER));
    this.upLine.setAttribute('y1', String(CENTER));
    this.upLine.setAttribute('stroke', UP_COLOR);
    this.upLine.setAttribute('stroke-width', '2');
    this.upBubble.setAttribute('r', '5');
    this.upBubble.setAttribute('fill', UP_COLOR);

    for (const [shaft, head, group, color] of [
      [this.windShaft, this.windHead, this.windArrow, WIND_COLOR],
      [this.motionShaft, this.motionHead, this.motion, MOTION_COLOR],
    ] as const) {
      shaft.setAttribute('stroke', color);
      shaft.setAttribute('stroke-width', '3');
      shaft.setAttribute('stroke-linecap', 'round');
      head.setAttribute('fill', color);
      group.append(shaft, head);
    }

    this.cardinals = CARDINALS.map(({ label, color }) => {
      const group = createSvg('g');
      const line = createSvg('line');
      line.setAttribute('x1', String(CENTER));
      line.setAttribute('y1', String(CENTER));
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');

      const bubble = createSvg('circle');
      bubble.setAttribute('r', String(BUBBLE_RADIUS));
      bubble.setAttribute('fill', color);

      const text = createSvg('text');
      text.textContent = label;
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', '10.5');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', '#0b1a2a');

      group.append(line, bubble, text);
      return { group, line, bubble, text, depth: 0 };
    });

    element.append(
      sphere,
      this.equator,
      this.upLine,
      this.upBubble,
      this.windArrow,
      this.motion,
      ...this.cardinals.map((c) => c.group),
    );
  }

  update(camera: THREE.Camera, ship: ShipState, wind: Wind): void {
    // 카메라 회전의 역을 적용하면 월드 방향이 카메라 기준(오른쪽 +x, 위 +y, 화면 앞쪽 +z)으로 변환된다.
    this.inverseRotation.copy(camera.quaternion).invert();

    const ring: string[] = [];
    for (let i = 0; i < EQUATOR_SEGMENTS; i++) {
      const angle = (i / EQUATOR_SEGMENTS) * Math.PI * 2;
      ring.push(this.project(Math.sin(angle) * AXIS_LENGTH, -Math.cos(angle) * AXIS_LENGTH));
    }
    this.equator.setAttribute('points', ring.join(' '));

    const [upX, upY] = this.project(0, 0, AXIS_LENGTH).split(',');
    this.upLine.setAttribute('x2', upX);
    this.upLine.setAttribute('y2', upY);
    this.upBubble.setAttribute('cx', upX);
    this.upBubble.setAttribute('cy', upY);

    this.cardinals.forEach((cardinal, index) => {
      const { direction } = CARDINALS[index];
      const [x, y] = this.project(direction.x * AXIS_LENGTH, direction.z * AXIS_LENGTH).split(',');
      cardinal.line.setAttribute('x2', x);
      cardinal.line.setAttribute('y2', y);
      cardinal.bubble.setAttribute('cx', x);
      cardinal.bubble.setAttribute('cy', y);
      cardinal.text.setAttribute('x', x);
      cardinal.text.setAttribute('y', y);
      // project가 scratch에 남긴 깊이를 읽는다. 값이 클수록 시청자에게 가깝다.
      cardinal.depth = this.scratch.z;
      // 구의 뒤쪽에 있는 방위는 흐리게 표시한다.
      cardinal.group.setAttribute('opacity', cardinal.depth < 0 ? '0.45' : '1');
    });
    // 시청자 쪽에 가까운 방위가 나중에 그려지도록 깊이 순서로 다시 배치한다.
    [...this.cardinals].sort((a, b) => a.depth - b.depth).forEach((c) => this.element.append(c.group));

    this.updateMotion(ship);
    this.updateWind(wind);
  }

  private updateMotion(ship: ShipState): void {
    const sin = Math.sin(ship.heading);
    const cos = Math.cos(ship.heading);
    // 선체 기준의 속도(surge, sway)를 월드 기준의 속도로 변환한다. 선회 중에는 선수 방향과 차이가 난다.
    let dirX = ship.surge * sin + ship.sway * cos;
    let dirZ = -ship.surge * cos + ship.sway * sin;
    const speed = Math.hypot(dirX, dirZ);
    const moving = speed >= MIN_COURSE_SPEED;
    if (moving) {
      dirX /= speed;
      dirZ /= speed;
    } else {
      dirX = sin;
      dirZ = -cos;
    }

    this.drawArrow(this.motionShaft, this.motionHead, dirX, dirZ, 0, AXIS_LENGTH * 0.68);
    this.motion.setAttribute('opacity', moving ? '1' : '0.4');
  }

  private updateWind(wind: Wind): void {
    const toward = ((wind.fromDeg + 180) * Math.PI) / 180;
    // 바람이 불어오는 쪽의 가장자리에서 시작해서 중심 부근까지 그린다.
    this.drawArrow(this.windShaft, this.windHead, Math.sin(toward), -Math.cos(toward), -AXIS_LENGTH * 0.95, -AXIS_LENGTH * 0.3);
    this.windArrow.setAttribute('visibility', wind.speed < 0.1 ? 'hidden' : 'visible');
  }

  /** 수평면 위에서 (dirX, dirZ) 방향으로 from부터 to까지 이어지는 화살표를 그린다. */
  private drawArrow(
    shaft: SVGLineElement,
    head: SVGPolygonElement,
    dirX: number,
    dirZ: number,
    from: number,
    to: number,
  ): void {
    const base = to - 10;
    const [x1, y1] = this.project(dirX * from, dirZ * from).split(',');
    const [x2, y2] = this.project(dirX * base, dirZ * base).split(',');
    shaft.setAttribute('x1', x1);
    shaft.setAttribute('y1', y1);
    shaft.setAttribute('x2', x2);
    shaft.setAttribute('y2', y2);

    // 화살촉의 세 꼭짓점을 수평면 위에서 계산한 다음에 투영하므로, 구와 같은 기울기로 보인다.
    const sideX = -dirZ * 5.5;
    const sideZ = dirX * 5.5;
    head.setAttribute(
      'points',
      [
        this.project(dirX * to, dirZ * to),
        this.project(dirX * base + sideX, dirZ * base + sideZ),
        this.project(dirX * base - sideX, dirZ * base - sideZ),
      ].join(' '),
    );
  }

  /** 월드의 한 점을 SVG 좌표 문자열 "x,y"로 변환한다. 높이를 생략하면 수평면 위의 점이다. 깊이는 scratch.z에 남는다. */
  private project(worldX: number, worldZ: number, worldY = 0): string {
    this.scratch.set(worldX, worldY, worldZ).applyQuaternion(this.inverseRotation);
    // SVG는 아래쪽이 +y이므로 부호를 뒤집는다.
    return `${(CENTER + this.scratch.x).toFixed(1)},${(CENTER - this.scratch.y).toFixed(1)}`;
  }
}

function createSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}
