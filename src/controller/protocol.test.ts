import { describe, expect, it } from 'vitest';
import { seededRandom } from '../core/random';
import {
  decodeHelm,
  decodeShipStatus,
  encodeHelm,
  encodeShipStatus,
  isNewPress,
  type HelmMessage,
  type ShipStatusMessage,
} from './protocol';

/** 형식과 무관하게 어느 메시지로도 읽힐 수 없는 문자열 */
const MALFORMED = ['', ' ', 'hello', '{', 'null', '42', '[]', '{}', 'true', '"helm"', 'throttle rudder'];

function helm(throttleRate: number, rudder: number, neutralCount = 0, resetCount = 0): HelmMessage {
  return { throttleRate, rudder, neutralCount, resetCount };
}

describe('컨트롤러의 조종 메시지', () => {
  it('보낸 조종 값과 누른 횟수를 그대로 읽는다', () => {
    for (const message of [
      helm(0, 0, 0, 0),
      helm(1, -1, 3, 0),
      helm(-1, 1, 0, 7),
      helm(0, 0.37, 12, 5),
      helm(0, -0.82, 1000, 999),
    ]) {
      expect(decodeHelm(encodeHelm(message))).toEqual(message);
    }
  });

  it('-1~1을 벗어난 값은 끝값으로 제한해서 읽고, 누른 횟수는 그대로 둔다', () => {
    expect(decodeHelm(encodeHelm(helm(2, -3, 4, 1)))).toEqual(helm(1, -1, 4, 1));
    expect(decodeHelm(encodeHelm(helm(-1.0001, 50)))).toEqual(helm(-1, 1));
    expect(decodeHelm(encodeHelm(helm(1.5, 0.25, 0, 2)))).toEqual(helm(1, 0.25, 0, 2));
  });

  it('스로틀 버튼의 값이나 타의 위치가 유한한 수가 아니면 메시지를 무시한다', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(decodeHelm(encodeHelm(helm(bad, 0))), `throttleRate ${bad}`).toBeUndefined();
      expect(decodeHelm(encodeHelm(helm(0, bad))), `rudder ${bad}`).toBeUndefined();
    }
  });

  it('누른 횟수가 0 이상의 정수가 아니면 메시지를 무시한다', () => {
    for (const bad of [-1, -5, 0.5, 2.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decodeHelm(encodeHelm(helm(0, 0, bad, 0))), `neutralCount ${bad}`).toBeUndefined();
      expect(decodeHelm(encodeHelm(helm(0, 0, 0, bad))), `resetCount ${bad}`).toBeUndefined();
    }
  });

  it('형식이 맞지 않는 문자열은 예외 없이 무시한다', () => {
    for (const text of MALFORMED) {
      expect(() => decodeHelm(text), JSON.stringify(text)).not.toThrow();
      expect(decodeHelm(text), JSON.stringify(text)).toBeUndefined();
    }
  });

  it('배의 상태 메시지는 조종 메시지로 읽지 않는다', () => {
    for (const status of [
      { throttle: 0, capsized: false },
      { throttle: 1, capsized: true },
      { throttle: -0.5, capsized: false },
    ]) {
      expect(decodeHelm(encodeShipStatus(status))).toBeUndefined();
    }
  });
});

describe('게임이 알려 주는 배의 상태', () => {
  it('보낸 스로틀 값과 전복 여부를 그대로 읽는다', () => {
    for (const message of [
      { throttle: 0, capsized: false },
      { throttle: 1, capsized: false },
      { throttle: -1, capsized: true },
      { throttle: 0.37, capsized: true },
      { throttle: -0.82, capsized: false },
    ] satisfies ShipStatusMessage[]) {
      expect(decodeShipStatus(encodeShipStatus(message))).toEqual(message);
    }
  });

  it('-1~1을 벗어난 스로틀 값은 끝값으로 제한해서 읽는다', () => {
    expect(decodeShipStatus(encodeShipStatus({ throttle: 2, capsized: false }))).toEqual({
      throttle: 1,
      capsized: false,
    });
    expect(decodeShipStatus(encodeShipStatus({ throttle: -1.0001, capsized: true }))).toEqual({
      throttle: -1,
      capsized: true,
    });
  });

  it('스로틀 값이 유한한 수가 아니면 메시지를 무시한다', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(decodeShipStatus(encodeShipStatus({ throttle: bad, capsized: false })), String(bad)).toBeUndefined();
    }
  });

  it('형식이 맞지 않는 문자열은 예외 없이 무시한다', () => {
    for (const text of MALFORMED) {
      expect(() => decodeShipStatus(text), JSON.stringify(text)).not.toThrow();
      expect(decodeShipStatus(text), JSON.stringify(text)).toBeUndefined();
    }
  });

  it('조종 메시지는 배의 상태로 읽지 않는다', () => {
    for (const message of [helm(0, 0), helm(1, -1, 3, 2), helm(-0.5, 0.5, 0, 1)]) {
      expect(decodeShipStatus(encodeHelm(message))).toBeUndefined();
    }
  });
});

describe('버튼을 누른 횟수의 판단 (isNewPress)', () => {
  it('횟수가 늘었으면 새로 누른 것이다', () => {
    expect(isNewPress(0, 1)).toBe(true);
    expect(isNewPress(3, 4)).toBe(true);
  });

  it('횟수가 같으면 새로 누른 것이 없다: 같은 누름을 담은 메시지가 계속 와도 두 번 반영되지 않는다', () => {
    expect(isNewPress(0, 0)).toBe(false);
    expect(isNewPress(4, 4)).toBe(false);
  });

  it('사이의 메시지를 잃어버려 횟수가 건너뛰어도 새로 누른 것으로 본다', () => {
    expect(isNewPress(3, 5)).toBe(true);
    expect(isNewPress(0, 9)).toBe(true);
  });

  it('이 컨트롤러에서 처음 받은 메시지는 횟수와 무관하게 아무것도 반영하지 않는다', () => {
    for (const current of [0, 1, 5, 100]) expect(isNewPress(undefined, current)).toBe(false);
  });

  it('컨트롤러를 새로 열어서 횟수가 줄면 그것만으로는 반영하지 않고, 그 뒤에 누른 것부터 반영한다', () => {
    expect(isNewPress(7, 0)).toBe(false);
    expect(isNewPress(7, 2)).toBe(false);
    // 새로 연 컨트롤러에서 다시 누르면 반영한다
    expect(isNewPress(0, 1)).toBe(true);
  });

  it('메시지를 무작위로 잃어버려도 한 번 누른 것은 정확히 한 번 반영된다', () => {
    // 컨트롤러는 1/60초마다 지금까지 누른 횟수를 보낸다. 누름 사이에는 메시지가 20개씩 있고,
    // 그중 하나 이상은 반드시 도착하도록 마지막 메시지만은 잃지 않는다. 나머지는 40% 확률로 잃는다.
    for (const seed of [1, 2, 3, 42, 2024]) {
      const random = seededRandom(seed);
      const presses = 30;
      let count = 0;
      let previous: number | undefined = undefined;
      let applied = 0;

      // 첫 메시지(누르기 전, 횟수 0)는 연결 직후에 도착한다
      if (isNewPress(previous, count)) applied++;
      previous = count;
      for (let press = 0; press < presses; press++) {
        count++;
        for (let i = 0; i < 20; i++) {
          const lost = i < 19 && random() < 0.4;
          if (lost) continue;
          if (isNewPress(previous, count)) applied++;
          previous = count;
        }
      }
      expect(applied, `seed ${seed}`).toBe(presses);
    }
  });
});
