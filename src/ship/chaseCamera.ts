import * as THREE from 'three';
import type { ShipState } from './shipPhysics';
import type { ShipSpec } from './shipSpec';

const FOLLOW_STIFFNESS = 2.5;
const MIN_PITCH = 0.06;
const MAX_PITCH = 1.3;

/** 배의 뒤쪽을 따라가는 카메라. 드래그로 시점을 돌리고 휠로 거리를 조절한다. */
export class ChaseCamera {
  private followHeading = 0;
  private yawOffset = 0;
  private pitch = 0.28;
  private distance: number;
  private readonly target = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    private readonly spec: ShipSpec['camera'],
  ) {
    this.distance = spec.distance;

    element.addEventListener('pointerdown', (event) => element.setPointerCapture(event.pointerId));
    element.addEventListener('pointermove', (event) => {
      if (event.buttons === 0) return;
      this.yawOffset += event.movementX * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + event.movementY * 0.004, MIN_PITCH, MAX_PITCH);
    });
    element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(event.deltaY * 0.001), spec.minDistance, spec.maxDistance);
      },
      { passive: false },
    );
  }

  /** 카메라가 따라가는 침로를 즉시 맞춘다. 배의 시작 방향이 북쪽이 아닐 때 처음부터 선미 쪽에서 바라보게 한다. */
  alignTo(heading: number): void {
    this.followHeading = heading;
  }

  resetView(): void {
    this.yawOffset = 0;
  }

  update(dt: number, ship: ShipState): void {
    // 선회할 때 카메라가 약간 늦게 따라오도록 침로를 지수 감쇠로 추종한다.
    const headingError = Math.atan2(
      Math.sin(ship.heading - this.followHeading),
      Math.cos(ship.heading - this.followHeading),
    );
    this.followHeading += headingError * (1 - Math.exp(-FOLLOW_STIFFNESS * dt));

    const viewHeading = this.followHeading + this.yawOffset;
    const horizontal = this.distance * Math.cos(this.pitch);

    this.target.set(ship.x, this.spec.targetHeight, ship.z);
    this.camera.position.set(
      ship.x - Math.sin(viewHeading) * horizontal,
      this.spec.targetHeight + this.distance * Math.sin(this.pitch),
      ship.z + Math.cos(viewHeading) * horizontal,
    );
    this.camera.lookAt(this.target);
  }
}
