import { describe, expect, it } from 'vitest';
import type { ShipControls } from '../ship/shipPhysics';
import { applyHelm, chooseHelm, isHelmKeyDown, type HelmCommand, type HelmRates, type RemoteHelm } from './helm';
import type { Input } from './input';

// 레버와 타의 빠르기. 실제 배의 값과 무관하게, 손으로 기대값을 셈할 수 있는 값을 쓴다.
const RATES: HelmRates = { throttleRate: 0.8, rudderRate: 0.5 };
const DT = 1 / 60;

/** 아무 키도 누르지 않은 키보드의 명령 */
const IDLE_KEYBOARD: HelmCommand = { throttleRate: 0, neutral: false, rudder: 0 };

function controls(throttle = 0, rudder = 0): ShipControls {
  return { throttle, rudder };
}

/** 컨트롤러 명령을 고른 뒤 한 번 반영한 결과. 고른 명령의 내부 형식이 아니라 배에 미치는 결과로 확인한다. */
function applyChosen(
  start: ShipControls,
  keyboard: HelmCommand,
  keyboardActive: boolean,
  remote: RemoteHelm | undefined,
  now: number,
  dt = DT,
): ShipControls {
  const result = { ...start };
  applyHelm(result, chooseHelm(keyboard, keyboardActive, remote, now), RATES, dt);
  return result;
}

describe('조타 명령의 반영', () => {
  it('스로틀 값이 주어지면 배의 스로틀은 서서히가 아니라 바로 그 값이 된다', () => {
    for (const throttle of [1, -1, 0, 0.35, -0.6]) {
      const c = controls(0.2, 0);
      applyHelm(c, { throttleRate: 0, neutral: false, rudder: 0, throttle }, RATES, DT);
      expect(c.throttle).toBe(throttle);
    }
  });

  it('주어진 스로틀 값이 -1~1을 벗어나면 끝값으로 제한한다', () => {
    const forward = controls();
    applyHelm(forward, { throttleRate: 0, neutral: false, rudder: 0, throttle: 3 }, RATES, DT);
    expect(forward.throttle).toBe(1);
    const reverse = controls();
    applyHelm(reverse, { throttleRate: 0, neutral: false, rudder: 0, throttle: -2.5 }, RATES, DT);
    expect(reverse.throttle).toBe(-1);
  });

  it('스로틀 값이 없으면 키보드처럼 레버의 빠르기만큼 서서히 움직이고 -1~1에 머문다', () => {
    const c = controls(0, 0);
    applyHelm(c, { throttleRate: 1, neutral: false, rudder: 0 }, RATES, 0.1);
    // 0.8/s × 0.1s = 0.08
    expect(c.throttle).toBeCloseTo(0.08, 12);

    const back = controls(0.5, 0);
    applyHelm(back, { throttleRate: -1, neutral: false, rudder: 0 }, RATES, 0.25);
    // 0.5 - 0.8 × 0.25 = 0.3
    expect(back.throttle).toBeCloseTo(0.3, 12);

    const nearFull = controls(0.99, 0);
    applyHelm(nearFull, { throttleRate: 1, neutral: false, rudder: 0 }, RATES, 1);
    expect(nearFull.throttle).toBe(1);

    const hold = controls(0.42, 0);
    applyHelm(hold, IDLE_KEYBOARD, RATES, 1);
    expect(hold.throttle).toBe(0.42);
  });

  it('중립 명령이면 스로틀을 0에 둔다', () => {
    const c = controls(0.7, 0);
    applyHelm(c, { throttleRate: 1, neutral: true, rudder: 0 }, RATES, DT);
    expect(c.throttle).toBe(0);
  });

  it('타는 목표 위치를 향해 한 번에 rudderRate × dt만큼만 움직인다', () => {
    const c = controls(0, 0);
    applyHelm(c, { throttleRate: 0, neutral: false, rudder: 1 }, RATES, 0.2);
    // 0.5/s × 0.2s = 0.1
    expect(c.rudder).toBeCloseTo(0.1, 12);

    const left = controls(0, 0.3);
    applyHelm(left, { throttleRate: 0, neutral: false, rudder: -1 }, RATES, 0.2);
    expect(left.rudder).toBeCloseTo(0.2, 12);
  });

  it('타는 목표 위치를 지나치지 않고 그 위치에 멈춘다', () => {
    const c = controls(0, 0.28);
    applyHelm(c, { throttleRate: 0, neutral: false, rudder: 0.3 }, RATES, 0.2);
    expect(c.rudder).toBe(0.3);
    // 이미 목표에 있으면 움직이지 않는다.
    applyHelm(c, { throttleRate: 0, neutral: false, rudder: 0.3 }, RATES, 0.2);
    expect(c.rudder).toBe(0.3);
  });

  it('dt가 0이면 서서히 움직이는 레버와 타는 그대로 있다', () => {
    const c = controls(0.4, -0.2);
    applyHelm(c, { throttleRate: 1, neutral: false, rudder: 1 }, RATES, 0);
    expect(c.throttle).toBe(0.4);
    expect(c.rudder).toBe(-0.2);
  });
});

describe('조종 장치의 선택', () => {
  const remote = (throttle: number, rudder: number, receivedAt: number): RemoteHelm => ({
    throttle,
    rudder,
    receivedAt,
  });

  it('컨트롤러의 명령이 새로우면 배의 스로틀은 바로 컨트롤러의 값이 된다', () => {
    for (const throttle of [1, -1, 0, 0.55]) {
      const result = applyChosen(controls(0.2, 0), IDLE_KEYBOARD, false, remote(throttle, 0, 10), 10.1);
      expect(result.throttle).toBe(throttle);
    }
  });

  it('컨트롤러로 조종해도 타는 키보드와 같은 빠르기로 목표를 향해 움직인다', () => {
    const byRemote = applyChosen(controls(), IDLE_KEYBOARD, false, remote(0, 1, 10), 10.1, 0.2);
    const byKeyboard = controls();
    applyHelm(byKeyboard, { throttleRate: 0, neutral: false, rudder: 1 }, RATES, 0.2);
    // 0.5/s × 0.2s = 0.1. 컨트롤러라고 해서 타가 한 번에 끝까지 가지 않는다.
    expect(byRemote.rudder).toBeCloseTo(0.1, 12);
    expect(byRemote.rudder).toBe(byKeyboard.rudder);

    // 슬라이더의 중간 위치를 목표로 삼고, 그 위치에 이르면 멈춘다.
    let c = controls();
    for (let i = 0; i < 120; i++) c = applyChosen(c, IDLE_KEYBOARD, false, remote(0, -0.4, 10), 10.1);
    expect(c.rudder).toBe(-0.4);
  });

  it('컨트롤러의 스로틀이 0이면 배의 스로틀은 중립이 된다', () => {
    const result = applyChosen(controls(0.9, 0), IDLE_KEYBOARD, false, remote(0, 0, 10), 10.1);
    expect(result.throttle).toBe(0);
  });

  it('조종 키를 누르고 있으면 컨트롤러의 명령이 새로워도 키보드를 따른다', () => {
    const keyboard: HelmCommand = { throttleRate: 1, neutral: false, rudder: -1 };
    const chosen = chooseHelm(keyboard, true, remote(-1, 1, 10), 10.1);
    expect(chosen).toEqual(keyboard);

    const result = applyChosen(controls(0, 0), keyboard, true, remote(-1, 1, 10), 10.1, 0.1);
    // 키보드: 스로틀 0 + 0.8 × 0.1 = 0.08, 타 0 - 0.5 × 0.1 = -0.05
    expect(result.throttle).toBeCloseTo(0.08, 12);
    expect(result.rudder).toBeCloseTo(-0.05, 12);
  });

  it('스페이스(중립)만 누르고 있어도 키보드가 우선한다', () => {
    const keyboard: HelmCommand = { throttleRate: 0, neutral: true, rudder: 0 };
    const result = applyChosen(controls(0.5, 0), keyboard, true, remote(1, 0, 10), 10.1);
    expect(result.throttle).toBe(0);
  });

  it('컨트롤러의 마지막 메시지가 0.5초보다 오래되었으면 키보드를 따른다', () => {
    const chosen = chooseHelm(IDLE_KEYBOARD, false, remote(1, 1, 10), 10.6);
    expect(chosen).toEqual(IDLE_KEYBOARD);

    // 키를 누르지 않은 키보드를 따르므로 스로틀은 놓인 위치에 머물고, 타는 가운데로 돌아간다.
    const result = applyChosen(controls(0.3, 0.5), IDLE_KEYBOARD, false, remote(1, 1, 10), 70, 0.2);
    expect(result.throttle).toBe(0.3);
    expect(result.rudder).toBeCloseTo(0.4, 12);
  });

  it('마지막 메시지가 0.5초 안이면 컨트롤러를 따르고, 정확히 0.5초는 아직 오래된 것이 아니다', () => {
    // 10과 10.5는 2진수로 정확히 나타나므로 차이가 정확히 0.5다.
    for (const now of [10, 10.25, 10.5]) {
      const result = applyChosen(controls(0, 0), IDLE_KEYBOARD, false, remote(-0.7, 0, 10), now);
      expect(result.throttle).toBe(-0.7);
    }
    const stale = applyChosen(controls(0, 0), IDLE_KEYBOARD, false, remote(-0.7, 0, 10), 10.5001);
    expect(stale.throttle).toBe(0);
  });

  it('컨트롤러의 메시지를 받은 적이 없으면 키보드를 따른다', () => {
    const keyboard: HelmCommand = { throttleRate: -1, neutral: false, rudder: 1 };
    expect(chooseHelm(keyboard, false, undefined, 0)).toEqual(keyboard);
    expect(chooseHelm(keyboard, true, undefined, 100)).toEqual(keyboard);
  });
});

describe('조종 키의 판정', () => {
  /** 주어진 키만 눌린 키보드. Input은 window에 묶여 있어서, isDown만 가진 대역을 쓴다. */
  function pressed(...codes: string[]): Input {
    const keys = new Set(codes);
    return { isDown: (...query: string[]) => query.some((code) => keys.has(code)) } as unknown as Input;
  }

  it('W, S, A, D, Space, 방향키 중 하나라도 누르고 있으면 조종 중이다', () => {
    for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(isHelmKeyDown(pressed(code)), code).toBe(true);
    }
  });

  it('조종 키가 아닌 키만 누르고 있으면 조종 중이 아니다', () => {
    expect(isHelmKeyDown(pressed())).toBe(false);
    expect(isHelmKeyDown(pressed('KeyR', 'KeyM', 'Enter', 'ShiftLeft'))).toBe(false);
  });
});
