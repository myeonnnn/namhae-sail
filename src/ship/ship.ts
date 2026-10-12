import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Input } from '../core/input';
import { createShipState, stepShip, type ShipControls, type ShipState } from './shipPhysics';
import type { ShipSpec } from './shipSpec';

const TWO_PI = Math.PI * 2;

export class Ship {
  readonly state: ShipState = createShipState();
  readonly controls: ShipControls = { throttle: 0, rudder: 0 };
  /** 선수가 -Z를 향하고 원점이 수면 높이에 놓이는 그룹. 모델은 비동기로 불러와서 이 안에 추가한다. */
  readonly object = new THREE.Group();

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

    stepShip(this.state, controls, spec.physics, dt);
  }

  /** 물리 상태를 메시에 반영한다. 파도 변위는 아직 없으므로 흔들림은 연출용 근사값이다. */
  syncObject(elapsed: number): void {
    const { state, object } = this;
    const m = this.spec.motion;

    object.position.set(state.x, Math.sin((elapsed / m.heavePeriod) * TWO_PI) * m.heaveAmplitude, state.z);
    object.rotation.set(
      Math.sin((elapsed / m.pitchPeriod) * TWO_PI) * m.pitchAmplitude,
      -state.heading,
      m.heelGain * state.yawRate * state.surge + Math.sin((elapsed / m.rollPeriod) * TWO_PI) * m.rollAmplitude,
    );
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
