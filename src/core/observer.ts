import type { Input } from './input';

/**
 * 관찰 모드: 카메라를 배에서 떼어 내서 구역의 어디든 자유롭게 둘러본다.
 * 카메라가 바라보는 수면 위의 한 점(x, z)을 키보드로 옮기고, 카메라는 그 점의 주위를 돈다.
 */
export class Observer {
  active = false;
  x = 0;
  z = 0;
  /** 관찰 모드에 들어온 순간의 배의 방위. 들어올 때 시점이 튀지 않도록 카메라의 기준 방위로 사용한다. */
  heading = 0;

  enter(x: number, z: number, heading: number): void {
    this.active = true;
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  exit(): void {
    this.active = false;
  }

  /**
   * @param viewHeading 카메라가 바라보는 방위 (rad). 이 방향이 "앞"이 된다.
   * @param distance 카메라와 관찰 지점 사이의 거리 (m). 멀리서 볼수록 빠르게 움직인다.
   */
  update(frameTime: number, input: Input, viewHeading: number, distance: number): void {
    const forward = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const strafe = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    if (forward === 0 && strafe === 0) return;

    const boost = input.isDown('ShiftLeft', 'ShiftRight') ? 4 : 1;
    const step = Math.max(40, distance * 1.2) * boost * frameTime;
    const sin = Math.sin(viewHeading);
    const cos = Math.cos(viewHeading);
    this.x += (forward * sin + strafe * cos) * step;
    this.z += (-forward * cos + strafe * sin) * step;
  }
}
