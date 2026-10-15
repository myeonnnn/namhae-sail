import { isOutsideRegion } from '../geo/region';
import type { Ship } from '../ship/ship';
import type { ShipSpec } from '../ship/shipSpec';
import type { Bridges } from '../world/bridges';
import type { Seamarks } from '../world/seamarks';
import type { Structures } from '../world/structures';
import type { Terrain } from '../world/terrain';

/** 한 스텝에서 일어난 충돌. 화면에 표시할 경고와 연출의 세기를 담는다. */
export interface Collision {
  message: string;
  /** 물보라와 카메라 흔들림의 세기 (0~1). 0이면 연출 없이 경고만 표시한다. */
  impact: number;
}

export interface CollisionWorld {
  terrain: Terrain;
  structures: Structures;
  bridges: Bridges;
  seamarks: Seamarks;
}

type PointTest = (x: number, z: number) => boolean;

/**
 * 선박이 이번 스텝에 이동한 결과를 주변의 장애물과 대조하고, 부딪혔으면 배를 세운 뒤에 그 내용을 반환한다.
 * 한 스텝에는 한 가지 충돌만 처리한다. 앞에 있는 판정일수록 우선한다.
 *
 * @param time 시뮬레이션의 경과 시간 (초). 부표가 밀려났다가 돌아오는 움직임의 기준이 된다.
 */
export function resolveCollisions(
  ship: Ship,
  spec: ShipSpec,
  world: CollisionWorld,
  time: number,
): Collision | undefined {
  const { terrain, structures, bridges, seamarks } = world;
  const { state } = ship;

  if (isOutsideRegion(state.x, state.z)) {
    // 구역의 바깥에는 지도와 표지의 자료가 없으므로, 경계에서 배를 세운다.
    ship.stopAtPreviousPosition();
    return { message: '항해 구역의 끝입니다: 후진(S)으로 되돌아가세요', impact: 0 };
  }

  // 다리 밑의 높이가 선박보다 낮으면 지나갈 수 없다. 경고에 표시하기 위해서 막힌 지점의 높이를 기록한다.
  let blockedClearance = 0;
  const tooLow: PointTest = (x, z) => {
    const clearance = bridges.clearanceAt(x, z);
    if (clearance === undefined || clearance >= spec.model.airDraft) return false;
    blockedClearance = clearance;
    return true;
  };

  // 선체의 윤곽이 닿으면 배를 세우는 장애물들
  const obstacles: [test: PointTest, message: () => string][] = [
    [(x, z) => terrain.isLand(x, z), () => '좌초: 후진(S)으로 이탈'],
    [(x, z) => bridges.hitsPier(x, z), () => '교각과 충돌: 후진(S)으로 이탈'],
    [tooLow, () => `다리 밑을 지날 수 없습니다: 높이 ${blockedClearance.toFixed(0)}m, 선박 ${spec.model.airDraft}m`],
    [(x, z) => structures.contains(x, z), () => '방파제 또는 부두와 충돌: 후진(S)으로 이탈'],
  ];
  for (const [test, message] of obstacles) {
    if (ship.resolveGrounding(test)) return { message: message(), impact: 1 };
  }

  const mark = seamarks.collide(state.x, state.z, state.heading, spec.model.length / 2, spec.model.beam / 2, time);
  if (!mark) return undefined;
  if (mark.kind === 'buoy') {
    // 부표는 물에 떠 있어서 밀려난다. 배는 속력을 조금 잃고 그대로 지나간다.
    state.surge *= 0.85;
    return { message: '부표와 충돌', impact: 0.4 };
  }
  ship.stopAtPreviousPosition();
  return { message: `${mark.kind === 'light' ? '등대' : '등표'}와 충돌: 후진(S)으로 이탈`, impact: 1 };
}
