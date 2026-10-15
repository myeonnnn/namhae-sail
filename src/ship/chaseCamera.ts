import * as THREE from 'three';
import type { ShipSpec } from './shipSpec';

const FOLLOW_STIFFNESS = 2.5;
const MIN_PITCH = 0.06;
const MAX_PITCH = 1.3;
const SHAKE_DURATION = 0.6;

/** 카메라가 따라가는 대상. 배의 상태를 그대로 넘기거나, 관찰 모드에서는 관찰 지점을 넘긴다. */
export interface CameraTarget {
  x: number;
  z: number;
  heading: number;
}

/** 대상의 뒤쪽을 따라가는 카메라. 드래그로 시점을 돌리고 휠로 거리를 조절한다. */
export class ChaseCamera {
  private followHeading = 0;
  private yawOffset = 0;
  private pitch = 0.28;
  private distance: number;
  private minDistance: number;
  private maxDistance: number;
  private readonly target = new THREE.Vector3();
  private shakeStrength = 0;
  private shakeRemaining = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    private readonly spec: ShipSpec['camera'],
  ) {
    this.distance = spec.distance;
    this.minDistance = spec.minDistance;
    this.maxDistance = spec.maxDistance;

    element.addEventListener('pointerdown', (event) => element.setPointerCapture(event.pointerId));
    element.addEventListener('pointermove', (event) => {
      if (event.buttons === 0) return;
      this.rotateBy(event.movementX, event.movementY);
    });
    element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.distance = THREE.MathUtils.clamp(
          this.distance * Math.exp(event.deltaY * 0.001),
          this.minDistance,
          this.maxDistance,
        );
      },
      { passive: false },
    );
  }

  /** 내려다보는 각도 (rad). 클수록 위에서 내려다본다. */
  get viewPitch(): number {
    return this.pitch;
  }

  /**
   * 화면을 끈 거리만큼 시점을 돌린다. 마우스로 끌 때와 핸드폰으로 끌 때 같은 결과가 된다.
   * - 가로로 1px 끌 때마다 배 둘레를 0.005 rad 돈다 (오른쪽으로 끌면 viewHeading이 커진다)
   * - 세로로 1px 끌 때마다 내려다보는 각도가 0.004 rad 바뀐다 (아래로 끌면 커진다). 0.06~1.3 rad를 넘지 않는다
   * @param dx, dy 끈 거리 (CSS px)
   */
  rotateBy(dx: number, dy: number): void {
    this.yawOffset += dx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, MIN_PITCH, MAX_PITCH);
  }

  /** 카메라가 따라가는 침로를 즉시 맞춘다. 배의 시작 방향이 북쪽이 아닐 때 처음부터 선미 쪽에서 바라보게 한다. */
  alignTo(heading: number): void {
    this.followHeading = heading;
  }

  /** 충돌의 세기(0~1)에 비례해서 카메라를 잠시 흔든다. */
  shake(intensity: number): void {
    this.shakeStrength = Math.max(this.shakeStrength, THREE.MathUtils.clamp(intensity, 0, 1));
    this.shakeRemaining = SHAKE_DURATION;
  }

  /** 카메라가 바라보는 방위 (rad) */
  get viewHeading(): number {
    return this.followHeading + this.yawOffset;
  }

  get viewDistance(): number {
    return this.distance;
  }

  /** 휠로 조절할 수 있는 거리의 범위를 바꾼다. 범위를 지정하지 않으면 선박의 사양에 정해진 범위로 되돌린다. */
  setDistanceRange(min = this.spec.minDistance, max = this.spec.maxDistance): void {
    this.minDistance = min;
    this.maxDistance = max;
    this.distance = THREE.MathUtils.clamp(this.distance, min, max);
  }

  resetView(): void {
    this.yawOffset = 0;
  }

  update(dt: number, ship: CameraTarget): void {
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

    if (this.shakeRemaining > 0) {
      this.shakeRemaining -= dt;
      // 흔들림의 폭은 카메라와 배 사이의 거리에 비례해야 화면에서 같은 크기로 보인다. 시간이 지나면서 빠르게 잦아든다.
      const amplitude =
        this.distance * 0.02 * this.shakeStrength * (Math.max(this.shakeRemaining, 0) / SHAKE_DURATION) ** 2;
      this.camera.position.x += (Math.random() - 0.5) * amplitude;
      this.camera.position.y += (Math.random() - 0.5) * amplitude;
      this.camera.position.z += (Math.random() - 0.5) * amplitude;
      if (this.shakeRemaining <= 0) this.shakeStrength = 0;
    }
    this.camera.lookAt(this.target);
  }
}
