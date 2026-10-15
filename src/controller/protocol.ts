/** 컨트롤러가 게임에 보내는 조종 값 */
export interface HelmMessage {
  /** -1(후진 전속) ~ 1(전진 전속) */
  throttle: number;
  /** -1(좌현) ~ 1(우현) */
  rudder: number;
}

/** 같은 PC의 탭끼리 조종 값을 주고받는 BroadcastChannel의 이름. 핸드폰과 연결하는 WebRTC가 생기기 전까지 쓴다. */
export const HELM_CHANNEL = 'namhae-sail-helm';

/** 같은 채널에 다른 종류의 메시지가 생겨도 조종 메시지와 구별할 수 있도록 붙이는 표지 */
const HELM_TYPE = 'helm';

/** 조종 값을 전송할 문자열로 바꾼다. */
export function encodeHelm(message: HelmMessage): string {
  // JSON은 NaN과 Infinity를 null로 적으므로, 받는 쪽에서 유한한 수가 아니라고 판정되어 무시된다.
  return JSON.stringify({ type: HELM_TYPE, throttle: message.throttle, rudder: message.rudder });
}

/**
 * 받은 문자열을 조종 값으로 읽는다. 값은 -1~1로 제한한다.
 * 형식이 맞지 않으면(조종 메시지가 아니거나, 값이 없거나 유한한 수가 아니면) undefined를 돌려준다.
 */
export function decodeHelm(text: string): HelmMessage | undefined {
  // 메시지는 네트워크 너머에서 오므로, 깨진 문자열 때문에 게임의 프레임이 예외로 멈추면 안 된다.
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const { type, throttle, rudder } = data as Record<string, unknown>;
  if (type !== HELM_TYPE || !isFiniteNumber(throttle) || !isFiniteNumber(rudder)) return undefined;
  return { throttle: clamp(throttle), rudder: clamp(rudder) };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
