import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyHelm, type HelmCommand } from '../core/helm';
import { stepRoll, type RollState } from './rollDynamics';
import { measureSeaLoad } from './seakeeping';
import { createShipState, stepShip, type ShipControls, type ShipState } from './shipPhysics';
import type { ShipSpec } from './shipSpec';

// 뒤집힌 선체의 감쇠비와, 물에 잠긴 선체가 멈추는 빠르기 (1/s)
const CAPSIZED_DAMPING = 0.6;
const CAPSIZED_DRAG = 0.8;
// 육지와의 접촉을 검사하는 지점: 선수, 선수 좌우, 중앙 좌우, 선미
const HULL_CONTACT_POINTS = [
  [0.48, 0],
  [0.3, -0.4],
  [0.3, 0.4],
  [0, -0.5],
  [0, 0.5],
  [-0.48, 0],
] as const;

// 출발을 기다리는 동안 수면의 기울기에서 벗어날 수 있는 가장 큰 각도 (rad). 흔들림은 보이되 뒤집힐 각도에는 한참 못 미친다.
const STEADY_MAX_OFFSET = (20 * Math.PI) / 180;

export class Ship {
  readonly state: ShipState = createShipState();
  readonly controls: ShipControls = { throttle: 0, rudder: 0 };
  /** 선수가 -Z를 향하고 원점이 수면 높이에 놓이는 그룹. 모델은 비동기로 불러와서 이 안에 추가한다. */
  readonly object = new THREE.Group();
  /** 선박의 모델을 불러오면 완료된다. 실패해도 완료되므로, 시작 화면이 끝없이 기다리지 않는다. */
  readonly ready: Promise<void>;
  /** 엔진의 회전수 (rpm). 스로틀을 조금 늦게 따라간다. */
  rpm: number;
  /** 선체가 뒤집혔으면 true. recover를 호출하기 전까지는 조종할 수 없다. */
  capsized = false;
  /** 부서지는 마루가 선체의 옆면을 때리는 세기 (0 이상). 연출에 사용한다. */
  breaking = 0;
  private heave = 0;
  private previousX = 0;
  private previousZ = 0;
  private previousHeading = 0;
  private pitch = 0;
  private readonly roll: RollState = { angle: 0, rate: 0 };

  constructor(private readonly spec: ShipSpec) {
    this.rpm = spec.engine.idleRpm;
    this.object.rotation.order = 'YXZ';
    this.ready = this.loadModel().catch((error) => console.warn('선박의 모델을 불러오지 못했습니다.', error));
  }

  update(dt: number, helm: HelmCommand, wind: { x: number; z: number }): void {
    const { controls, spec } = this;

    if (this.capsized) {
      // 뒤집힌 배는 엔진이 멈추고, 물의 저항으로 곧 멈춘다. 바람과 파도에 밀리는 움직임만 남는다.
      controls.throttle = 0;
      controls.rudder = 0;
      this.rpm += (0 - this.rpm) * (1 - Math.exp(-spec.engine.response * dt));
      const drag = Math.exp(-CAPSIZED_DRAG * dt);
      this.state.surge *= drag;
      this.state.yawRate *= drag;
      this.previousX = this.state.x;
      this.previousZ = this.state.z;
      this.previousHeading = this.state.heading;
      stepShip(this.state, controls, spec.physics, wind, dt);
      return;
    }

    applyHelm(controls, helm, spec.controls, dt);

    // 전진과 후진 모두 스로틀을 올릴수록 회전수가 높아진다. 엔진은 레버를 움직여도 즉시 반응하지 않는다.
    const { idleRpm, maxRpm, response } = spec.engine;
    const targetRpm = idleRpm + Math.abs(controls.throttle) * (maxRpm - idleRpm);
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-response * dt));

    this.previousX = this.state.x;
    this.previousZ = this.state.z;
    this.previousHeading = this.state.heading;
    stepShip(this.state, controls, spec.physics, wind, dt);
  }

  /** 횡경사 (rad). 우현 쪽으로 기울어지면 양수이다. 파도와 선회에 의한 기울기가 모두 포함된다. */
  get heel(): number {
    return -this.roll.angle;
  }

  /** 뒤집힌 선체를 바로 세운다. 배를 다시 배치할 때 호출한다. */
  recover(): void {
    this.capsized = false;
    this.breaking = 0;
    this.roll.angle = 0;
    this.roll.rate = 0;
  }

  /**
   * 선체가 육지에 닿았으면 직전의 위치로 되돌리고 멈춘다.
   * 스로틀은 그대로 두므로, 후진으로 바꾸면 빠져나올 수 있다.
   */
  resolveGrounding(isLand: (x: number, z: number) => boolean): boolean {
    const { state, spec } = this;
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    const touching = HULL_CONTACT_POINTS.some(([along, across]) => {
      const forward = along * spec.model.length;
      const starboard = across * spec.model.beam;
      return isLand(state.x + forward * sin + starboard * cos, state.z - forward * cos + starboard * sin);
    });
    if (!touching) return false;
    this.stopAtPreviousPosition();
    return true;
  }

  /** 직전 스텝의 위치로 되돌리고 멈춘다. 통과할 수 없는 물체에 닿았을 때 사용한다. */
  stopAtPreviousPosition(): void {
    const { state } = this;
    state.x = this.previousX;
    state.z = this.previousZ;
    state.heading = this.previousHeading;
    state.surge = 0;
    state.sway = 0;
    state.yawRate = 0;
  }

  /**
   * 물리 상태를 메시에 반영하고, 선체 아래의 수면과 바람을 읽어서 상하 움직임과 기울기를 계산한다.
   * elapsed는 수면의 셰이더에 전달하는 시간과 동일해야 한다.
   *
   * @param wind 바람이 공기를 이동시키는 속도 (월드 좌표, m/s)
   * @param steady true이면 선체가 수면의 기울기를 따라 흔들리기만 하고 뒤집히지 않는다. 타임어택의 카운트다운에 사용한다.
   */
  syncObject(elapsed: number, frameTime: number, wind: { x: number; z: number }, steady = false): void {
    const { state, object, spec } = this;
    const load = measureSeaLoad(spec, state, wind, elapsed);

    // 상하 움직임과 앞뒤 기울기는 수면을 조금 늦게 따라간다. 무거운 선체는 수면의 변화를 즉시 따라가지 못한다.
    const blend = 1 - Math.exp(-spec.motion.waveResponse * frameTime);
    this.heave += (load.heave - this.heave) * blend;
    this.pitch += (load.pitch - this.pitch) * blend;

    // 좌우 기울기는 관성을 가지고 흔들린다. 파도를 옆으로 받으면 크게 흔들리고, 선수로 받으면 거의 흔들리지 않는다.
    // 뒤집힌 선체는 넓은 갑판이 물에 잠겨서 흔들림이 금방 잦아든다.
    const params = this.capsized ? { ...spec.motion.roll, damping: CAPSIZED_DAMPING } : spec.motion.roll;
    const speed = Math.hypot(state.surge, state.sway);
    stepRoll(this.roll, load.surfaceSlope, this.capsized || steady ? 0 : load.heeling, params, speed, frameTime);
    this.breaking = this.capsized || steady ? 0 : load.breaking;
    if (steady) {
      // 출발을 기다리는 동안 멈춘 배가 옆파도에 뒤집히면 시작도 하기 전에 끝난다.
      // 수면을 따라 흔들리게는 두되, 수면에서 벗어나는 기울기를 제한해서 뒤집히지 않게 한다.
      const offset = this.roll.angle - load.surfaceSlope;
      if (Math.abs(offset) > STEADY_MAX_OFFSET) {
        this.roll.angle = load.surfaceSlope + Math.sign(offset) * STEADY_MAX_OFFSET;
        this.roll.rate = 0;
      }
    }

    // 수면에 대한 기울기가 복원력이 사라지는 각도를 넘으면 되돌아오지 못한다.
    if (!this.capsized && !steady && Math.abs(this.roll.angle - load.surfaceSlope) > spec.motion.roll.vanishingAngle) {
      this.capsized = true;
    }

    object.position.set(state.x, this.heave, state.z);
    object.rotation.set(this.pitch, -state.heading, this.roll.angle);
  }

  private async loadModel(): Promise<void> {
    const { url, sourceLength, length, draft, bowTowardPositiveZ } = this.spec.model;
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;

    model.scale.setScalar(length / sourceLength);
    model.position.y = -draft;
    if (bowTowardPositiveZ) model.rotation.y = Math.PI;
    // 연돌과 선실이 갑판에 그림자를 드리우도록 한다.
    model.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });
    this.object.add(model);
  }
}
