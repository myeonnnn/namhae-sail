import * as THREE from 'three';
import type { ShipState } from '../ship/shipPhysics';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_SIZE = 130;
const CENTER = VIEW_SIZE / 2;
const RING_RADIUS = 44;
const RING_SEGMENTS = 48;
const ARROW_LENGTH = 34;
const ARROW_HEAD_LENGTH = 12;
const ARROW_HEAD_HALF_WIDTH = 6;
const ARROW_COLOR = '#ffd24a';
// 이 속력보다 느리면 이동 방향이 불안정하므로 선수 방향을 대신 표시한다.
const MIN_COURSE_SPEED = 0.2;
// 실제 카메라의 내려다보는 각도를 그대로 사용하면 나침반이 납작해져서 읽기 어려우므로 기울기를 고정한다.
const TILT_SIN = Math.sin(THREE.MathUtils.degToRad(55));

const CARDINALS = [
  { direction: new THREE.Vector3(0, 0, -1), label: 'N', color: '#ff6b6b' },
  { direction: new THREE.Vector3(1, 0, 0), label: 'E', color: '#e8f1f8' },
  { direction: new THREE.Vector3(0, 0, 1), label: 'S', color: '#e8f1f8' },
  { direction: new THREE.Vector3(-1, 0, 0), label: 'W', color: '#e8f1f8' },
] as const;

interface CardinalElements {
  group: SVGGElement;
  tip: SVGCircleElement;
  text: SVGTextElement;
  depth: number;
}

/**
 * 수평면에 놓인 나침반을 화면 구석에 표시한다. 카메라가 바라보는 방위에 맞춰서 회전한다.
 * 화살표는 배가 실제로 이동하고 있는 방향을 가리킨다.
 */
export class AxisGizmo {
  private readonly svg = createSvg('svg');
  private readonly ring = createSvg('polygon');
  private readonly arrowShaft = createSvg('line');
  private readonly arrowHead = createSvg('polygon');
  private readonly arrow = createSvg('g');
  private readonly cardinals: CardinalElements[];
  private readonly viewDirection = new THREE.Vector3();
  // 카메라가 바라보는 수평 방향(월드의 x, z 성분)
  private forwardX = 0;
  private forwardZ = -1;

  constructor(root: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-gizmo';

    this.svg.setAttribute('viewBox', `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`);
    this.svg.setAttribute('width', String(VIEW_SIZE));
    this.svg.setAttribute('height', String(VIEW_SIZE));

    this.ring.setAttribute('fill', 'rgba(232, 241, 248, 0.08)');
    this.ring.setAttribute('stroke', 'rgba(232, 241, 248, 0.45)');
    this.ring.setAttribute('stroke-width', '1.5');

    this.arrowShaft.setAttribute('x1', String(CENTER));
    this.arrowShaft.setAttribute('y1', String(CENTER));
    this.arrowShaft.setAttribute('stroke', ARROW_COLOR);
    this.arrowShaft.setAttribute('stroke-width', '3');
    this.arrowShaft.setAttribute('stroke-linecap', 'round');
    this.arrowHead.setAttribute('fill', ARROW_COLOR);
    this.arrow.append(this.arrowShaft, this.arrowHead);

    this.cardinals = CARDINALS.map(({ label, color }) => {
      const group = createSvg('g');
      const tip = createSvg('circle');
      tip.setAttribute('r', '9');
      tip.setAttribute('fill', color);

      const text = createSvg('text');
      text.textContent = label;
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', '#0b1a2a');

      group.append(tip, text);
      return { group, tip, text, depth: 0 };
    });

    this.svg.append(this.ring, this.arrow, ...this.cardinals.map((cardinal) => cardinal.group));

    const legend = document.createElement('div');
    legend.className = 'hud-gizmo-legend';
    legend.innerHTML = [
      '<span style="color:#ff6b6b">N</span> 북 (-Z)',
      '<span>E</span> 동 (+X)',
      '<span>S</span> 남 (+Z)',
      '<span>W</span> 서 (-X)',
      `<span style="color:${ARROW_COLOR}">➤</span> 이동 방향`,
    ].join('<br />');

    panel.append(this.svg, legend);
    root.append(panel);
  }

  update(camera: THREE.Camera, ship: ShipState): void {
    camera.getWorldDirection(this.viewDirection);
    const horizontalLength = Math.hypot(this.viewDirection.x, this.viewDirection.z);
    if (horizontalLength > 1e-4) {
      this.forwardX = this.viewDirection.x / horizontalLength;
      this.forwardZ = this.viewDirection.z / horizontalLength;
    }

    const ringPoints: string[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      ringPoints.push(this.project(Math.sin(angle) * RING_RADIUS, -Math.cos(angle) * RING_RADIUS));
    }
    this.ring.setAttribute('points', ringPoints.join(' '));

    this.cardinals.forEach((cardinal, index) => {
      const { direction } = CARDINALS[index];
      const [x, y] = this.project(direction.x * RING_RADIUS, direction.z * RING_RADIUS).split(',');

      cardinal.tip.setAttribute('cx', x);
      cardinal.tip.setAttribute('cy', y);
      cardinal.text.setAttribute('x', x);
      cardinal.text.setAttribute('y', y);
      // 카메라의 뒤쪽에 있을수록 값이 크고, 시청자에게 가깝다.
      cardinal.depth = -(direction.x * this.forwardX + direction.z * this.forwardZ);
      // 화면 안쪽에 있는 방위는 흐리게 표시해서 앞뒤를 구분한다.
      cardinal.group.setAttribute('opacity', String(0.55 + 0.45 * (cardinal.depth * 0.5 + 0.5)));
    });

    // 시청자 쪽에 가까운 방위가 나중에 그려지도록 깊이 순서로 다시 배치한다.
    [...this.cardinals].sort((a, b) => a.depth - b.depth).forEach((cardinal) => this.svg.append(cardinal.group));

    this.updateArrow(ship);
  }

  private updateArrow(ship: ShipState): void {
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

    const baseDistance = ARROW_LENGTH - ARROW_HEAD_LENGTH;
    const [shaftX, shaftY] = this.project(dirX * baseDistance, dirZ * baseDistance).split(',');
    this.arrowShaft.setAttribute('x2', shaftX);
    this.arrowShaft.setAttribute('y2', shaftY);

    // 화살촉의 세 꼭짓점을 수평면 위에서 계산한 다음에 변환하므로, 나침반과 같은 기울기로 보인다.
    const sideX = -dirZ * ARROW_HEAD_HALF_WIDTH;
    const sideZ = dirX * ARROW_HEAD_HALF_WIDTH;
    this.arrowHead.setAttribute(
      'points',
      [
        this.project(dirX * ARROW_LENGTH, dirZ * ARROW_LENGTH),
        this.project(dirX * baseDistance + sideX, dirZ * baseDistance + sideZ),
        this.project(dirX * baseDistance - sideX, dirZ * baseDistance - sideZ),
      ].join(' '),
    );
    this.arrow.setAttribute('opacity', moving ? '1' : '0.4');
  }

  /** 수평면 위의 한 점(월드의 x, z)을 SVG 좌표 문자열 "x,y"로 변환한다. */
  private project(worldX: number, worldZ: number): string {
    // 카메라의 오른쪽 방향은 바라보는 방향을 수평면에서 90° 돌린 (-forwardZ, forwardX)이다.
    const right = worldX * -this.forwardZ + worldZ * this.forwardX;
    const forward = worldX * this.forwardX + worldZ * this.forwardZ;
    // 멀리 있는 점일수록 화면의 위쪽에 놓이고, SVG는 아래쪽이 +y이므로 빼 준다.
    return `${(CENTER + right).toFixed(1)},${(CENTER - forward * TILT_SIN).toFixed(1)}`;
  }
}

function createSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}
