import * as THREE from 'three';

const PARTICLE_COUNT = 160;
const LIFETIME = 1.4;
const GRAVITY = 9.81;

/**
 * 충돌한 지점에서 튀어 오르는 물보라.
 * 점들을 위쪽과 바깥쪽으로 흩뿌린 다음에 중력으로 떨어뜨리고, 수명이 끝나면 숨긴다.
 */
export class ImpactSpray {
  private readonly positions = new Float32Array(PARTICLE_COUNT * 3);
  private readonly velocities = new Float32Array(PARTICLE_COUNT * 3);
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private age = Infinity;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xf2f8fb,
        transparent: true,
        // 물방울이 서로 가리지 않도록 깊이를 기록하지 않는다.
        depthWrite: false,
        sizeAttenuation: true,
        // 장면의 노출 설정이 적용되면 흰 물방울이 회색으로 어두워지므로 제외한다.
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /**
   * @param intensity 0~1 범위의 충돌 세기
   * @param scale 선체의 크기에 맞추는 배율 (m). 물보라가 퍼지는 범위와 물방울의 크기를 정한다.
   */
  burst(x: number, y: number, z: number, intensity: number, scale: number): void {
    const speed = (4 + 10 * intensity) * Math.sqrt(scale);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const outward = Math.random() * speed * 0.6;
      this.positions.set([x + (Math.random() - 0.5) * scale, y, z + (Math.random() - 0.5) * scale], i * 3);
      this.velocities.set(
        [Math.cos(angle) * outward, speed * (0.4 + Math.random() * 0.6), Math.sin(angle) * outward],
        i * 3,
      );
    }
    this.points.material.size = 0.14 * scale;
    this.points.visible = true;
    this.age = 0;
  }

  update(frameTime: number): void {
    if (this.age >= LIFETIME) {
      this.points.visible = false;
      return;
    }
    this.age += frameTime;
    for (let i = 0; i < PARTICLE_COUNT * 3; i += 3) {
      this.velocities[i + 1] -= GRAVITY * frameTime;
      this.positions[i] += this.velocities[i] * frameTime;
      this.positions[i + 1] += this.velocities[i + 1] * frameTime;
      this.positions[i + 2] += this.velocities[i + 2] * frameTime;
    }
    this.points.geometry.attributes['position'].needsUpdate = true;
    this.points.material.opacity = 0.9 * (1 - this.age / LIFETIME);
  }
}
