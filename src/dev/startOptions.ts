import type { StartPoint } from '../geo/region';

/** 주소의 쿼리로 지정한 시작 조건 */
export interface StartOptions {
  lat: number;
  lon: number;
  headingDeg: number;
  /** 배는 기본 시작 위치에 두고, 지정한 좌표를 관찰 모드로 바라보면서 시작한다. 육지 위의 좌표도 지정할 수 있다. */
  observe: boolean;
  /** 시작 화면을 건너뛴다. 위치를 지정했을 때에는 특정 장소를 바로 확인하려는 것이므로 함께 건너뛴다. */
  skipIntro: boolean;
}

/**
 * 주소에 ?lat=34.83&lon=128.43&heading=300과 같이 적은 시작 조건을 읽는다. 특정 장소를 확인할 때 사용한다.
 * enabled가 false이면(배포한 결과물) 주소에 무엇이 적혀 있든 기본 시작 위치를 그대로 반환한다.
 */
export function readStartOptions(enabled: boolean, fallback: StartPoint): StartOptions {
  const query = new URLSearchParams(enabled ? location.search : '');
  const number = (name: string, fallbackValue: number) => {
    const value = Number(query.get(name) ?? NaN);
    return Number.isFinite(value) ? value : fallbackValue;
  };
  const observe = query.has('observe');
  return {
    lat: number('lat', fallback.lat),
    lon: number('lon', fallback.lon),
    headingDeg: number('heading', fallback.headingDeg),
    observe,
    skipIntro: query.has('lat') || observe || query.has('skipIntro'),
  };
}
