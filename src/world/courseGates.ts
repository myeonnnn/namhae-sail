import * as THREE from 'three';
import type { Course } from '../course/course';

// 아치를 이루는 관의 굵기 (m). 수 km 밖에서도 선으로 보일 만큼 굵게 잡는다.
const TUBE_RADIUS = 2.2;
const NEXT_COLOUR = 0xff8a1f;
const FINISH_COLOUR = 0x3ddc84;
const WAITING_COLOUR = 0xffffff;
// 다음 차례가 아닌 관문은 흐리게 그려서, 지금 향해야 할 관문이 눈에 띄게 한다.
const WAITING_OPACITY = 0.45;
const PASSED_OPACITY = 0.12;

/**
 * 코스의 관문을 수면 위에 세운 아치로 표시한다.
 * 아치는 관문의 폭을 지름으로 하는 반원이어서, 폭 90m의 관문은 높이 45m의 아치가 된다. 멀리에서도 한눈에 보인다.
 */
export class CourseGates {
  private readonly group = new THREE.Group();
  private arches: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private finishIndex = -1;

  constructor(scene: THREE.Scene) {
    this.group.visible = false;
    scene.add(this.group);
  }

  /** 코스의 관문을 세운다. 이전에 세운 것은 치운다. */
  show(course: Course): void {
    this.clear();
    this.finishIndex = course.gates.length - 1;
    for (const gate of course.gates) {
      // 조명과 안개의 영향을 받지 않는 재질을 써서, 해가 낮거나 멀리 있어도 같은 색으로 보이게 한다.
      const material = new THREE.MeshBasicMaterial({ transparent: true, fog: false, toneMapped: false });
      // 고리의 위쪽 절반만 만들면 XY 평면에 서 있는 반원이 된다.
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(course.gateWidth / 2, TUBE_RADIUS, 10, 48, Math.PI),
        material,
      );
      arch.position.set(gate.x, 0, gate.z);
      // 반원이 놓인 방향(X축)을 관문의 선에 맞춘다.
      arch.rotation.y = Math.atan2(-(gate.bz - gate.az), gate.bx - gate.ax);
      this.group.add(arch);
      this.arches.push(arch);
    }
    this.group.visible = true;
    this.setNext(0);
  }

  hide(): void {
    this.clear();
    this.group.visible = false;
  }

  /** 다음에 지나야 하는 관문을 강조한다. 이미 지난 관문은 거의 보이지 않게 한다. */
  setNext(index: number): void {
    this.arches.forEach((arch, i) => {
      const finish = i === this.finishIndex;
      const { material } = arch;
      if (i === index) {
        material.color.setHex(finish ? FINISH_COLOUR : NEXT_COLOUR);
        material.opacity = 1;
      } else {
        material.color.setHex(finish ? FINISH_COLOUR : WAITING_COLOUR);
        material.opacity = i < index ? PASSED_OPACITY : WAITING_OPACITY;
      }
    });
  }

  private clear(): void {
    for (const arch of this.arches) {
      this.group.remove(arch);
      arch.geometry.dispose();
      arch.material.dispose();
    }
    this.arches = [];
  }
}
