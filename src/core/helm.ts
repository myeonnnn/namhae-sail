import type { ShipControls } from '../ship/shipPhysics';
import type { Input } from './input';

/**
 * 배를 조종하는 장치가 한 프레임 동안 내리는 명령.
 * 키보드와 핸드폰처럼 서로 다른 장치가 같은 형식으로 배를 조종하도록, Ship은 이 명령만 받는다.
 */
export interface HelmCommand {
  /** 스로틀 레버를 미는 방향과 세기 (-1~1). 0이면 레버가 지금 위치에 머무른다. */
  throttleRate: number;
  /** true이면 스로틀을 중립에 둔다. */
  neutral: boolean;
  /** 타가 향할 목표 위치 (-1~1). 양수가 우현이다. */
  rudder: number;
}

/** 조종 장치를 따라 레버와 타가 움직이는 빠르기 (ShipSpec의 controls) */
export interface HelmRates {
  /** 스로틀 레버가 움직이는 빠르기 (1/s) */
  throttleRate: number;
  /** 타가 움직이는 빠르기 (1/s) */
  rudderRate: number;
}

/** 컨트롤러가 마지막으로 보낸 명령과, 그 명령을 받은 시각 (초) */
export interface RemoteHelm {
  /** 스로틀 레버를 미는 방향 (-1~1) */
  throttleRate: number;
  /** 타가 향할 목표 위치 (-1~1) */
  rudder: number;
  receivedAt: number;
}

/** 컨트롤러의 메시지가 이보다 오래되면(초) 연결이 끊긴 것으로 보고 키보드를 따른다. */
const REMOTE_TIMEOUT = 0.5;

const HELM_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** 키보드의 상태를 조타 명령으로 바꾼다. */
export function keyboardHelm(input: Input): HelmCommand {
  return {
    throttleRate: input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
    neutral: input.isDown('Space'),
    rudder: input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
  };
}

/** 조종 키를 하나라도 누르고 있으면 true. 이때는 키보드가 컨트롤러보다 우선한다. */
export function isHelmKeyDown(input: Input): boolean {
  return input.isDown(...HELM_KEYS);
}

/**
 * 조타 명령을 따라 dt초 동안 스로틀과 타를 움직인다.
 * - 스로틀을 throttleRate × rates.throttleRate × dt만큼 움직이고 -1~1로 제한한다.
 * - neutral이면 스로틀을 0으로 둔다.
 * - 타는 helm.rudder를 향해 최대 rates.rudderRate × dt만큼 움직인다.
 */
export function applyHelm(controls: ShipControls, helm: HelmCommand, rates: HelmRates, dt: number): void {
  // 스로틀은 레버처럼 놓은 위치에 머무른다. 키보드와 핸드폰이 같은 레버를 같은 빠르기로 민다.
  controls.throttle = clamp(controls.throttle + helm.throttleRate * rates.throttleRate * dt);
  if (helm.neutral) controls.throttle = 0;

  // 타는 장치와 무관하게 같은 빠르기로 움직여서, 핸드폰으로 조종해도 배가 키보드보다 급하게 돌지 않는다.
  controls.rudder = moveToward(controls.rudder, helm.rudder, rates.rudderRate * dt);
}

/**
 * 이번 프레임에 배를 조종할 명령을 고른다.
 * @param keyboard 키보드의 명령
 * @param keyboardActive 조종 키를 하나라도 누르고 있으면 true
 * @param remote 컨트롤러가 마지막으로 보낸 명령. 아직 받은 적이 없으면 undefined
 * @param now 지금 시각 (초). remote.receivedAt과 같은 기준이다
 */
export function chooseHelm(
  keyboard: HelmCommand,
  keyboardActive: boolean,
  remote: RemoteHelm | undefined,
  now: number,
): HelmCommand {
  // 키를 누르는 것은 사람이 지금 직접 개입한다는 뜻이므로, 핸드폰이 연결되어 있어도 키보드를 따른다.
  if (keyboardActive || !remote || now - remote.receivedAt > REMOTE_TIMEOUT) return keyboard;
  // 핸드폰도 키보드처럼 레버를 미는 방향만 보내므로, 두 장치가 같은 레버를 이어서 움직인다.
  // 중립은 누른 횟수로 따로 전해지므로 여기서는 켜지 않는다.
  return { throttleRate: remote.throttleRate, neutral: false, rudder: remote.rudder };
}

/** 컨트롤러와의 연결을 매 물리 단계에 확인한 결과 */
export interface RemoteLinkCheck {
  /** 컨트롤러의 메시지가 0.5초 안에 왔으면 true */
  active: boolean;
  /** 이번 단계에 스로틀을 중립으로 돌려야 하면 true. 메시지가 막 끊겼고 조종 키를 누르고 있지 않을 때이다. */
  neutral: boolean;
}

/**
 * 컨트롤러의 메시지가 끊긴 순간을 알아챈다. 매 물리 단계에 부르고, 결과의 active를 다음 단계의 wasActive로 넘긴다.
 * @param wasActive 직전 단계에서 돌려준 active. 처음에는 false
 * @param keyboardActive 조종 키를 하나라도 누르고 있으면 true
 * @param remote 컨트롤러가 마지막으로 보낸 명령. 아직 받은 적이 없으면 undefined
 * @param now 지금 시각 (초). remote.receivedAt과 같은 기준이다
 */
export function checkRemoteLink(
  wasActive: boolean,
  keyboardActive: boolean,
  remote: RemoteHelm | undefined,
  now: number,
): RemoteLinkCheck {
  const active = remote !== undefined && now - remote.receivedAt <= REMOTE_TIMEOUT;
  // 핸드폰은 레버를 미는 방향만 보내므로, 끊기면 레버가 마지막 값에 머물러 배가 계속 달린다.
  // 그래서 끊긴 순간에 한 번만 중립으로 돌리고, 그 뒤로는 키보드가 레버를 자유롭게 움직이게 둔다.
  // 그 순간에 키를 누르고 있으면 사람이 이미 키보드로 조종하고 있으므로 레버를 건드리지 않는다.
  return { active, neutral: wasActive && !active && !keyboardActive };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}
