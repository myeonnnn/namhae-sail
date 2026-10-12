/**
 * 경위도와 월드 좌표(미터)를 상호 변환한다.
 *
 * 웹 지도 타일과 동일한 웹 메르카토르 도법을 사용하되, 기준 위도의 cos 값을 곱해서 실제 거리에 맞춘다.
 * 메르카토르 도법은 위도가 높아질수록 거리를 늘려서 표현하는데, 남해의 범위(북위 33°~35.5°)에서는 이 보정 하나로 거리의 오차가 ±2% 안에 들어온다.
 * 월드의 +X는 동쪽, -Z는 북쪽이다.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS = 6378137;
const DEG_TO_RAD = Math.PI / 180;

/** 월드의 원점(0, 0)에 해당하는 지점. 부산 태종대에서 남동쪽으로 약 8km 떨어진 해상이다. */
export const WORLD_ORIGIN: LatLon = { lat: 34.98, lon: 129.12 };

// 거리를 보정하는 기준 위도. 맵 범위의 가운데로 정해야 남쪽 끝과 북쪽 끝의 오차가 비슷해진다.
const REFERENCE_LAT = 34.25;
const REFERENCE_SCALE = Math.cos(REFERENCE_LAT * DEG_TO_RAD);
const ORIGIN_MERCATOR_X = mercatorX(WORLD_ORIGIN.lon);
const ORIGIN_MERCATOR_Y = mercatorY(WORLD_ORIGIN.lat);

export function latLonToWorld({ lat, lon }: LatLon): { x: number; z: number } {
  return {
    x: (mercatorX(lon) - ORIGIN_MERCATOR_X) * REFERENCE_SCALE,
    z: -(mercatorY(lat) - ORIGIN_MERCATOR_Y) * REFERENCE_SCALE,
  };
}

export function worldToLatLon(x: number, z: number): LatLon {
  const mx = x / REFERENCE_SCALE + ORIGIN_MERCATOR_X;
  const my = -z / REFERENCE_SCALE + ORIGIN_MERCATOR_Y;
  return {
    lat: (2 * Math.atan(Math.exp(my / EARTH_RADIUS)) - Math.PI / 2) / DEG_TO_RAD,
    lon: mx / EARTH_RADIUS / DEG_TO_RAD,
  };
}

/**
 * 경위도를 웹 지도 타일의 좌표로 변환한다.
 * 반환값의 정수 부분이 타일의 번호이고, 소수 부분이 타일 안에서의 위치이다.
 */
export function latLonToTile({ lat, lon }: LatLon, zoom: number): { x: number; y: number } {
  const tileCount = 2 ** zoom;
  const latRad = lat * DEG_TO_RAD;
  return {
    x: ((lon + 180) / 360) * tileCount,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tileCount,
  };
}

/** 주어진 위도와 줌 레벨에서 타일의 한 픽셀이 나타내는 실제 거리 (m) */
export function metersPerTilePixel(lat: number, zoom: number, tileSize = 256): number {
  return (2 * Math.PI * EARTH_RADIUS * Math.cos(lat * DEG_TO_RAD)) / (tileSize * 2 ** zoom);
}

function mercatorX(lon: number): number {
  return EARTH_RADIUS * lon * DEG_TO_RAD;
}

function mercatorY(lat: number): number {
  return EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * DEG_TO_RAD) / 2));
}
