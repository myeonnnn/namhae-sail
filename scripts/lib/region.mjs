// 자료를 내려받는 스크립트들이 함께 사용하는 경로와 운영 구역. 구역의 값은 앱과 같은 파일(src/geo/region.json)에서 읽는다.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const { bounds, dataMargin } = JSON.parse(readFileSync(resolve(ROOT, 'src/geo/region.json'), 'utf8'));

/** 운영 구역의 범위 (도) */
export const REGION = bounds;
/**
 * 자료를 받는 범위. 운영 구역에서 dataMargin(도)만큼 바깥으로 넓힌 것이다.
 * 구역의 경계 근처에서도 지도와 지형이 끊겨 보이지 않게 한다.
 */
export const DATA_BOUNDS = {
  south: bounds.south - dataMargin,
  west: bounds.west - dataMargin,
  north: bounds.north + dataMargin,
  east: bounds.east + dataMargin,
};
/** Overpass의 질의에 넣는 형식 (남, 서, 북, 동) */
export const DATA_BBOX = [DATA_BOUNDS.south, DATA_BOUNDS.west, DATA_BOUNDS.north, DATA_BOUNDS.east].join(',');
