import { latLonToWorld } from './projection';
import config from './region.json';

/** 시작 위치 메뉴에서 고를 수 있는 시작 위치 */
export interface StartPoint {
  name: string;
  /** 어떤 곳인지 알려 주는 짧은 설명 */
  note: string;
  lat: number;
  lon: number;
  headingDeg: number;
}

/**
 * 운영 구역. 값은 region.json에 있으며, 자료를 내려받는 스크립트도 같은 파일을 읽는다.
 * starts의 첫 번째 지점이 기본 시작 위치이다.
 */
export const REGION: {
  name: string;
  bounds: { south: number; west: number; north: number; east: number };
  /** 구역의 바깥으로 자료를 더 포함하는 범위 (도). 경계 근처에서도 지도와 지형이 끊겨 보이지 않게 한다. */
  dataMargin: number;
  starts: StartPoint[];
} = config;

// 구역의 경계를 월드 좌표로 바꿔 둔다. 북쪽이 -Z이므로, 북쪽 끝의 z가 남쪽 끝의 z보다 작다.
const min = latLonToWorld({ lat: REGION.bounds.north, lon: REGION.bounds.west });
const max = latLonToWorld({ lat: REGION.bounds.south, lon: REGION.bounds.east });

export function isOutsideRegion(x: number, z: number): boolean {
  return x < min.x || x > max.x || z < min.z || z > max.z;
}

/**
 * 구역의 가운데 (월드 좌표).
 * 월드의 원점에서 수십 km 떨어진 좌표를 그대로 정점에 넣으면 GPU의 계산에서 정밀도가 떨어지므로,
 * 구역 전체에 걸친 메시는 이 지점을 기준으로 한 상대 좌표로 정점을 만들고 메시를 이 지점에 놓는다.
 */
export const REGION_CENTER: { x: number; z: number } = { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
