import type * as THREE from 'three';
import { formatBearing, formatDistance } from '../geo/units';
import type { ShipState } from '../ship/shipPhysics';
import type { Seamark, SeamarkKind, Seamarks } from '../world/seamarks';

// 마우스에서 이 거리(픽셀) 안에 있는 표지만 선택한다.
const PICK_RADIUS = 22;

const KIND_NAMES: Record<SeamarkKind, string> = { light: '등대', beacon: '등표', buoy: '부표' };
const COLOUR_NAMES: Record<string, string> = {
  red: '붉은색',
  green: '녹색',
  yellow: '노란색',
  white: '흰색',
  black: '검은색',
  orange: '주황색',
};

/**
 * 등대, 등표, 부표에 마우스를 올리면 이름과 등화, 배에서의 방위와 거리를 표시한다.
 * 시점을 돌리는 드래그와 겹치지 않도록, 마우스 버튼을 누르지 않은 상태에서만 동작한다.
 */
export class SeamarkInspector {
  private readonly ring = document.createElement('div');
  private readonly tooltip = document.createElement('div');
  private pointerX = 0;
  private pointerY = 0;
  private pointerActive = false;
  private shown: Seamark | null = null;

  constructor(
    root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly seamarks: Seamarks,
  ) {
    this.ring.className = 'hud-seamark-ring';
    this.tooltip.className = 'hud-panel hud-seamark-tooltip';
    this.ring.hidden = true;
    this.tooltip.hidden = true;
    root.append(this.ring, this.tooltip);

    canvas.addEventListener('pointermove', (event) => {
      this.pointerX = event.offsetX;
      this.pointerY = event.offsetY;
      this.pointerActive = event.buttons === 0;
    });
    canvas.addEventListener('pointerdown', () => (this.pointerActive = false));
    canvas.addEventListener('pointerleave', () => (this.pointerActive = false));
  }

  update(camera: THREE.Camera, ship: ShipState): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    const hit = this.pointerActive
      ? this.seamarks.pick(camera, this.pointerX, this.pointerY, width, height, PICK_RADIUS)
      : null;

    this.ring.hidden = !hit;
    this.tooltip.hidden = !hit;
    this.canvas.style.cursor = hit ? 'help' : '';
    if (!hit) {
      this.shown = null;
      return;
    }

    // 표지를 둘러싸는 원. 화면에서 작게 보이는 표지도 눈에 띄도록 최소 크기를 둔다.
    const diameter = Math.max(30, Math.hypot(hit.topX - hit.baseX, hit.topY - hit.baseY) + 14);
    this.ring.style.width = this.ring.style.height = `${diameter}px`;
    this.ring.style.left = `${(hit.baseX + hit.topX) / 2}px`;
    this.ring.style.top = `${(hit.baseY + hit.topY) / 2}px`;

    // 설명은 표지의 위쪽에 두되, 화면의 위쪽 끝에 가까우면 아래쪽에 둔다.
    const above = hit.topY > 150;
    this.tooltip.style.left = `${clamp(hit.topX, 110, width - 110)}px`;
    this.tooltip.style.top = `${above ? (hit.baseY + hit.topY) / 2 - diameter / 2 - 8 : (hit.baseY + hit.topY) / 2 + diameter / 2 + 8}px`;
    this.tooltip.dataset['placement'] = above ? 'above' : 'below';

    // 내용의 대부분은 표지가 바뀔 때에만 다시 만들고, 방위와 거리는 배가 움직이므로 매 프레임 갱신한다.
    if (this.shown !== hit.mark) {
      this.shown = hit.mark;
      this.tooltip.replaceChildren(...describe(hit.mark));
    }
    const east = hit.mark.x - ship.x;
    const north = -(hit.mark.z - ship.z);
    this.tooltip.lastElementChild!.textContent = `방위 ${formatBearing(Math.atan2(east, north))} · ${formatDistance(Math.hypot(east, north))}`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** 표지의 이름과 속성을 줄 단위의 요소로 만든다. 마지막 줄은 방위와 거리를 넣을 자리이다. */
function describe(mark: Seamark): HTMLElement[] {
  const line = (className: string, text: string) => {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    return element;
  };

  const kindName = KIND_NAMES[mark.kind];
  const structureColour = mark.colour ? COLOUR_NAMES[mark.colour] : undefined;
  const lines = [
    // 이름이 등록되지 않은 표지는 색상과 종류로 부른다.
    line('hud-seamark-name', mark.name ?? [structureColour, kindName].filter(Boolean).join(' ')),
    line('hud-label', mark.name && structureColour ? `${structureColour} ${kindName}` : kindName),
  ];
  if (mark.light) {
    const period = mark.period ? `, ${mark.period}초 주기` : '';
    lines.push(line('', `등화: ${COLOUR_NAMES[mark.light] ?? mark.light}${period}`));
  }
  if (mark.height) lines.push(line('', `등화 높이: 해수면에서 ${mark.height} m`));
  lines.push(line('hud-value hud-seamark-range', ''));
  return lines;
}
