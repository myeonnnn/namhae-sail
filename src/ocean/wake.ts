import * as THREE from 'three';

/** 항적을 남기는 물체의 운동 상태. 수면이 선박의 모듈을 참조하지 않도록, 필요한 값만 정의한다. */
interface WakeSource {
  x: number;
  z: number;
  /** 북쪽을 0으로 하는 시계 방향의 방위 (rad) */
  heading: number;
  /** 선수 방향의 속도 (m/s) */
  surge: number;
}

const MAP_SIZE = 2048;
const MAX_POINTS = 200;
// 아래의 수치는 길이 180m, 폭 40m의 선박을 기준으로 정한 값이며, 실제 선체의 크기에 비례해서 조정한다.
const REFERENCE_LENGTH = 180;
// 항적이 생기기 시작하는 속력과 가장 짙어지는 속력 (m/s)
const MIN_WAKE_SPEED = 0.5;
const FULL_WAKE_SPEED = 7;
// 켈빈 항적의 반각 19.47°의 탄젠트. 선수에서 갈라지는 물결은 속력과 무관하게 이 각도로 벌어진다.
const KELVIN_SPREAD = 0.354;
const RIBBON_COUNT = 3;

interface TrailPoint {
  x: number;
  z: number;
  heading: number;
  speed: number;
  time: number;
}

const vertexShader = /* glsl */ `
  attribute vec2 aStrip;
  uniform vec2 uCenter;
  uniform float uHalfExtent;
  varying vec2 vStrip;

  void main() {
    vStrip = aStrip;
    // 카메라 없이 월드의 (x, z)를 지도의 좌표로 직접 변환한다.
    gl_Position = vec4((position.xz - uCenter) / uHalfExtent, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vStrip;

  void main() {
    // 띠의 가운데가 가장 짙고 가장자리로 갈수록 옅어진다.
    float strength = vStrip.y * (1.0 - vStrip.x * vStrip.x);
    gl_FragColor = vec4(vec3(strength), 1.0);
  }
`;

/**
 * 배가 지나간 자리의 물거품을 위에서 내려다본 지도(텍스처)로 그린다.
 * 수면의 셰이더가 이 지도를 읽어서 물거품을 표시하므로, 항적이 파도의 굴곡을 그대로 따라간다.
 *
 * 선미 뒤로 이어지는 넓은 띠 하나와, 선수에서 양쪽으로 갈라지는 가는 띠 두 개로 구성된다.
 */
export class Wake {
  readonly texture: THREE.Texture;
  /** 지도의 중심에 해당하는 월드의 (x, z) */
  readonly center = new THREE.Vector2();
  /** 항적 지도가 덮는 범위의 절반 (m). 배를 중심으로 한 정사각형이며, 작은 배일수록 좁게 잡아서 해상도를 확보한다. */
  readonly halfExtent: number;
  /** 이동 경로를 기록하는 간격 (m) */
  private readonly pointSpacing: number;
  /** 선미의 물거품이 약 37%로 옅어지는 데 걸리는 시간 (초). 큰 배의 항적일수록 오래 남는다. */
  private readonly wakeLife: number;

  private readonly target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, { depthBuffer: false });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly positions = new Float32Array(RIBBON_COUNT * MAX_POINTS * 2 * 3);
  private readonly strips = new Float32Array(RIBBON_COUNT * MAX_POINTS * 2 * 2);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly trail: TrailPoint[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly hull: { length: number; beam: number },
  ) {
    this.texture = this.target.texture;
    this.halfExtent = Math.max(250, hull.length * 9);
    this.pointSpacing = Math.max(1.5, hull.length * 0.045);
    this.wakeLife = 20 * Math.sqrt(hull.length / REFERENCE_LENGTH);

    const indices: number[] = [];
    for (let ribbon = 0; ribbon < RIBBON_COUNT; ribbon++) {
      for (let i = 0; i < MAX_POINTS - 1; i++) {
        const a = (ribbon * MAX_POINTS + i) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setIndex(indices);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aStrip', new THREE.BufferAttribute(this.strips, 2));

    const mesh = new THREE.Mesh(
      this.geometry,
      new THREE.ShaderMaterial({
        uniforms: { uCenter: { value: this.center }, uHalfExtent: { value: this.halfExtent } },
        vertexShader,
        fragmentShader,
        // 선회할 때 띠가 겹치는 곳은 물거품이 더해지도록 가산 혼합을 사용한다.
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** 기록한 경로를 지운다. 배를 다른 곳으로 옮겼을 때, 이전의 위치에서 새 위치까지 물거품이 이어지지 않게 한다. */
  reset(): void {
    this.trail.length = 0;
  }

  update(elapsed: number, ship: WakeSource): void {
    this.recordTrail(elapsed, ship);
    this.buildRibbons(elapsed, ship);

    this.center.set(ship.x, ship.z);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private recordTrail(elapsed: number, ship: WakeSource): void {
    const { trail } = this;
    const newest = trail[0];
    if (!newest || Math.hypot(ship.x - newest.x, ship.z - newest.z) >= this.pointSpacing) {
      trail.unshift({ x: ship.x, z: ship.z, heading: ship.heading, speed: Math.abs(ship.surge), time: elapsed });
    }
    while (
      trail.length > MAX_POINTS - 1 ||
      (trail.length > 0 && elapsed - trail[trail.length - 1].time > this.wakeLife * 2.7)
    ) {
      trail.pop();
    }
  }

  private buildRibbons(elapsed: number, ship: WakeSource): void {
    const { length, beam } = this.hull;
    const sternOffset = -0.46 * length;
    const bowOffset = 0.42 * length;

    for (let i = 0; i < MAX_POINTS; i++) {
      // 0번은 배의 현재 위치이다. 기록된 지점만 사용하면 띠의 머리가 배보다 한 칸 뒤처진다.
      // 기록이 없는 뒤쪽 칸은 마지막 지점에 세기 0으로 겹쳐 놓아서 보이지 않게 한다.
      const recorded = i === 0 ? undefined : this.trail[Math.min(i, this.trail.length) - 1];
      const beyondTrail = i > this.trail.length;
      const x = recorded?.x ?? ship.x;
      const z = recorded?.z ?? ship.z;
      const heading = recorded?.heading ?? ship.heading;
      const speed = recorded?.speed ?? Math.abs(ship.surge);
      const age = recorded ? elapsed - recorded.time : 0;

      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const strength = beyondTrail ? 0 : THREE.MathUtils.smoothstep(speed, MIN_WAKE_SPEED, FULL_WAKE_SPEED);

      // 선미 뒤의 난류 항적: 프로펠러가 휘저은 물이 넓게 퍼지면서 서서히 사라진다.
      this.writeStation(
        0,
        i,
        x + sternOffset * sin,
        z - sternOffset * cos,
        cos,
        sin,
        beam * (0.32 + Math.min((age / this.wakeLife) * 0.28, 0.35)),
        strength * 0.9 * Math.exp(-age / this.wakeLife),
      );

      // 선수에서 갈라지는 물결: 발생한 뒤로 바깥쪽으로 계속 이동하므로 V자 형태가 된다.
      const spread = 0.12 * beam + speed * age * KELVIN_SPREAD;
      const armHalfWidth = beam * (0.0625 + Math.min((age / this.wakeLife) * 0.135, 0.1625));
      const armStrength = strength * Math.exp(-age / (this.wakeLife * 0.67));
      const bowX = x + bowOffset * sin;
      const bowZ = z - bowOffset * cos;
      this.writeStation(1, i, bowX + spread * cos, bowZ + spread * sin, cos, sin, armHalfWidth, armStrength);
      this.writeStation(2, i, bowX - spread * cos, bowZ - spread * sin, cos, sin, armHalfWidth, armStrength);
    }

    this.geometry.attributes['position'].needsUpdate = true;
    this.geometry.attributes['aStrip'].needsUpdate = true;
  }

  /** 띠의 한 단면(좌우 두 정점)을 기록한다. (sideX, sideZ)는 띠의 폭 방향이다. */
  private writeStation(
    ribbon: number,
    index: number,
    x: number,
    z: number,
    sideX: number,
    sideZ: number,
    halfWidth: number,
    strength: number,
  ): void {
    const vertex = (ribbon * MAX_POINTS + index) * 2;
    const p = vertex * 3;
    const s = vertex * 2;

    this.positions[p] = x - sideX * halfWidth;
    this.positions[p + 2] = z - sideZ * halfWidth;
    this.positions[p + 3] = x + sideX * halfWidth;
    this.positions[p + 5] = z + sideZ * halfWidth;

    this.strips[s] = -1;
    this.strips[s + 1] = strength;
    this.strips[s + 2] = 1;
    this.strips[s + 3] = strength;
  }
}
