/** 컨트롤러가 게임에 보내는 조종 값 */
export interface HelmMessage {
  /** 스로틀 레버를 미는 방향 (-1~1). 올림 버튼을 누르고 있으면 1, 내림 버튼이면 -1, 둘 다 떼면 0이다. */
  throttleRate: number;
  /** 타가 향할 목표 위치. -1(좌현) ~ 1(우현) */
  rudder: number;
  /** 컨트롤러를 연 뒤로 중립 버튼을 누른 횟수 (0 이상의 정수) */
  neutralCount: number;
  /** 컨트롤러를 연 뒤로 복구 버튼을 누른 횟수 (0 이상의 정수) */
  resetCount: number;
}

/** 게임이 컨트롤러에 알려 주는 배의 상태 */
export interface ShipStatusMessage {
  /** 배의 스로틀. -1(후진 전속) ~ 1(전진 전속) */
  throttle: number;
  /** 배가 전복되었으면 true */
  capsized: boolean;
}

/** 같은 PC의 탭끼리 조종 값을 주고받는 BroadcastChannel의 이름. 핸드폰과 연결하는 WebRTC가 생기기 전까지 쓴다. */
export const HELM_CHANNEL = 'namhae-sail-helm';

/** 조종 메시지와 배의 상태 메시지는 같은 통로로 오가므로, 종류를 구별하는 표지를 붙인다. */
const HELM_TYPE = 'helm';
const STATUS_TYPE = 'status';

/** 조종 값을 전송할 문자열로 바꾼다. */
export function encodeHelm(message: HelmMessage): string {
  const { throttleRate, rudder, neutralCount, resetCount } = message;
  // JSON은 NaN과 Infinity를 null로 적으므로, 받는 쪽에서 유한한 수가 아니라고 판정되어 무시된다.
  return JSON.stringify({ type: HELM_TYPE, throttleRate, rudder, neutralCount, resetCount });
}

/**
 * 받은 문자열을 조종 값으로 읽는다. throttleRate와 rudder는 -1~1로 제한한다.
 * 형식이 맞지 않으면(조종 메시지가 아니거나, 값이 없거나, throttleRate와 rudder가 유한한 수가 아니거나,
 * 누른 횟수가 0 이상의 정수가 아니면) undefined를 돌려준다.
 */
export function decodeHelm(text: string): HelmMessage | undefined {
  const data = parseObject(text);
  if (data?.type !== HELM_TYPE) return undefined;
  const { throttleRate, rudder, neutralCount, resetCount } = data;
  if (!isFiniteNumber(throttleRate) || !isFiniteNumber(rudder)) return undefined;
  if (!isCount(neutralCount) || !isCount(resetCount)) return undefined;
  return { throttleRate: clamp(throttleRate), rudder: clamp(rudder), neutralCount, resetCount };
}

/** 배의 상태를 전송할 문자열로 바꾼다. */
export function encodeShipStatus(message: ShipStatusMessage): string {
  return JSON.stringify({ type: STATUS_TYPE, throttle: message.throttle, capsized: message.capsized });
}

/**
 * 받은 문자열을 배의 상태로 읽는다. throttle은 -1~1로 제한한다.
 * 형식이 맞지 않으면(배의 상태 메시지가 아니거나, 값이 없거나, throttle이 유한한 수가 아니거나, capsized가 참거짓이 아니면)
 * undefined를 돌려준다. 조종 메시지를 넣어도 undefined이다.
 */
export function decodeShipStatus(text: string): ShipStatusMessage | undefined {
  const data = parseObject(text);
  if (data?.type !== STATUS_TYPE) return undefined;
  const { throttle, capsized } = data;
  if (!isFiniteNumber(throttle) || typeof capsized !== 'boolean') return undefined;
  return { throttle: clamp(throttle), capsized };
}

/**
 * 버튼을 누른 횟수가 바뀌었을 때, 새로 누른 것이 있는지 판단한다.
 * 연결은 메시지를 다시 보내지 않으므로, 누른 순간을 보내지 않고 누적 횟수를 계속 보낸다.
 * 그러면 메시지를 몇 개 잃어도 다음 메시지에서 늘어난 횟수로 알 수 있다.
 * @param previous 직전 메시지의 횟수. 이 컨트롤러에서 처음 받은 메시지이면 undefined
 * @param current 이번 메시지의 횟수
 * @returns 새로 누른 것이 있으면 true. 처음 받은 메시지이거나, 컨트롤러를 새로 열어서 횟수가 줄었으면 false
 */
export function isNewPress(previous: number | undefined, current: number): boolean {
  return previous !== undefined && current > previous;
}

/** 메시지는 네트워크 너머에서 오므로, 깨진 문자열 때문에 게임의 프레임이 예외로 멈추면 안 된다. */
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
