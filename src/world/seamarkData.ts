export type SeamarkKind = 'light' | 'beacon' | 'buoy';

/** scripts/fetch-seamarks.mjs가 저장하는 형식 */
export interface SeamarkRecord {
  kind: SeamarkKind;
  lat: number;
  lon: number;
  /** 구조물의 색상 */
  colour?: string;
  /** 등화의 색상 */
  light?: string;
  /** 등화가 한 번 반복되는 주기 (초) */
  period?: number;
  /** 등화의 해수면 기준 높이 (m). 구조물 자체의 높이가 아니다. */
  height?: number;
  name?: string;
}

const DATA_URL = '/data/seamarks.json';
let pending: Promise<SeamarkRecord[]> | undefined;

/** 해상 표지의 목록을 불러온다. 3D 화면과 지도가 함께 사용하므로, 한 번만 요청하고 결과를 공유한다. */
export function loadSeamarkRecords(): Promise<SeamarkRecord[]> {
  pending ??= fetch(DATA_URL).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<SeamarkRecord[]>;
  });
  return pending;
}
