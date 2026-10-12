/** 항해에서 쓰는 단위의 변환과 표기. 여러 화면이 같은 형식으로 값을 표시하도록 한곳에 모은다. */

export const MS_TO_KNOTS = 1.943844;
export const METERS_PER_NAUTICAL_MILE = 1852;

/** 라디안 각도를 항해에서 사용하는 세 자리의 방위(000°~359°)로 표시한다. */
export function formatBearing(radians: number): string {
  const degrees = Math.round((radians * 180) / Math.PI);
  return `${String(((degrees % 360) + 360) % 360).padStart(3, '0')}°`;
}

/** 위도 또는 경도를 해도에서 사용하는 도와 분의 형식으로 표시한다. 위도 1분은 1해리에 해당한다. */
export function formatAngle(value: number, positive: string, negative: string): string {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return `${degrees}°${minutes.toFixed(3).padStart(6, '0')}′${value >= 0 ? positive : negative}`;
}

export function formatLatLon(lat: number, lon: number): string {
  return `${formatAngle(lat, 'N', 'S')}  ${formatAngle(lon, 'E', 'W')}`;
}

/** 거리를 미터 또는 킬로미터와 해리로 함께 표시한다. */
export function formatDistance(meters: number): string {
  const nauticalMiles = (meters / METERS_PER_NAUTICAL_MILE).toFixed(meters < METERS_PER_NAUTICAL_MILE ? 2 : 1);
  return meters < 1000
    ? `${Math.round(meters)} m (${nauticalMiles} 해리)`
    : `${(meters / 1000).toFixed(1)} km (${nauticalMiles} 해리)`;
}
