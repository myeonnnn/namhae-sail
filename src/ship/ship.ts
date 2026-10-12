import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Input } from '../core/input';
import { sampleWaveHeight } from '../ocean/waves';
import { createShipState, stepShip, type ShipControls, type ShipState } from './shipPhysics';
import type { ShipSpec } from './shipSpec';

// 선체의 길이와 폭에 대한 비율로 표현한 수면의 측정 위치
const HULL_SAMPLES_ALONG = [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42];
const HULL_SAMPLES_ACROSS = [-0.35, 0, 0.35];
// 육지와의 접촉을 검사하는 지점: 선수, 선수 좌우, 중앙 좌우, 선미
const HULL_CONTACT_POINTS = [
  [0.48, 0],
  [0.3, -0.4],
  [0.3, 0.4],
  [0, -0.5],
  [0, 0.5],
  [-0.48, 0],
] as const;

export class Ship {
  readonly state: ShipState = createShipState();
  readonly controls: ShipControls = { throttle: 0, rudder: 0 };
  /** 선수가 -Z를 향하고 원점이 수면 높이에 놓이는 그룹. 모델은 비동기로 불러와서 이 안에 추가한다. */
  readonly object = new THREE.Group();
  private heave = 0;
  private previousX = 0;
  private previousZ = 0;
  private previousHeading = 0;
  private pitch = 0;
  private roll = 0;

  constructor(private readonly spec: ShipSpec) {
    this.object.rotation.order = 'YXZ';
    void this.loadModel();
  }

  update(dt: number, input: Input): void {
    const { controls, spec } = this;

    // 스로틀은 레버처럼 놓은 위치에 머무르고, 타는 키를 놓으면 중앙으로 복귀한다.
    const throttleInput = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    controls.throttle = THREE.MathUtils.clamp(
      controls.throttle + throttleInput * spec.controls.throttleRate * dt,
      -1,
      1,
    );
    if (input.isDown('Space')) controls.throttle = 0;

    const rudderTarget = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    controls.rudder = moveToward(controls.rudder, rudderTarget, spec.controls.rudderRate * dt);

    this.previousX = this.state.x;
    this.previousZ = this.state.z;
    this.previousHeading = this.state.heading;
    stepShip(this.state, controls, spec.physics, dt);
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

    state.x = this.previousX;
    state.z = this.previousZ;
    state.heading = this.previousHeading;
    state.surge = 0;
    state.sway = 0;
    state.yawRate = 0;
    return true;
  }

  /**
   * 물리 상태를 메시에 반영하고, 선체 아래의 수면을 읽어서 상하 움직임과 기울기를 계산한다.
   * elapsed는 수면의 셰이더에 전달하는 시간과 동일해야 한다.
   */
  syncObject(elapsed: number, frameTime: number): void {
    const { state, object, spec } = this;
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);

    // 선체의 수선면에 격자 모양으로 점을 찍고, 각 점에서 읽은 수면의 높이에 평면을 맞춘다.
    // 평면의 평균 높이가 상하 움직임이 되고, 앞뒤 기울기와 좌우 기울기가 각각 종동요와 횡동요가 된다.
    let heightSum = 0;
    let alongMoment = 0;
    let alongSquare = 0;
    let acrossMoment = 0;
    let acrossSquare = 0;
    for (const along of HULL_SAMPLES_ALONG) {
      for (const across of HULL_SAMPLES_ACROSS) {
        const forward = along * spec.model.length;
        const starboard = across * spec.model.beam;
        const height = sampleWaveHeight(
          state.x + forward * sin + starboard * cos,
          state.z - forward * cos + starboard * sin,
          elapsed,
        );
        heightSum += height;
        alongMoment += forward * height;
        alongSquare += forward * forward;
        acrossMoment += starboard * height;
        acrossSquare += starboard * starboard;
      }
    }
    const sampleCount = HULL_SAMPLES_ALONG.length * HULL_SAMPLES_ACROSS.length;
    const targetHeave = heightSum / sampleCount;
    const targetPitch = Math.atan(alongMoment / alongSquare);
    const targetRoll = Math.atan(acrossMoment / acrossSquare) * spec.motion.rollRatio;

    // 무거운 선체는 수면의 변화를 즉시 따라가지 못하므로 지수 감쇠로 지연시킨다.
    const blend = 1 - Math.exp(-spec.motion.waveResponse * frameTime);
    this.heave += (targetHeave - this.heave) * blend;
    this.pitch += (targetPitch - this.pitch) * blend;
    this.roll += (targetRoll - this.roll) * blend;

    object.position.set(state.x, this.heave, state.z);
    object.rotation.set(this.pitch, -state.heading, this.roll + spec.motion.heelGain * state.yawRate * state.surge);
  }

  private async loadModel(): Promise<void> {
    const { url, sourceLength, length, draft, bowTowardPositiveZ } = this.spec.model;
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;

    model.scale.setScalar(length / sourceLength);
    model.position.y = -draft;
    if (bowTowardPositiveZ) model.rotation.y = Math.PI;
    this.object.add(model);
  }
}

function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}
