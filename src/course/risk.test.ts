import { describe, expect, it } from 'vitest';
import { countRisks, riskScoreOf, riskyChoices, seaScoreOf } from './risk';

// 명세 "4. 타임어택 > 난이도" 절의 기준을 확인한다. 기대값은 구현에서 가져오지 않고 명세의 문장에서 옮긴다.

type Point = { x: number; z: number };

const DEG = Math.PI / 180;

/**
 * 원점에서 출발해서 방위(도, 북쪽 0, 시계 방향)와 길이(m)의 구간을 차례로 이은 경로의 점들.
 * 북쪽이 -Z, 동쪽이 +X이므로 방위 h로 d만큼 가면 (d·sin h, −d·cos h)만큼 움직인다.
 */
function path(legs: { heading: number; length: number }[]): Point[] {
  const points: Point[] = [{ x: 0, z: 0 }];
  for (const { heading, length } of legs) {
    const last = points[points.length - 1];
    points.push({ x: last.x + length * Math.sin(heading * DEG), z: last.z - length * Math.cos(heading * DEG) });
  }
  return points;
}

/** 옆파도 구간이 되지 않도록 300m보다 짧게 잡은 구간의 길이. 코너만 따로 세기 위해서 쓴다. */
const SHORT = 200;

/** 북쪽으로 들어와서 관문에서 turn(도, 오른쪽이 +)만큼 꺾어 나가는 짧은 경로 */
function cornerPath(turn: number): Point[] {
  return path([
    { heading: 0, length: SHORT },
    { heading: turn, length: SHORT },
  ]);
}

describe('바다의 세기', () => {
  it('3단계 이하이면 환경과 관계없이 1이다', () => {
    for (const level of [1, 2, 3]) {
      for (const step of [undefined, 0, 1, 2]) {
        expect(seaScoreOf(level, step), `${level}단계, 환경 ${step}`).toBe(1);
      }
    }
  });

  it('4단계의 잔잔한 쪽과 가운데 환경이면 2이다', () => {
    expect(seaScoreOf(4, 0)).toBe(2);
    expect(seaScoreOf(4, 1)).toBe(2);
  });

  it('4단계의 거친 쪽 환경이면 3이다', () => {
    expect(seaScoreOf(4, 2)).toBe(3);
  });

  it('환경을 고정하지 않은 4단계 코스는 가운데 환경으로 보아 2이다', () => {
    expect(seaScoreOf(4)).toBe(2);
    expect(seaScoreOf(4, undefined)).toBe(2);
  });

  it('5단계이면 환경과 관계없이 3이다', () => {
    for (const step of [undefined, 0, 1, 2]) {
      expect(seaScoreOf(5, step), `환경 ${step}`).toBe(3);
    }
  });
});

describe('위험한 선택의 점수', () => {
  it('위험한 선택이 0~1개이면 1, 2~3개이면 2, 4개 이상이면 3이다', () => {
    expect(riskScoreOf(0)).toBe(1);
    expect(riskScoreOf(1)).toBe(1);
    expect(riskScoreOf(2)).toBe(2);
    expect(riskScoreOf(3)).toBe(2);
    expect(riskScoreOf(4)).toBe(3);
    expect(riskScoreOf(5)).toBe(3);
    expect(riskScoreOf(12)).toBe(3);
  });
});

describe('위험한 코너', () => {
  it('바람이 오른쪽에서 불 때 관문에서 오른쪽으로 90° 꺾으면 위험한 코너이다', () => {
    // 북쪽으로 들어오므로 동풍(90°)은 오른쪽 옆에서 분다. 오른쪽으로 꺾으면 바람이 불어오는 쪽으로 꺾는 것이다.
    expect(countRisks(cornerPath(90), 90)).toEqual({ corners: 1, beamLegs: 0 });
  });

  it('바람이 왼쪽에서 불 때 관문에서 왼쪽으로 90° 꺾으면 위험한 코너이다', () => {
    expect(countRisks(cornerPath(-90), 270)).toEqual({ corners: 1, beamLegs: 0 });
  });

  it('바람이 불어 가는 쪽으로 꺾으면 아무리 크게 꺾어도 위험한 코너가 아니다', () => {
    // 동풍에서 왼쪽으로, 서풍에서 오른쪽으로 꺾는 경우
    expect(countRisks(cornerPath(-90), 90).corners).toBe(0);
    expect(countRisks(cornerPath(90), 270).corners).toBe(0);
    expect(countRisks(cornerPath(-150), 90).corners).toBe(0);
  });

  it('60° 이상 꺾어야 위험한 코너이다', () => {
    // 경계에서 부동소수점의 오차로 판정이 뒤집히지 않도록 60°에서 1°씩 떨어진 값으로 확인한다.
    expect(countRisks(cornerPath(30), 90).corners).toBe(0);
    expect(countRisks(cornerPath(59), 90).corners).toBe(0);
    expect(countRisks(cornerPath(61), 90).corners).toBe(1);
    expect(countRisks(cornerPath(-59), 270).corners).toBe(0);
    expect(countRisks(cornerPath(-61), 270).corners).toBe(1);
  });

  it('되돌아가듯이 크게(150°) 꺾어도 바람이 불어오는 쪽이면 위험한 코너이다', () => {
    expect(countRisks(cornerPath(150), 90).corners).toBe(1);
    expect(countRisks(cornerPath(-150), 270).corners).toBe(1);
  });

  it('바람이 들어오는 방향의 선수에서 20° 이내로 불면 위험한 코너로 보지 않는다', () => {
    // 북쪽으로 들어오므로 선수는 방위 0°이다. 20°의 경계에서 1°씩 떨어진 값으로 확인한다.
    expect(countRisks(cornerPath(90), 10).corners).toBe(0);
    expect(countRisks(cornerPath(90), 19).corners).toBe(0);
    expect(countRisks(cornerPath(90), 21).corners).toBe(1);
    expect(countRisks(cornerPath(-90), 341).corners).toBe(0);
    expect(countRisks(cornerPath(-90), 339).corners).toBe(1);
    // 정면에서 부는 바람은 어느 쪽으로 꺾어도 위험한 코너가 아니다.
    expect(countRisks(cornerPath(90), 0).corners).toBe(0);
    expect(countRisks(cornerPath(-90), 0).corners).toBe(0);
  });

  it('바람이 들어오는 방향의 선미에서 20° 이내로 불면 위험한 코너로 보지 않는다', () => {
    // 선미는 방위 180°이다.
    expect(countRisks(cornerPath(90), 161).corners).toBe(0);
    expect(countRisks(cornerPath(90), 159).corners).toBe(1);
    expect(countRisks(cornerPath(-90), 199).corners).toBe(0);
    expect(countRisks(cornerPath(-90), 201).corners).toBe(1);
    expect(countRisks(cornerPath(90), 180).corners).toBe(0);
    expect(countRisks(cornerPath(-90), 180).corners).toBe(0);
  });

  it('바람이 불어오는 쪽은 나가는 방향이 아니라 들어오는 방향을 기준으로 정한다', () => {
    // 북쪽으로 들어와서 오른쪽으로 150° 꺾으면 나가는 방위는 150°이다. 바람이 방위 100°에서 불면
    // 들어오는 방향(0°)에는 오른쪽이지만, 나가는 방향(150°)에는 왼쪽이다. 들어오는 방향이 기준이므로 위험한 코너이다.
    expect(countRisks(cornerPath(150), 100).corners).toBe(1);
  });

  it('출발점과 도착선에서는 꺾지 않으므로 관문이 없는 경로에는 위험한 코너가 없다', () => {
    expect(countRisks(path([{ heading: 0, length: SHORT }]), 90).corners).toBe(0);
  });

  it('위험한 코너는 관문마다 따로 센다', () => {
    // 북 → 동 → 남으로 오른쪽으로 두 번 꺾는다. 바람은 방위 135°(남동)에서 분다.
    // 첫 관문: 들어오는 방위 0°, 바람은 오른쪽 135° → 오른쪽으로 꺾으므로 위험
    // 둘째 관문: 들어오는 방위 90°, 바람은 오른쪽 45° → 오른쪽으로 꺾으므로 위험
    const points = path([
      { heading: 0, length: SHORT },
      { heading: 90, length: SHORT },
      { heading: 180, length: SHORT },
    ]);
    expect(countRisks(points, 135).corners).toBe(2);
    // 바람이 북서(315°)에서 불면 두 관문 모두 바람이 불어 가는 쪽으로 꺾는다.
    expect(countRisks(points, 315).corners).toBe(0);
  });
});

describe('옆파도 구간', () => {
  // 파도는 바람이 불어 가는 쪽으로 진행한다. 북풍(0°)이면 파도는 남쪽(180°)으로 간다.

  it('파도의 진행 방향과 직각인 300m 이상의 구간은 옆파도 구간이다', () => {
    expect(countRisks(path([{ heading: 90, length: 1000 }]), 0)).toEqual({ corners: 0, beamLegs: 1 });
    expect(countRisks(path([{ heading: 270, length: 1000 }]), 0)).toEqual({ corners: 0, beamLegs: 1 });
  });

  it('파도를 정면으로 받거나 뒤에서 받는 구간은 옆파도 구간이 아니다', () => {
    expect(countRisks(path([{ heading: 0, length: 1000 }]), 0).beamLegs).toBe(0);
    expect(countRisks(path([{ heading: 180, length: 1000 }]), 0).beamLegs).toBe(0);
  });

  it('파도의 진행 방향과 60~120°를 이루는 구간만 옆파도 구간이다', () => {
    // 파도는 방위 180°로 진행한다. 방위 h인 구간이 이루는 각은 |h − 180|이다.
    // 경계 60°와 120°에서 부동소수점의 오차로 판정이 뒤집히지 않도록 1°씩 떨어진 값으로 확인한다.
    const legAt = (angle: number) => path([{ heading: 180 - angle, length: 1000 }]);
    expect(countRisks(legAt(30), 0).beamLegs).toBe(0);
    expect(countRisks(legAt(59), 0).beamLegs).toBe(0);
    expect(countRisks(legAt(61), 0).beamLegs).toBe(1);
    expect(countRisks(legAt(119), 0).beamLegs).toBe(1);
    expect(countRisks(legAt(121), 0).beamLegs).toBe(0);
    expect(countRisks(legAt(150), 0).beamLegs).toBe(0);
  });

  it('길이가 300m 이상이어야 옆파도 구간이다', () => {
    // 동쪽으로 곧게 가는 구간은 좌표가 정확하므로 300m의 경계를 그대로 확인할 수 있다.
    expect(
      countRisks(
        [
          { x: 0, z: 0 },
          { x: 300, z: 0 },
        ],
        0,
      ).beamLegs,
    ).toBe(1);
    expect(
      countRisks(
        [
          { x: 0, z: 0 },
          { x: 299, z: 0 },
        ],
        0,
      ).beamLegs,
    ).toBe(0);
    expect(
      countRisks(
        [
          { x: 0, z: 0 },
          { x: 0.001, z: 0 },
        ],
        0,
      ).beamLegs,
    ).toBe(0);
  });

  it('출발점에서 첫 관문까지, 관문 사이, 마지막 관문에서 도착선까지를 각각 한 구간으로 센다', () => {
    // 동쪽으로 400m씩 세 구간이다. 모두 북풍의 파도를 옆으로 받는다.
    const points: Point[] = [
      { x: 0, z: 0 },
      { x: 400, z: 0 },
      { x: 800, z: 0 },
      { x: 1200, z: 0 },
    ];
    expect(countRisks(points, 0)).toEqual({ corners: 0, beamLegs: 3 });
  });

  it('옆파도 구간의 판정은 바람이 불어오는 방향에 따라 바뀐다', () => {
    // 동쪽으로 가는 구간은 북풍과 남풍에서는 옆파도, 동풍과 서풍에서는 정면이나 뒤에서 받는 파도이다.
    const east = path([{ heading: 90, length: 1000 }]);
    expect(countRisks(east, 0).beamLegs).toBe(1);
    expect(countRisks(east, 180).beamLegs).toBe(1);
    expect(countRisks(east, 90).beamLegs).toBe(0);
    expect(countRisks(east, 270).beamLegs).toBe(0);
  });
});

describe('위험한 선택의 합', () => {
  it('위험한 코너와 옆파도 구간을 따로 센다', () => {
    // 북쪽으로 400m 간 뒤 관문에서 오른쪽(동쪽)으로 꺾어 400m 간다. 바람은 동쪽(90°)에서 분다.
    // 관문: 들어오는 방위 0°, 바람은 오른쪽 → 오른쪽으로 꺾으므로 위험한 코너
    // 첫 구간: 파도는 서쪽(270°)으로 진행하고 구간은 북쪽이므로 90° → 옆파도 구간
    // 둘째 구간: 동쪽으로 가므로 파도와 180° → 옆파도 구간이 아니다
    const points = path([
      { heading: 0, length: 400 },
      { heading: 90, length: 400 },
    ]);
    expect(countRisks(points, 90)).toEqual({ corners: 1, beamLegs: 1 });
  });

  it('경로와 바람을 함께 돌려도 센 결과는 같다', () => {
    // 판정은 경로와 바람이 이루는 각에만 달려 있으므로, 둘을 같은 각만큼 돌려도 결과가 바뀌지 않아야 한다.
    const legs = [
      { heading: 0, length: 400 },
      { heading: 90, length: 400 },
      { heading: 180, length: 250 },
      { heading: 100, length: 350 },
    ];
    const base = countRisks(path(legs), 135);
    for (const rotation of [37, 90, 200, 313]) {
      const rotated = path(legs.map((leg) => ({ ...leg, heading: leg.heading + rotation })));
      expect(countRisks(rotated, (135 + rotation) % 360), `${rotation}° 돌림`).toEqual(base);
    }
  });

  it('풍향은 360°마다 같은 방향이다', () => {
    const points = path([
      { heading: 0, length: 400 },
      { heading: 90, length: 400 },
    ]);
    expect(countRisks(points, 450)).toEqual(countRisks(points, 90));
    expect(countRisks(points, -270)).toEqual(countRisks(points, 90));
    expect(countRisks(points, 360)).toEqual(countRisks(points, 0));
  });
});

describe('등급에 넣는 위험한 선택의 개수', () => {
  // 명세: 위험한 코너는 언제나 세고, 옆파도 구간은 바다의 세기가 3일 때만 센다.

  it('바다의 세기가 3이면 위험한 코너와 옆파도 구간을 합해서 센다', () => {
    expect(riskyChoices({ corners: 2, beamLegs: 3 }, 3)).toBe(5);
    expect(riskyChoices({ corners: 0, beamLegs: 4 }, 3)).toBe(4);
    expect(riskyChoices({ corners: 3, beamLegs: 0 }, 3)).toBe(3);
  });

  it('바다의 세기가 1이나 2이면 옆파도 구간은 세지 않고 위험한 코너만 센다', () => {
    for (const seaScore of [1, 2]) {
      expect(riskyChoices({ corners: 2, beamLegs: 3 }, seaScore), `바다 ${seaScore}`).toBe(2);
      expect(riskyChoices({ corners: 0, beamLegs: 5 }, seaScore), `바다 ${seaScore}`).toBe(0);
      expect(riskyChoices({ corners: 4, beamLegs: 0 }, seaScore), `바다 ${seaScore}`).toBe(4);
    }
  });

  it('위험한 코너는 바다의 세기와 관계없이 언제나 센다', () => {
    for (const seaScore of [1, 2, 3]) {
      expect(riskyChoices({ corners: 3, beamLegs: 0 }, seaScore), `바다 ${seaScore}`).toBe(3);
    }
  });

  it('위험한 선택이 하나도 없으면 바다의 세기와 관계없이 0개이다', () => {
    for (const seaScore of [1, 2, 3]) {
      expect(riskyChoices({ corners: 0, beamLegs: 0 }, seaScore), `바다 ${seaScore}`).toBe(0);
    }
  });

  it('옆파도 구간만 많은 경로는 바다의 세기가 3이 될 때 비로소 위험한 선택의 점수가 오른다', () => {
    // 옆파도 구간 4개, 코너 0개: 바다의 세기 2에서는 0개라 1점, 3에서는 4개라 3점이다.
    const risks = { corners: 0, beamLegs: 4 };
    expect(riskScoreOf(riskyChoices(risks, 2))).toBe(1);
    expect(riskScoreOf(riskyChoices(risks, 3))).toBe(3);
  });

  it('countRisks가 센 결과를 그대로 받아서, 같은 경로라도 바다의 세기에 따라 개수가 달라진다', () => {
    // 북쪽으로 400m 간 뒤 관문에서 동쪽으로 꺾어 400m 간다. 동풍(90°)이면 위험한 코너 1개와 옆파도 구간 1개이다.
    const risks = countRisks(
      path([
        { heading: 0, length: 400 },
        { heading: 90, length: 400 },
      ]),
      90,
    );
    expect(risks).toEqual({ corners: 1, beamLegs: 1 });
    expect(riskyChoices(risks, 1)).toBe(1);
    expect(riskyChoices(risks, 2)).toBe(1);
    expect(riskyChoices(risks, 3)).toBe(2);
  });

  it('센 결과를 바꾸지 않는다', () => {
    const risks = { corners: 1, beamLegs: 2 };
    riskyChoices(risks, 2);
    riskyChoices(risks, 3);
    expect(risks).toEqual({ corners: 1, beamLegs: 2 });
  });
});
