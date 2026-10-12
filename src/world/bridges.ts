import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { latLonToWorld } from '../geo/projection';
import { REGION_CENTER } from '../geo/region';
import { loadChart, type ChartBridge } from './chartData';
import { SpatialGrid } from './spatialGrid';

// 상판의 두께 (m)
const DECK_THICKNESS = 1.8;
// 다리의 양 끝에서 상판이 놓이는 높이 (m). 육지의 도로와 만나는 높이이다.
const ABUTMENT_HEIGHT = 6;
// 양 끝에서 이 거리(m)에 걸쳐서 상판이 가장 높은 지점까지 올라간다. 짧은 다리는 길이의 3분의 1을 사용한다.
const RAMP_LENGTH = 180;
// 상판의 형태를 만들기 위해서 중심선에 점을 찍는 간격 (m)
const SAMPLE_SPACING = 12;
// 교각의 간격과, 선박의 진행 방향으로 잰 교각의 두께 (m)
const PIER_SPACING = 72;
const PIER_THICKNESS = 4;
const PIER_BOTTOM = -6;
// 사장교와 현수교의 주탑이 상판 위로 솟는 높이 (m)
const TOWER_RISE = 48;
const CELL_SIZE = 300;
// 상판을 색인에 등록할 때 중심선의 주변으로 더 포함하는 거리 (m). 상판의 폭 절반보다 커야 한다.
const SPAN_MARGIN = 30;
const DECK_COLOUR = 0xa2a29c;
const PIER_COLOUR = 0x8c8c86;

interface Station {
  x: number;
  z: number;
  /** 상판 아랫면의 높이 (m). 이 높이보다 낮은 선박만 그 아래를 지날 수 있다. */
  underside: number;
}

interface Span {
  stations: Station[];
  halfWidth: number;
}

interface Pier {
  x: number;
  z: number;
  radius: number;
}

/**
 * 바다를 건너는 다리를 3D로 세우고, 교각과의 충돌과 다리 밑의 높이를 판정한다.
 *
 * 자료에는 다리의 중심선과 폭만 있고 높이와 교각의 위치는 없다.
 * 그래서 상판은 양 끝에서 완만하게 올라가서 가운데가 가장 높은 형태로 만들고, 교각은 일정한 간격으로 세운다.
 */
export class Bridges {
  private readonly spans = new SpatialGrid<Span>(CELL_SIZE);
  private readonly piers = new SpatialGrid<Pier>(CELL_SIZE);
  private readonly pierList: Pier[] = [];

  constructor(scene: THREE.Scene) {
    void loadChart()
      .then(({ bridges }) => this.build(scene, bridges))
      .catch((error) => console.warn('다리의 자료를 불러오지 못했습니다.', error));
  }

  /** 모든 교각과 주탑의 위치. 레이더가 교각을 점으로 표시하는 데 사용한다. */
  allPiers(): readonly { x: number; z: number }[] {
    return this.pierList;
  }

  /** 월드의 (x, z) 지점이 교각이나 주탑의 안쪽이면 true */
  hitsPier(x: number, z: number): boolean {
    for (const pier of this.piers.at(x, z)) {
      if (Math.hypot(x - pier.x, z - pier.z) <= pier.radius) return true;
    }
    return false;
  }

  /** 월드의 (x, z) 지점이 다리의 아래이면 상판 아랫면의 높이를, 아니면 undefined를 반환한다. */
  clearanceAt(x: number, z: number): number | undefined {
    let lowest: number | undefined;
    for (const { stations, halfWidth } of this.spans.at(x, z)) {
      for (let i = 0; i < stations.length - 1; i++) {
        const a = stations[i];
        const b = stations[i + 1];
        // 점에서 선분까지의 가장 가까운 지점을 찾고, 그 거리가 상판의 폭 안에 있는지 확인한다.
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) > halfWidth) continue;
        const underside = a.underside + (b.underside - a.underside) * t;
        lowest = lowest === undefined ? underside : Math.min(lowest, underside);
      }
    }
    return lowest;
  }

  private build(scene: THREE.Scene, bridges: ChartBridge[]): void {
    // 구조물과 마찬가지로, 구역의 가운데를 기준으로 한 상대 좌표로 정점을 만들어서 정밀도를 유지한다.
    const anchor = REGION_CENTER;
    const decks: THREE.BufferGeometry[] = [];
    const supports: THREE.BufferGeometry[] = [];

    for (const bridge of bridges) {
      const stations = resample(
        bridge.points.map(([lon, lat]) => latLonToWorld({ lat, lon })),
        SAMPLE_SPACING,
      );
      if (stations.length < 2) continue;
      const length = (stations.length - 1) * SAMPLE_SPACING;
      const ramp = Math.min(RAMP_LENGTH, length / 3);
      const halfWidth = bridge.width / 2;

      // 양 끝에서는 육지의 도로 높이에 맞추고, 가운데로 갈수록 선박이 지날 수 있는 높이까지 올린다.
      const profile: Station[] = stations.map(({ x, z }, i) => {
        const fromEnd = Math.min(i, stations.length - 1 - i) * SAMPLE_SPACING;
        const lift = THREE.MathUtils.smoothstep(fromEnd, 0, ramp);
        const top = ABUTMENT_HEIGHT + Math.max(bridge.clearance + DECK_THICKNESS - ABUTMENT_HEIGHT, 0) * lift;
        return { x, z, underside: top - DECK_THICKNESS };
      });

      decks.push(createDeck(profile, halfWidth, anchor));
      const span: Span = { stations: profile, halfWidth };
      for (const station of profile) this.spans.insertPoint(station.x, station.z, span, SPAN_MARGIN);

      const tall = bridge.structure === 'cable-stayed' || bridge.structure === 'suspension';
      const towerAt = tall ? [Math.round(profile.length * 0.3), Math.round(profile.length * 0.7)] : [];
      const pierStep = Math.round(PIER_SPACING / SAMPLE_SPACING);
      for (let i = pierStep; i < profile.length - 1; i += pierStep) {
        const station = profile[i];
        // 상판이 낮은 양 끝에는 교각을 세우지 않는다.
        if (station.underside < 3) continue;
        const direction = Math.atan2(profile[i + 1].x - profile[i - 1].x, profile[i + 1].z - profile[i - 1].z);
        const isTower = towerAt.some((index) => Math.abs(index - i) < pierStep / 2);

        const height = station.underside - PIER_BOTTOM;
        const pier = new THREE.BoxGeometry(bridge.width * 0.6, height, PIER_THICKNESS);
        pier.rotateY(direction);
        pier.translate(station.x - anchor.x, PIER_BOTTOM + height / 2, station.z - anchor.z);
        supports.push(pier);

        if (isTower) {
          // 주탑은 상판의 양옆에 기둥을 하나씩 세우고, 꼭대기를 가로대로 잇는다.
          const towerTop = station.underside + DECK_THICKNESS + TOWER_RISE;
          const sideX = Math.cos(direction) * (halfWidth + 2);
          const sideZ = -Math.sin(direction) * (halfWidth + 2);
          for (const side of [-1, 1]) {
            const column = new THREE.BoxGeometry(3, towerTop - PIER_BOTTOM, 4);
            column.rotateY(direction);
            column.translate(
              station.x + sideX * side - anchor.x,
              PIER_BOTTOM + (towerTop - PIER_BOTTOM) / 2,
              station.z + sideZ * side - anchor.z,
            );
            supports.push(column);
          }
          const beam = new THREE.BoxGeometry(bridge.width + 7, 3, 4);
          beam.rotateY(direction);
          beam.translate(station.x - anchor.x, towerTop - 4, station.z - anchor.z);
          supports.push(beam);
        }

        const radius = Math.max(bridge.width * 0.3, PIER_THICKNESS / 2) + (isTower ? 4 : 0);
        const entry = { x: station.x, z: station.z, radius };
        this.pierList.push(entry);
        this.piers.insertPoint(station.x, station.z, entry, radius);
      }
    }

    for (const [geometries, colour] of [[decks, DECK_COLOUR], [supports, PIER_COLOUR]] as const) {
      const merged = geometries.length ? mergeGeometries(geometries) : null;
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      // 상판은 면의 앞뒤를 가리지 않고 그려서, 아래에서 올려다볼 때에도 보이게 한다.
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9, side: THREE.DoubleSide }),
      );
      mesh.position.set(anchor.x, 0, anchor.z);
      scene.add(mesh);
    }
  }
}

/** 꺾은선을 따라 일정한 간격으로 점을 다시 찍는다. 자료의 점은 간격이 제각각이어서, 높이의 변화를 고르게 표현할 수 없다. */
function resample(line: { x: number; z: number }[], spacing: number): { x: number; z: number }[] {
  const result = [line[0]];
  let carried = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    let position = spacing - carried;
    while (position <= length) {
      const t = position / length;
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      position += spacing;
    }
    carried = length - (position - spacing);
  }
  return result;
}

/** 중심선의 각 지점에서 좌우로 폭을 벌려서, 윗면과 아랫면, 양쪽의 옆면으로 이루어진 상판을 만든다. */
function createDeck(profile: Station[], halfWidth: number, anchor: { x: number; z: number }): THREE.BufferGeometry {
  const positions: number[] = [];
  // 각 단면의 네 모서리: 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래
  const corners = profile.map((station, i) => {
    const previous = profile[Math.max(i - 1, 0)];
    const next = profile[Math.min(i + 1, profile.length - 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const sideX = (-dz / length) * halfWidth;
    const sideZ = (dx / length) * halfWidth;
    const x = station.x - anchor.x;
    const z = station.z - anchor.z;
    const top = station.underside + DECK_THICKNESS;
    return [
      [x + sideX, top, z + sideZ],
      [x - sideX, top, z - sideZ],
      [x - sideX, station.underside, z - sideZ],
      [x + sideX, station.underside, z + sideZ],
    ];
  });

  const quad = (a: number[], b: number[], c: number[], d: number[]) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < corners.length - 1; i++) {
    const current = corners[i];
    const next = corners[i + 1];
    for (let edge = 0; edge < 4; edge++) {
      const following = (edge + 1) % 4;
      quad(current[edge], next[edge], next[following], current[following]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // 정점을 공유하지 않으므로, 면마다 수직인 방향이 계산되어 모서리가 각지게 표현된다.
  geometry.computeVertexNormals();
  return geometry;
}
