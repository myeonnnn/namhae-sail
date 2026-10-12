import * as THREE from 'three';
import type { Input } from '../core/input';
import { createShipState, stepShip, type ShipControls, type ShipState } from './shipPhysics';

const THROTTLE_RATE = 0.6;
const RUDDER_RATE = 1.5;
const HEEL_GAIN = 0.03;
const MAX_SPEED = 12;

export class Ship {
  readonly state: ShipState = createShipState();
  readonly controls: ShipControls = { throttle: 0, rudder: 0 };
  readonly object = createShipMesh();

  update(dt: number, input: Input): void {
    const { controls } = this;

    // 스로틀은 레버처럼 놓은 위치에 머무르고, 타는 키를 놓으면 중앙으로 복귀한다.
    const throttleInput = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    controls.throttle = THREE.MathUtils.clamp(controls.throttle + throttleInput * THROTTLE_RATE * dt, -1, 1);
    if (input.isDown('Space')) controls.throttle = 0;

    const rudderTarget = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    controls.rudder = moveToward(controls.rudder, rudderTarget, RUDDER_RATE * dt);

    stepShip(this.state, controls, dt);
  }

  /** 물리 상태를 메시에 반영한다. 파도 변위는 아직 없으므로 흔들림은 연출용 근사값이다. */
  syncObject(elapsed: number): void {
    const { state, object } = this;
    const speedRatio = state.surge / MAX_SPEED;

    object.position.set(state.x, Math.sin(elapsed * 1.3) * 0.12, state.z);
    object.rotation.set(
      0.035 * speedRatio + Math.sin(elapsed * 0.9) * 0.012,
      -state.heading,
      -HEEL_GAIN * state.yawRate * state.surge + Math.sin(elapsed * 0.7) * 0.02,
    );
  }
}

function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}

/** 길이 12m, 폭 4m의 임시 선체. 선수는 -Z 방향이다. */
function createShipMesh(): THREE.Group {
  const outline = new THREE.Shape();
  outline.moveTo(-1.6, -6);
  outline.lineTo(1.6, -6);
  outline.lineTo(2, 1);
  outline.quadraticCurveTo(1.6, 4.5, 0, 6);
  outline.quadraticCurveTo(-1.6, 4.5, -2, 1);
  outline.closePath();

  const hullGeometry = new THREE.ExtrudeGeometry(outline, { depth: 1.8, bevelEnabled: false });
  // Shape의 +Y(선수)를 -Z로, 압출 방향을 +Y(위)로 돌린다.
  hullGeometry.rotateX(-Math.PI / 2);
  hullGeometry.translate(0, -0.6, 0);

  const hull = new THREE.Mesh(
    hullGeometry,
    new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.45, metalness: 0.1 }),
  );

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.6, 3.6),
    new THREE.MeshStandardMaterial({ color: 0x24506e, roughness: 0.35, metalness: 0.2 }),
  );
  cabin.position.set(0, 2.0, 1.2);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.5 }),
  );
  mast.position.set(0, 3.9, 1.2);

  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  group.add(hull, cabin, mast);
  return group;
}
