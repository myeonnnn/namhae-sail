import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { latLonToWorld } from '../geo/projection';
import { REGION_CENTER } from '../geo/region';
import { loadChart, type ChartStructure } from './chartData';
import { SpatialGrid } from './spatialGrid';

interface StructureStyle {
  /** 수면에서 윗면까지의 높이 (m). 자료에 높이가 없어서 종류별로 정한 값이다. */
  top: number;
  /** 중심선만 기록된 구조물에 주는 폭의 절반 (m) */
  halfWidth: number;
  colour: number;
}

const STYLES: Record<string, StructureStyle> = {
  breakwater: { top: 4, halfWidth: 6, colour: 0x8f8f88 },
  groyne: { top: 2.5, halfWidth: 4, colour: 0x8f8f88 },
  pier: { top: 2.2, halfWidth: 2.5, colour: 0xa8a294 },
};
const DEFAULT_STYLE = STYLES['pier'];
// 구조물의 아랫면. 파도의 골에서도 바닥이 드러나지 않도록 수면 아래로 내린다.
const BOTTOM = -4;
const CELL_SIZE = 500;

interface Footprint {
  /** 윤곽의 꼭짓점 (월드의 x, z가 번갈아 들어 있다) */
  ring: Float32Array;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

/**
 * 방파제와 부두를 3D로 세우고, 선체와의 충돌을 판정한다.
 *
 * 이 구조물들은 폭이 5~20m여서 약 62m 간격인 지형의 메시에는 나타나지 않는다.
 * 그래서 해도에 사용하는 윤곽 자료를 그대로 가져와서, 윤곽을 위로 밀어 올린 입체로 만든다.
 */
export class Structures {
  private readonly grid = new SpatialGrid<Footprint>(CELL_SIZE);

  constructor(scene: THREE.Scene) {
    void loadChart()
      .then(({ structures }) => this.build(scene, structures))
      .catch((error) => console.warn('방파제와 부두의 자료를 불러오지 못했습니다.', error));
  }

  /** 월드의 (x, z) 지점이 구조물의 안쪽이면 그 윗면의 높이를, 아니면 undefined를 반환한다. */
  topAt(x: number, z: number): number | undefined {
    for (const footprint of this.grid.at(x, z)) {
      if (x < footprint.minX || x > footprint.maxX || z < footprint.minZ || z > footprint.maxZ) continue;
      if (isInside(footprint.ring, x, z)) return footprint.top;
    }
    return undefined;
  }

  contains(x: number, z: number): boolean {
    return this.topAt(x, z) !== undefined;
  }

  /**
   * 한 지점의 주변에서 구조물의 윗면을 찾는다.
   * 방파제 끝의 등대는 좌표가 방파제의 윤곽에서 몇 미터 벗어나 있는 경우가 많아서, 가까운 구조물 위에 올려놓는 데 사용한다.
   */
  topNear(x: number, z: number, radius: number): number | undefined {
    for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
      const top = this.topAt(x + dx, z + dz);
      if (top !== undefined) return top;
    }
    return undefined;
  }

  private build(scene: THREE.Scene, structures: ChartStructure[]): void {
    // 구역의 가운데를 기준으로 한 상대 좌표로 정점을 만들고, 메시를 그 기준점에 놓는다. (이유는 REGION_CENTER의 설명 참고)
    const anchor = REGION_CENTER;
    const byColour = new Map<number, THREE.BufferGeometry[]>();

    for (const structure of structures) {
      const style = STYLES[structure.kind] ?? DEFAULT_STYLE;
      const line = structure.points.map(([lon, lat]) => latLonToWorld({ lat, lon }));
      // 닫힌 윤곽은 마지막 점이 첫 점과 같으므로 하나를 뺀다.
      const outline = structure.closed ? line.slice(0, -1) : widen(line, style.halfWidth);
      if (outline.length < 3) continue;

      const shape = new THREE.Shape(outline.map(({ x, z }) => new THREE.Vector2(x - anchor.x, -(z - anchor.z))));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: style.top - BOTTOM, bevelEnabled: false });
      // Shape는 XY 평면에 놓이고 +Z로 밀려 올라간다. X축으로 돌려서 수평면에 눕히고, 밀어 올린 방향이 위쪽이 되게 한다.
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, BOTTOM, 0);
      let list = byColour.get(style.colour);
      if (!list) byColour.set(style.colour, (list = []));
      list.push(geometry);

      this.register(outline, style.top);
    }

    // 수백 개의 구조물을 색상별로 하나의 메시로 합쳐서, 그리기 요청의 수를 줄인다.
    for (const [colour, geometries] of byColour) {
      const merged = mergeGeometries(geometries);
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95 }));
      mesh.position.set(anchor.x, 0, anchor.z);
      scene.add(mesh);
    }
  }

  /** 충돌을 판정할 때 주변의 구조물만 조사하도록, 윤곽이 걸쳐 있는 모든 격자 칸에 등록한다. */
  private register(outline: { x: number; z: number }[], top: number): void {
    const ring = new Float32Array(outline.length * 2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    outline.forEach(({ x, z }, i) => {
      ring[i * 2] = x;
      ring[i * 2 + 1] = z;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });
    this.grid.insertBox(minX, minZ, maxX, maxZ, { ring, minX, maxX, minZ, maxZ, top });
  }
}

/** 중심선의 양쪽으로 halfWidth만큼 벌려서 윤곽을 만든다. 왼쪽을 따라갔다가 오른쪽을 따라 돌아온다. */
function widen(line: { x: number; z: number }[], halfWidth: number): { x: number; z: number }[] {
  if (line.length < 2) return [];
  const left: { x: number; z: number }[] = [];
  const right: { x: number; z: number }[] = [];
  line.forEach((point, i) => {
    // 꺾이는 지점에서는 앞뒤 선분의 방향을 평균해서, 폭이 한쪽으로 쏠리지 않게 한다.
    const previous = line[Math.max(i - 1, 0)];
    const next = line[Math.min(i + 1, line.length - 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const sideX = (-dz / length) * halfWidth;
    const sideZ = (dx / length) * halfWidth;
    left.push({ x: point.x + sideX, z: point.z + sideZ });
    right.push({ x: point.x - sideX, z: point.z - sideZ });
  });
  return [...left, ...right.reverse()];
}

/** 점에서 한쪽으로 그은 반직선이 윤곽의 변을 홀수 번 지나면 안쪽이다. */
function isInside(ring: Float32Array, x: number, z: number): boolean {
  let inside = false;
  const count = ring.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
