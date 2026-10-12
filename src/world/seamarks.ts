import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { latLonToWorld } from '../geo/projection';
import { sampleWaveHeight } from '../ocean/waves';

type SeamarkKind = 'light' | 'beacon' | 'buoy';

/** scripts/fetch-seamarks.mjs가 저장하는 형식 */
interface SeamarkRecord {
  kind: SeamarkKind;
  lat: number;
  lon: number;
  /** 구조물의 색상 */
  colour?: string;
  /** 등화의 색상 */
  light?: string;
  /** 등화가 한 번 반복되는 주기 (초) */
  period?: number;
  /** 등화의 해수면 기준 높이 (m). 구조물 자체의 높이가 아니다. */
  height?: number;
  name?: string;
}

interface Seamark extends SeamarkRecord {
  x: number;
  z: number;
  /** 등화가 서로 동시에 깜빡이지 않도록 표지마다 다르게 주는 시간의 어긋남 (초) */
  phase: number;
}

const DATA_URL = '/data/seamarks.json';
// 연무 때문에 이 거리보다 먼 표지는 보이지 않으므로 그리지 않는다.
const VISIBLE_RADIUS = 9000;
const REFRESH_INTERVAL_MS = 500;
const CELL_SIZE = 4000;
const MAX_INSTANCES = 512;
// 이 거리 안의 부표만 파도를 따라 움직인다. 먼 곳의 수면은 파도의 굴곡 없이 평평하게 그려지기 때문이다.
const BOB_FULL_DISTANCE = 400;
const BOB_FADE_DISTANCE = 1200;
const DEFAULT_PERIOD = 5;
// 한 주기 중에서 등화가 켜져 있는 시간의 상한 (초)
const FLASH_DURATION = 1;
const DEFAULT_LIGHT_ELEVATION = 14;
const MIN_TOWER_HEIGHT = 7;
const MAX_TOWER_HEIGHT = 30;

const COLOURS: Record<string, number> = {
  red: 0xc5242c,
  green: 0x1f9a4c,
  yellow: 0xf0bd12,
  white: 0xf2f2ee,
  black: 0x1c1c1c,
  orange: 0xe8742a,
};
const LAMP_COLOURS: Record<string, number> = {
  red: 0xff3b30,
  green: 0x30ff6a,
  yellow: 0xffd640,
  white: 0xfff6dc,
};

/** 등대: 위로 갈수록 가늘어지는 탑과 난간, 등롱, 지붕. 높이 1을 기준으로 만들고 배치할 때 늘린다. */
function createLighthouseGeometry(): THREE.BufferGeometry {
  const tower = new THREE.CylinderGeometry(0.1, 0.16, 0.8, 16).translate(0, 0.4, 0);
  const gallery = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 16).translate(0, 0.815, 0);
  const lantern = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12).translate(0, 0.89, 0);
  const roof = new THREE.ConeGeometry(0.1, 0.05, 12).translate(0, 0.975, 0);
  return mergeGeometries([tower, gallery, lantern, roof])!;
}

/** 등표: 물이나 암초 위에 고정된 기둥과 받침, 꼭대기의 표지. 높이 8m. */
function createBeaconGeometry(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(1.4, 1.8, 1.5, 12).translate(0, 0.75, 0);
  const pole = new THREE.CylinderGeometry(0.4, 0.5, 6, 10).translate(0, 4.5, 0);
  const topmark = new THREE.CylinderGeometry(0.9, 0.9, 1, 10).translate(0, 8, 0);
  return mergeGeometries([base, pole, topmark])!;
}

/** 부표: 물에 떠 있는 원통형 몸체와 그 위의 뾰족한 구조물. 수면이 y = 0이며 높이 4m. */
function createBuoyGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(1.1, 1.2, 1.6, 14).translate(0, 0.2, 0);
  const tower = new THREE.CylinderGeometry(0.2, 0.75, 2.8, 10).translate(0, 2.4, 0);
  return mergeGeometries([body, tower])!;
}

const KINDS: Record<SeamarkKind, { geometry: () => THREE.BufferGeometry; lampHeight: number; lampRadius: number }> = {
  light: { geometry: createLighthouseGeometry, lampHeight: 0.89, lampRadius: 0.07 },
  beacon: { geometry: createBeaconGeometry, lampHeight: 9, lampRadius: 0.55 },
  buoy: { geometry: createBuoyGeometry, lampHeight: 4.1, lampRadius: 0.45 },
};

/**
 * 등대, 등표, 부표를 3D로 표시한다.
 * 같은 종류의 표지는 형태가 동일하므로 InstancedMesh로 한 번에 그리고, 배 주변의 표지만 골라서 배치한다.
 */
export class Seamarks {
  private readonly cells = new Map<string, Seamark[]>();
  private readonly bodies: Record<SeamarkKind, THREE.InstancedMesh>;
  private readonly lamps: THREE.InstancedMesh;
  private active: Seamark[] = [];
  private lastRefreshTime = -Infinity;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly colour = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    /** 지형의 높이를 반환하는 함수. 등대와 등표를 땅 위에 올려놓는 데 사용한다. */
    private readonly groundHeight: (x: number, z: number) => number | undefined,
  ) {
    const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    const createBodies = (kind: SeamarkKind) => {
      const mesh = new THREE.InstancedMesh(KINDS[kind].geometry(), bodyMaterial, MAX_INSTANCES);
      mesh.count = 0;
      // 표지가 넓은 범위에 흩어져 있어서, 하나의 경계 구로는 화면 밖 여부를 판정할 수 없다.
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };
    this.bodies = { light: createBodies('light'), beacon: createBodies('beacon'), buoy: createBodies('buoy') };

    // 등화는 조명의 영향을 받지 않고 스스로 빛나는 구로 표현한다. 연무에 묻히지 않아야 멀리서도 보인다.
    this.lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }),
      MAX_INSTANCES * 3,
    );
    this.lamps.count = 0;
    this.lamps.frustumCulled = false;
    scene.add(this.lamps);

    void this.load();
  }

  update(elapsed: number, focusX: number, focusZ: number): void {
    const now = performance.now();
    if (now - this.lastRefreshTime >= REFRESH_INTERVAL_MS) {
      this.lastRefreshTime = now;
      this.active = this.collectNearby(focusX, focusZ);
    }

    const counts: Record<SeamarkKind, number> = { light: 0, beacon: 0, buoy: 0 };
    let lampCount = 0;

    for (const mark of this.active) {
      const index = counts[mark.kind];
      if (index >= MAX_INSTANCES) continue;
      counts[mark.kind]++;

      const { lampHeight, lampRadius } = KINDS[mark.kind];
      let baseY = 0;
      let size = 1;
      if (mark.kind === 'buoy') {
        const distance = Math.hypot(mark.x - focusX, mark.z - focusZ);
        const bob = 1 - THREE.MathUtils.smoothstep(distance, BOB_FULL_DISTANCE, BOB_FADE_DISTANCE);
        baseY = bob > 0 ? sampleWaveHeight(mark.x, mark.z, elapsed) * bob : 0;
      } else {
        // 지형이 아직 불러와지지 않았거나 바다로 판정된 곳이면 수면 높이에 세운다. 방파제 끝의 등대가 여기에 해당한다.
        baseY = Math.max(this.groundHeight(mark.x, mark.z) ?? 0, 0);
        if (mark.kind === 'light') {
          // 자료의 높이는 등화의 해수면 기준 높이이므로, 땅의 높이를 빼야 탑의 높이가 된다.
          const towerHeight = (mark.height ?? DEFAULT_LIGHT_ELEVATION) - baseY;
          size = THREE.MathUtils.clamp(towerHeight, MIN_TOWER_HEIGHT, MAX_TOWER_HEIGHT);
        }
      }

      const body = this.bodies[mark.kind];
      this.position.set(mark.x, baseY, mark.z);
      this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(size));
      body.setMatrixAt(index, this.matrix);
      body.setColorAt(index, this.colour.setHex(bodyColour(mark)));

      if (mark.light && isLampOn(mark, elapsed)) {
        this.position.y = baseY + lampHeight * size;
        this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(lampRadius * size * 1.6));
        this.lamps.setMatrixAt(lampCount, this.matrix);
        this.lamps.setColorAt(lampCount, this.colour.setHex(LAMP_COLOURS[mark.light] ?? LAMP_COLOURS['white']));
        lampCount++;
      }
    }

    for (const kind of Object.keys(this.bodies) as SeamarkKind[]) this.commit(this.bodies[kind], counts[kind]);
    this.commit(this.lamps, lampCount);
  }

  private commit(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const records = (await response.json()) as SeamarkRecord[];
      records.forEach((record, index) => {
        const { x, z } = latLonToWorld(record);
        // 황금비를 이용해서 표지마다 고르게 흩어진 어긋남을 준다.
        const mark: Seamark = { ...record, x, z, phase: (index * 0.618034 * 10) % 10 };
        const key = cellKey(x, z);
        const cell = this.cells.get(key);
        if (cell) cell.push(mark);
        else this.cells.set(key, [mark]);
      });
    } catch (error) {
      console.warn('해상 표지 자료를 불러오지 못했습니다.', error);
    }
  }

  /** 격자로 나누어 둔 표지 중에서 배 주변의 칸만 조사해서, 보이는 거리 안의 표지를 모은다. */
  private collectNearby(focusX: number, focusZ: number): Seamark[] {
    const result: Seamark[] = [];
    const reach = Math.ceil(VISIBLE_RADIUS / CELL_SIZE);
    const centerX = Math.floor(focusX / CELL_SIZE);
    const centerZ = Math.floor(focusZ / CELL_SIZE);
    for (let cz = centerZ - reach; cz <= centerZ + reach; cz++) {
      for (let cx = centerX - reach; cx <= centerX + reach; cx++) {
        for (const mark of this.cells.get(`${cx}/${cz}`) ?? []) {
          if (Math.hypot(mark.x - focusX, mark.z - focusZ) <= VISIBLE_RADIUS) result.push(mark);
        }
      }
    }
    return result;
  }
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL_SIZE)}/${Math.floor(z / CELL_SIZE)}`;
}

function bodyColour(mark: Seamark): number {
  if (mark.colour) return COLOURS[mark.colour] ?? COLOURS['white'];
  // 등대의 자료에는 구조물의 색상이 없는 경우가 많다.
  // 한국의 방파제 등대는 항구로 들어올 때 오른쪽이 붉은색 탑에 붉은 등, 왼쪽이 흰색 탑에 녹색 등이므로 등화의 색상으로 추정한다.
  if (mark.light === 'red') return COLOURS['red'];
  if (mark.light === 'yellow') return COLOURS['yellow'];
  return COLOURS['white'];
}

function isLampOn(mark: Seamark, elapsed: number): boolean {
  const period = mark.period ?? DEFAULT_PERIOD;
  return (elapsed + mark.phase) % period < Math.min(FLASH_DURATION, period * 0.3);
}
