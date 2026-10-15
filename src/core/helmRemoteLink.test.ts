import { describe, expect, it } from 'vitest';
import type { ShipControls } from '../ship/shipPhysics';
import {
  applyHelm,
  checkRemoteLink,
  chooseHelm,
  type HelmCommand,
  type HelmRates,
  type RemoteHelm,
  type RemoteLinkCheck,
} from './helm';

// 레버와 타의 빠르기. 실제 배의 값과 무관하게, 손으로 기대값을 셈할 수 있는 값을 쓴다.
const RATES: HelmRates = { throttleRate: 0.8, rudderRate: 0.5 };
/** 물리 단계의 간격. 게임은 이 함수를 1/60초마다 부른다. */
const DT = 1 / 60;
/** 명세의 "0.5초보다 오래 끊기면" */
const TIMEOUT = 0.5;

/** 아무 키도 누르지 않은 키보드의 명령 */
const IDLE_KEYBOARD: HelmCommand = { throttleRate: 0, neutral: false, rudder: 0 };
/** W를 누르고 있는 키보드 */
const HOLD_W: HelmCommand = { throttleRate: 1, neutral: false, rudder: 0 };

function remote(throttleRate: number, rudder: number, receivedAt: number): RemoteHelm {
  return { throttleRate, rudder, receivedAt };
}

/**
 * 게임의 물리 단계를 흉내 낸다. 매 단계에 연결을 확인하고, 그 결과의 active를 다음 단계로 넘기며,
 * neutral이면 고른 명령에 중립을 얹어 배의 레버에 반영한다.
 * 함수의 반환값만이 아니라 배의 스로틀 값으로 결과를 확인하기 위해서다.
 */
class HelmLoop {
  readonly controls: ShipControls;
  /** 지금까지 중립으로 돌린 단계의 시각 */
  readonly neutralTimes: number[] = [];
  /** 컨트롤러가 마지막으로 보낸 메시지. 받은 적이 없으면 undefined */
  remote: RemoteHelm | undefined;
  now: number;
  private wasActive = false;

  constructor(start: ShipControls, now = 10) {
    this.controls = { ...start };
    this.now = now;
  }

  /** 한 단계를 진행한다. message가 있으면 이 단계에 컨트롤러의 메시지가 도착한 것이다. */
  step(
    message?: { throttleRate: number; rudder: number },
    keyboard: HelmCommand = IDLE_KEYBOARD,
    keyboardActive = false,
  ): RemoteLinkCheck {
    this.now += DT;
    if (message) this.remote = remote(message.throttleRate, message.rudder, this.now);
    const link = checkRemoteLink(this.wasActive, keyboardActive, this.remote, this.now);
    this.wasActive = link.active;
    if (link.neutral) this.neutralTimes.push(this.now);
    const helm = chooseHelm(keyboard, keyboardActive, this.remote, this.now);
    applyHelm(this.controls, link.neutral ? { ...helm, neutral: true } : helm, RATES, DT);
    return link;
  }

  /** seconds초 동안 매 단계에 같은 메시지를 받는다. */
  receive(seconds: number, message: { throttleRate: number; rudder: number }): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.step(message);
  }

  /** seconds초 동안 메시지를 받지 않는다. */
  silence(seconds: number, keyboard: HelmCommand = IDLE_KEYBOARD, keyboardActive = false): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.step(undefined, keyboard, keyboardActive);
  }
}

describe('컨트롤러의 연결이 끊겼을 때', () => {
  it('컨트롤러로 스로틀을 올려 둔 채 메시지가 끊기면, 0.5초가 지난 직후 스로틀이 중립(0)으로 돌아간다', () => {
    const loop = new HelmLoop({ throttle: 0, rudder: 0 });
    // 올림 버튼을 0.75초 누른다: 0.8/s × 0.75s = 0.6
    loop.receive(0.75, { throttleRate: 1, rudder: 0 });
    // 버튼을 뗀 메시지를 잠시 받는다. 스로틀은 0.6에 머문다.
    loop.receive(0.25, { throttleRate: 0, rudder: 0 });
    expect(loop.controls.throttle).toBeCloseTo(0.6, 12);
    const lastReceived = loop.remote!.receivedAt;

    loop.silence(2);
    expect(loop.controls.throttle).toBe(0);
    expect(loop.neutralTimes).toHaveLength(1);
    // 끊긴 것으로 보는 첫 단계에 돌린다. 0.5초보다 앞서지 않고, 0.5초를 넘긴 뒤 한 단계 안에 돌린다.
    // 단계의 시각은 1/60을 더해 가며 셈하므로 반올림 오차를 1e-9만큼 허용한다.
    const elapsed = loop.neutralTimes[0] - lastReceived;
    expect(elapsed).toBeGreaterThan(TIMEOUT);
    expect(elapsed).toBeLessThanOrEqual(TIMEOUT + DT + 1e-9);
  });

  it('후진으로 둔 스로틀도 끊기면 중립으로 돌아간다', () => {
    const loop = new HelmLoop({ throttle: -0.7, rudder: 0 });
    loop.receive(0.5, { throttleRate: 0, rudder: 0 });
    expect(loop.controls.throttle).toBe(-0.7);
    loop.silence(1);
    expect(loop.controls.throttle).toBe(0);
    expect(loop.neutralTimes).toHaveLength(1);
  });

  it('끊기기 전 0.5초 동안은 중립으로 돌리지 않는다', () => {
    const loop = new HelmLoop({ throttle: 0.4, rudder: 0 });
    loop.receive(0.5, { throttleRate: 0, rudder: 0 });
    // 0.4초 동안 메시지가 오지 않아도 아직 끊긴 것이 아니다.
    loop.silence(0.4);
    expect(loop.neutralTimes).toHaveLength(0);
    expect(loop.controls.throttle).toBe(0.4);
  });

  it('올림 버튼을 누른 채 끊겨도, 중립으로 돌린 뒤에는 그 마지막 명령이 레버를 다시 밀지 않는다', () => {
    const loop = new HelmLoop({ throttle: 0, rudder: 0 });
    loop.receive(0.5, { throttleRate: 1, rudder: 0 });
    loop.silence(2);
    // 끊긴 뒤에는 아무 키도 누르지 않은 키보드를 따르므로 레버는 0에 머문다.
    expect(loop.controls.throttle).toBe(0);
    expect(loop.neutralTimes).toHaveLength(1);
  });

  it('중립으로 돌리는 것은 끊긴 순간의 한 번뿐이고, 그 뒤로는 키보드로 스로틀을 올릴 수 있다', () => {
    const loop = new HelmLoop({ throttle: 0.5, rudder: 0 });
    loop.receive(0.5, { throttleRate: 0, rudder: 0 });
    loop.silence(1);
    expect(loop.controls.throttle).toBe(0);
    expect(loop.neutralTimes).toHaveLength(1);

    // 계속 끊긴 채로 W를 0.5초 누른다: 0.8/s × 0.5s = 0.4. 중간에 다시 중립으로 돌아가지 않는다.
    loop.silence(0.5, HOLD_W, true);
    expect(loop.controls.throttle).toBeCloseTo(0.4, 12);
    // 키를 놓은 뒤에도 그 값에 머문다.
    loop.silence(2);
    expect(loop.controls.throttle).toBeCloseTo(0.4, 12);
    expect(loop.neutralTimes).toHaveLength(1);
  });

  it('끊긴 순간에 조종 키를 누르고 있으면 중립으로 돌리지 않고 키보드를 따른다', () => {
    const loop = new HelmLoop({ throttle: 0.2, rudder: 0 });
    loop.receive(0.5, { throttleRate: 0, rudder: 0 });
    // 메시지가 끊긴 채로 W를 1초 누른다. 끊기기 전에도 뒤에도 키보드를 따른다: 0.2 + 0.8 × 1 = 1.0
    loop.silence(1, HOLD_W, true);
    expect(loop.neutralTimes).toHaveLength(0);
    expect(loop.controls.throttle).toBeCloseTo(1, 12);
  });

  it('끊긴 순간에 조종 키를 누르고 있었다면, 나중에 키를 놓아도 중립으로 돌리지 않는다', () => {
    const loop = new HelmLoop({ throttle: 0.2, rudder: 0 });
    loop.receive(0.5, { throttleRate: 0, rudder: 0 });
    // 타만 돌리는 키(D)를 1초 누른다. 끊긴 순간(0.5초 뒤)에도 누르고 있다. 스로틀은 0.2에 머문다.
    loop.silence(1, { throttleRate: 0, neutral: false, rudder: 1 }, true);
    // 키를 놓아도 끊긴 순간은 이미 지났으므로 레버는 그대로다.
    loop.silence(2);
    expect(loop.neutralTimes).toHaveLength(0);
    expect(loop.controls.throttle).toBe(0.2);
  });

  it('조종 키를 누르다가 끊기기 전에 놓았으면, 끊긴 순간에 중립으로 돌린다', () => {
    const loop = new HelmLoop({ throttle: 0.3, rudder: 0 });
    loop.receive(0.5, { throttleRate: 0, rudder: 0 });
    // 메시지가 끊긴 직후 0.25초 동안만 키를 누른다. 0.5초가 지나기 전에 놓는다.
    loop.silence(0.25, { throttleRate: 0, neutral: false, rudder: -1 }, true);
    loop.silence(1);
    expect(loop.neutralTimes).toHaveLength(1);
    expect(loop.controls.throttle).toBe(0);
  });

  it('메시지를 한 번도 받은 적이 없으면 중립으로 돌리지 않는다', () => {
    const loop = new HelmLoop({ throttle: 0.6, rudder: 0 });
    loop.silence(3);
    expect(loop.neutralTimes).toHaveLength(0);
    expect(loop.controls.throttle).toBe(0.6);

    // 키보드로 조종하는 것도 평소와 같다: 0.6 + 0.8 × 0.25 = 0.8
    loop.silence(0.25, HOLD_W, true);
    expect(loop.neutralTimes).toHaveLength(0);
    expect(loop.controls.throttle).toBeCloseTo(0.8, 12);
  });

  it('메시지를 한 번도 받은 적이 없으면 연결을 확인한 결과가 매번 비활성이고 중립이 아니다', () => {
    let wasActive = false;
    for (const now of [0, 0.5, 1, 100]) {
      for (const keyboardActive of [false, true]) {
        const link = checkRemoteLink(wasActive, keyboardActive, undefined, now);
        expect(link).toEqual({ active: false, neutral: false });
        wasActive = link.active;
      }
    }
  });

  it('이미 오래된 메시지만 있고 받고 있던 적이 없으면(처음 확인부터 끊겨 있으면) 중립으로 돌리지 않는다', () => {
    expect(checkRemoteLink(false, false, remote(1, 0, 10), 20)).toEqual({ active: false, neutral: false });
  });

  it('다시 메시지가 오면 컨트롤러를 따르고, 다시 끊기면 다시 한 번 중립으로 돌린다', () => {
    const loop = new HelmLoop({ throttle: 0, rudder: 0 });
    // 첫 연결: 올림 버튼으로 0.4까지 올렸다가 끊긴다.
    loop.receive(0.5, { throttleRate: 1, rudder: 0 });
    loop.silence(1);
    expect(loop.controls.throttle).toBe(0);
    expect(loop.neutralTimes).toHaveLength(1);

    // 다시 연결: 컨트롤러를 따라 올라간다. 0.8/s × 0.75s = 0.6
    loop.receive(0.75, { throttleRate: 1, rudder: 0 });
    expect(loop.controls.throttle).toBeCloseTo(0.6, 12);
    expect(loop.neutralTimes).toHaveLength(1);

    // 다시 끊기면 다시 한 번 중립으로 돌린다.
    loop.silence(2);
    expect(loop.controls.throttle).toBe(0);
    expect(loop.neutralTimes).toHaveLength(2);
  });

  it('여러 번 끊겼다 이어져도 끊길 때마다 정확히 한 번씩 중립으로 돌린다', () => {
    const loop = new HelmLoop({ throttle: 0, rudder: 0 });
    for (let k = 1; k <= 4; k++) {
      loop.receive(0.5, { throttleRate: 1, rudder: 0 });
      expect(loop.controls.throttle).toBeGreaterThan(0);
      loop.silence(1.5);
      expect(loop.controls.throttle).toBe(0);
      expect(loop.neutralTimes).toHaveLength(k);
    }
  });

  it('0.5초보다 짧게 끊겼다가 다시 오면 중립으로 돌리지 않고 컨트롤러를 이어서 따른다', () => {
    const loop = new HelmLoop({ throttle: 0, rudder: 0 });
    loop.receive(0.5, { throttleRate: 1, rudder: 0 });
    for (let k = 0; k < 5; k++) {
      // 0.3초씩 끊긴다. 그동안은 마지막 명령(올림)을 계속 따른다.
      loop.silence(0.3);
      loop.receive(0.1, { throttleRate: 0, rudder: 0 });
    }
    expect(loop.neutralTimes).toHaveLength(0);
    // 0.5초 + 첫 0.3초 동안 올림을 따른다: 0.8 × 0.8 = 0.64. 그 뒤는 버튼을 뗀 메시지라 머무른다.
    expect(loop.controls.throttle).toBeCloseTo(0.64, 9);
  });
});

describe('연결 확인의 경계', () => {
  it('마지막 메시지에서 정확히 0.5초는 아직 끊긴 것이 아니고, 그보다 오래되면 끊긴 것이다', () => {
    // 10과 10.5는 2진수로 정확히 나타나므로 차이가 정확히 0.5다.
    expect(checkRemoteLink(true, false, remote(0, 0, 10), 10.5)).toEqual({ active: true, neutral: false });
    expect(checkRemoteLink(true, false, remote(0, 0, 10), 10.5001)).toEqual({ active: false, neutral: true });
  });

  it('메시지를 받고 있으면 활성이고, 중립으로 돌리지 않는다', () => {
    expect(checkRemoteLink(false, false, remote(0, 0, 10), 10)).toEqual({ active: true, neutral: false });
    expect(checkRemoteLink(true, false, remote(1, 0, 10), 10.25)).toEqual({ active: true, neutral: false });
  });

  it('조종 키를 누르고 있어도 메시지를 받고 있으면 활성이다', () => {
    // 키보드가 우선하는 것은 chooseHelm의 일이고, 연결이 살아 있는지는 메시지의 시각만으로 정한다.
    expect(checkRemoteLink(true, true, remote(0, 0, 10), 10.25)).toEqual({ active: true, neutral: false });
  });

  it('끊긴 순간에 조종 키를 누르고 있으면 비활성이 되지만 중립은 아니다', () => {
    expect(checkRemoteLink(true, true, remote(0, 0, 10), 11)).toEqual({ active: false, neutral: false });
  });

  it('이미 끊긴 것을 알아챈 뒤에는 다시 중립으로 돌리지 않는다', () => {
    expect(checkRemoteLink(false, false, remote(0, 0, 10), 11)).toEqual({ active: false, neutral: false });
    expect(checkRemoteLink(false, false, remote(0, 0, 10), 1000)).toEqual({ active: false, neutral: false });
  });
});
