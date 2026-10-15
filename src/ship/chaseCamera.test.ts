import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../core/random';
import { ChaseCamera } from './chaseCamera';
import { SPORT_YACHT } from './shipSpec';

/** PC에서 마우스로 끌 때 내려다보는 각도가 머무는 범위 (rad). 핸드폰으로 끌 때도 이 범위를 넘지 않아야 한다. */
const MIN_PITCH = 0.06;
const MAX_PITCH = 1.3;
/** 1px 끌 때 도는 양 (rad) */
const YAW_PER_PX = 0.005;
const PITCH_PER_PX = 0.004;

type Listener = (event: unknown) => void;

/** Node에는 DOM이 없으므로, 카메라가 등록하는 이벤트를 받아 두었다가 직접 보낼 수 있는 대역 */
function fakeElement() {
  const listeners = new Map<string, Listener[]>();
  const element = {
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    setPointerCapture() {},
  };
  const dispatch = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return { element: element as unknown as HTMLElement, dispatch };
}

function makeCamera() {
  const { element, dispatch } = fakeElement();
  const camera = new ChaseCamera(new THREE.PerspectiveCamera(), element, SPORT_YACHT.camera);
  return { camera, dispatch };
}

/** 두 방위의 차이를 -π~π로 구한다. 구현이 방위를 한 바퀴 단위로 감아도 비교할 수 있게 한다. */
function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

describe('끈 거리만큼 시점을 돌린다 (rotateBy)', () => {
  it('오른쪽으로 끌면 배 둘레를 1px에 0.005 rad씩 돌고, 왼쪽으로 끌면 반대로 돈다', () => {
    const { camera } = makeCamera();
    const start = camera.viewHeading;
    camera.rotateBy(100, 0);
    expect(angleDiff(camera.viewHeading, start)).toBeCloseTo(100 * YAW_PER_PX, 9);
    camera.rotateBy(-160, 0);
    expect(angleDiff(camera.viewHeading, start)).toBeCloseTo(-60 * YAW_PER_PX, 9);
  });

  it('아래로 끌면 내려다보는 각도가 1px에 0.004 rad씩 커지고, 위로 끌면 작아진다', () => {
    const { camera } = makeCamera();
    // 시작 각도에 기대지 않도록 먼저 아래쪽 끝까지 올려 둔다
    camera.rotateBy(0, -100000);
    camera.rotateBy(0, 100);
    expect(camera.viewPitch).toBeCloseTo(MIN_PITCH + 100 * PITCH_PER_PX, 9);
    camera.rotateBy(0, -30);
    expect(camera.viewPitch).toBeCloseTo(MIN_PITCH + 70 * PITCH_PER_PX, 9);
  });

  it('가로로 끌면 내려다보는 각도가, 세로로 끌면 방위가 바뀌지 않는다', () => {
    const { camera } = makeCamera();
    const pitch = camera.viewPitch;
    camera.rotateBy(300, 0);
    expect(camera.viewPitch).toBe(pitch);
    const heading = camera.viewHeading;
    camera.rotateBy(0, 20);
    expect(camera.viewHeading).toBe(heading);
  });

  it('끈 거리가 0이면 시점이 움직이지 않는다', () => {
    const { camera } = makeCamera();
    const heading = camera.viewHeading;
    const pitch = camera.viewPitch;
    camera.rotateBy(0, 0);
    expect(camera.viewHeading).toBe(heading);
    expect(camera.viewPitch).toBe(pitch);
  });

  it('내려다보는 각도는 아무리 끌어도 0.06~1.3 rad를 넘지 않는다', () => {
    const { camera } = makeCamera();
    camera.rotateBy(0, 100000);
    expect(camera.viewPitch).toBeCloseTo(MAX_PITCH, 12);
    camera.rotateBy(0, 1);
    expect(camera.viewPitch).toBeLessThanOrEqual(MAX_PITCH);
    camera.rotateBy(0, -100000);
    expect(camera.viewPitch).toBeCloseTo(MIN_PITCH, 12);
    camera.rotateBy(0, -1);
    expect(camera.viewPitch).toBeGreaterThanOrEqual(MIN_PITCH);
  });

  it('끝에 닿은 뒤 반대로 끌면 넘어서 끈 만큼을 되감지 않고 곧바로 움직인다 (PC에서 끌 때와 같다)', () => {
    const { camera } = makeCamera();
    camera.rotateBy(0, 100000);
    camera.rotateBy(0, -50);
    expect(camera.viewPitch).toBeCloseTo(MAX_PITCH - 50 * PITCH_PER_PX, 9);
    camera.rotateBy(0, -100000);
    camera.rotateBy(0, 50);
    expect(camera.viewPitch).toBeCloseTo(MIN_PITCH + 50 * PITCH_PER_PX, 9);
  });

  it('무작위로 이리저리 끌어도 내려다보는 각도는 범위 안에 머문다', () => {
    for (const seed of [1, 7, 42]) {
      const random = seededRandom(seed);
      const { camera } = makeCamera();
      for (let i = 0; i < 2000; i++) {
        camera.rotateBy((random() - 0.5) * 400, (random() - 0.5) * 400);
        expect(camera.viewPitch, `seed ${seed}, ${i}번째`).toBeGreaterThanOrEqual(MIN_PITCH);
        expect(camera.viewPitch, `seed ${seed}, ${i}번째`).toBeLessThanOrEqual(MAX_PITCH);
      }
    }
  });

  it('같은 거리를 마우스로 끌 때와 같은 시점이 된다', () => {
    const random = seededRandom(2024);
    const mouse = makeCamera();
    const phone = makeCamera();
    mouse.dispatch('pointerdown', { pointerId: 1 });
    for (let i = 0; i < 500; i++) {
      // 끝에 닿는 경우도 섞이도록 한 번에 최대 ±150px씩 끈다
      const dx = (random() - 0.5) * 300;
      const dy = (random() - 0.5) * 300;
      mouse.dispatch('pointermove', { buttons: 1, movementX: dx, movementY: dy });
      phone.camera.rotateBy(dx, dy);
      // 같은 수식을 같은 순서로 계산하면 결과가 같다. 덧셈 순서가 달라질 여지만 두어 1e-9 rad까지 허용한다.
      expect(angleDiff(phone.camera.viewHeading, mouse.camera.viewHeading), `${i}번째`).toBeCloseTo(0, 9);
      expect(phone.camera.viewPitch, `${i}번째`).toBeCloseTo(mouse.camera.viewPitch, 9);
    }
  });
});
