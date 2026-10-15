import { describe, expect, it } from 'vitest';
import { decodeHelm, encodeHelm } from './protocol';

describe('컨트롤러의 조종 메시지', () => {
  it('보낸 조종 값을 그대로 읽는다', () => {
    for (const message of [
      { throttle: 0, rudder: 0 },
      { throttle: 1, rudder: -1 },
      { throttle: -1, rudder: 1 },
      { throttle: 0.37, rudder: -0.82 },
    ]) {
      expect(decodeHelm(encodeHelm(message))).toEqual(message);
    }
  });

  it('-1~1을 벗어난 값은 끝값으로 제한해서 읽는다', () => {
    expect(decodeHelm(encodeHelm({ throttle: 2, rudder: -3 }))).toEqual({ throttle: 1, rudder: -1 });
    expect(decodeHelm(encodeHelm({ throttle: -1.0001, rudder: 50 }))).toEqual({ throttle: -1, rudder: 1 });
    expect(decodeHelm(encodeHelm({ throttle: 1.5, rudder: 0.25 }))).toEqual({ throttle: 1, rudder: 0.25 });
  });

  it('값이 유한한 수가 아니면 메시지를 무시한다', () => {
    expect(decodeHelm(encodeHelm({ throttle: Number.NaN, rudder: 0 }))).toBeUndefined();
    expect(decodeHelm(encodeHelm({ throttle: 0, rudder: Number.NaN }))).toBeUndefined();
    expect(decodeHelm(encodeHelm({ throttle: Number.POSITIVE_INFINITY, rudder: 0 }))).toBeUndefined();
    expect(decodeHelm(encodeHelm({ throttle: 0, rudder: Number.NEGATIVE_INFINITY }))).toBeUndefined();
  });

  it('형식이 맞지 않는 문자열은 예외 없이 무시한다', () => {
    for (const text of ['', ' ', 'hello', '{', 'null', '42', '[]', '{}', 'throttle rudder']) {
      expect(() => decodeHelm(text), JSON.stringify(text)).not.toThrow();
      expect(decodeHelm(text), JSON.stringify(text)).toBeUndefined();
    }
  });
});
