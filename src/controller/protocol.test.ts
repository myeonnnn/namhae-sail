import { describe, expect, it } from 'vitest';
import { seededRandom } from '../core/random';
import {
  decodeHelm,
  decodeShipStatus,
  encodeHelm,
  encodeShipStatus,
  isNewPress,
  viewDragDelta,
  type HelmMessage,
  type ShipStatusMessage,
} from './protocol';

/** 형식과 무관하게 어느 메시지로도 읽힐 수 없는 문자열 */
const MALFORMED = ['', ' ', 'hello', '{', 'null', '42', '[]', '{}', 'true', '"helm"', 'throttle rudder'];

/** 조종 값과 누른 횟수를 정하고, 시점에 관한 값은 따로 주지 않으면 끌지 않은 상태로 둔다. */
function helm(
  throttleRate: number,
  rudder: number,
  neutralCount = 0,
  resetCount = 0,
  view: Partial<Pick<HelmMessage, 'viewResetCount' | 'viewX' | 'viewY' | 'session'>> = {},
): HelmMessage {
  return {
    throttleRate,
    rudder,
    neutralCount,
    resetCount,
    viewResetCount: 0,
    viewX: 0,
    viewY: 0,
    session: 's1',
    ...view,
  };
}

/** 시점 영역을 끈 누적 거리만 다른 조종 메시지 */
function drag(viewX: number, viewY: number, session = 's1'): HelmMessage {
  return helm(0, 0, 0, 0, { viewX, viewY, session });
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

  it('시점 초기화 횟수, 끈 누적 거리, session을 그대로 읽는다', () => {
    for (const message of [
      helm(0, 0, 0, 0, { viewResetCount: 0, viewX: 0, viewY: 0, session: 'a' }),
      helm(0.5, -0.5, 1, 2, { viewResetCount: 3, viewX: 120, viewY: -45, session: 'k3j9x2' }),
      helm(0, 0, 0, 0, { viewResetCount: 1000, viewX: -987.25, viewY: 0.5, session: 'session-with-long-name-0123' }),
    ]) {
      expect(decodeHelm(encodeHelm(message))).toEqual(message);
    }
  });

  it('끈 누적 거리는 -1~1로 제한하지 않는다: 오래 끌면 수천 px가 쌓인다', () => {
    const message = helm(0, 0, 0, 0, { viewX: 25000, viewY: -3000.5 });
    expect(decodeHelm(encodeHelm(message))).toEqual(message);
  });

  it('끈 누적 거리가 유한한 수가 아니면 메시지를 무시한다', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(decodeHelm(encodeHelm(helm(0, 0, 0, 0, { viewX: bad }))), `viewX ${bad}`).toBeUndefined();
      expect(decodeHelm(encodeHelm(helm(0, 0, 0, 0, { viewY: bad }))), `viewY ${bad}`).toBeUndefined();
    }
  });

  it('시점 초기화를 누른 횟수가 0 이상의 정수가 아니면 메시지를 무시한다', () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decodeHelm(encodeHelm(helm(0, 0, 0, 0, { viewResetCount: bad }))), `${bad}`).toBeUndefined();
    }
  });

  it('session이 비어 있지 않은 문자열이 아니면 메시지를 무시한다', () => {
    for (const bad of ['', 42, null, true]) {
      const message = helm(0, 0, 0, 0, { session: bad as unknown as string });
      expect(decodeHelm(encodeHelm(message)), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('새로 생긴 값이 빠진 메시지는 무시한다', () => {
    for (const key of ['viewResetCount', 'viewX', 'viewY', 'session'] as const) {
      const message: Record<string, unknown> = { ...helm(0.5, 0.5, 1, 1) };
      delete message[key];
      expect(decodeHelm(encodeHelm(message as unknown as HelmMessage)), key).toBeUndefined();
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

describe('시점 영역을 새로 끈 거리 (viewDragDelta)', () => {
  it('직전 메시지 뒤로 늘어난 누적 거리만큼이 새로 끈 거리이다', () => {
    expect(viewDragDelta(drag(0, 0), drag(30, -12))).toEqual({ x: 30, y: -12 });
    expect(viewDragDelta(drag(100, 50), drag(80, 70))).toEqual({ x: -20, y: 20 });
  });

  it('같은 메시지를 두 번 받으면 두 번째는 시점을 움직이지 않는다', () => {
    const message = drag(250, -40);
    expect(viewDragDelta(drag(200, -10), message)).toEqual({ x: 50, y: -30 });
    const again = viewDragDelta(message, message);
    // 부호 있는 0(-0)도 "움직이지 않음"이므로 크기로 확인한다.
    expect(Math.abs(again.x)).toBe(0);
    expect(Math.abs(again.y)).toBe(0);
  });

  it('사이의 메시지를 잃어도 끈 거리는 빠짐없이 반영된다', () => {
    // 0 -> 10 -> 25 -> 60 중 가운데 두 개를 잃어도, 받은 두 메시지만으로 60을 모두 반영한다.
    expect(viewDragDelta(drag(0, 0), drag(60, -33))).toEqual({ x: 60, y: -33 });
  });

  it('이 컨트롤러에서 처음 받은 메시지는 누적 거리와 무관하게 시점을 움직이지 않는다', () => {
    for (const current of [drag(0, 0), drag(500, -200), drag(-3, 7)]) {
      const delta = viewDragDelta(undefined, current);
      expect(Math.abs(delta.x)).toBe(0);
      expect(Math.abs(delta.y)).toBe(0);
    }
  });

  it('컨트롤러를 새로 열어서 session이 바뀌면 누적 값이 처음부터 세어져도 시점을 움직이지 않는다', () => {
    // 누적 값이 줄어든 경우, 우연히 늘어난 경우, 같은 경우 모두 그것만으로는 움직이지 않는다.
    for (const current of [drag(0, 0, 's2'), drag(900, 900, 's2'), drag(400, -100, 's2')]) {
      const delta = viewDragDelta(drag(400, -100, 's1'), current);
      expect(Math.abs(delta.x), JSON.stringify(current)).toBe(0);
      expect(Math.abs(delta.y), JSON.stringify(current)).toBe(0);
    }
    // 새로 연 컨트롤러에서 끈 것부터는 반영한다
    expect(viewDragDelta(drag(0, 0, 's2'), drag(15, 5, 's2'))).toEqual({ x: 15, y: 5 });
  });

  it('메시지를 무작위로 잃거나 겹쳐 받아도, 반영한 거리의 합은 실제로 끈 거리와 같다', () => {
    // 컨트롤러는 1/30초마다 지금까지 끈 누적 거리를 보낸다. 매 간격 사이에 손가락이 -20~20 px 움직인다.
    // 메시지는 40% 확률로 잃고, 도착한 것은 30% 확률로 한 번 더 도착한다. 마지막 메시지만은 반드시 도착한다.
    for (const seed of [1, 2, 3, 42, 2024]) {
      const random = seededRandom(seed);
      let x = 0;
      let y = 0;
      let previous: HelmMessage | undefined = undefined;
      let appliedX = 0;
      let appliedY = 0;
      const receive = (message: HelmMessage) => {
        const delta = viewDragDelta(previous, message);
        appliedX += delta.x;
        appliedY += delta.y;
        previous = message;
      };

      // 끌기 전의 첫 메시지(누적 0)는 연결 직후에 도착한다
      receive(drag(0, 0));
      const steps = 300;
      for (let i = 0; i < steps; i++) {
        x += (random() - 0.5) * 40;
        y += (random() - 0.5) * 40;
        const lost = i < steps - 1 && random() < 0.4;
        if (lost) continue;
        const message = drag(x, y);
        receive(message);
        if (random() < 0.3) receive({ ...message });
      }
      // 차이를 더하면 중간 값이 서로 지워지므로, 남는 오차는 크기 수백 px의 덧셈 수백 번의 반올림뿐이다 (1e-9 px 미만).
      expect(appliedX, `seed ${seed}`).toBeCloseTo(x, 6);
      expect(appliedY, `seed ${seed}`).toBeCloseTo(y, 6);
    }
  });

  it('도중에 컨트롤러를 새로 열어도, 다시 연 순간의 누적 값 변화는 반영하지 않고 양쪽에서 끈 거리만 반영한다', () => {
    let previous: HelmMessage | undefined = undefined;
    let appliedX = 0;
    let appliedY = 0;
    const receive = (message: HelmMessage) => {
      const delta = viewDragDelta(previous, message);
      appliedX += delta.x;
      appliedY += delta.y;
      previous = message;
    };
    // 처음 연 컨트롤러에서 (120, -30)만큼 끈다
    receive(drag(0, 0, 's1'));
    receive(drag(50, -10, 's1'));
    receive(drag(120, -30, 's1'));
    // 다시 열어서 누적 값이 0부터 세어진다
    receive(drag(0, 0, 's2'));
    expect(appliedX).toBe(120);
    expect(appliedY).toBe(-30);
    // 다시 연 컨트롤러에서 (-40, 25)만큼 끈다
    receive(drag(-15, 10, 's2'));
    receive(drag(-40, 25, 's2'));
    expect(appliedX).toBe(80);
    expect(appliedY).toBe(-5);
  });
});
