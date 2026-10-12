export type PlaceKind = 'city' | 'town' | 'village' | 'island' | 'islet' | 'peak';

export interface ChartPlace {
  kind: PlaceKind;
  name: string;
  lat: number;
  lon: number;
  /** 봉우리의 해발 높이 (m) */
  ele?: number;
}

export interface ChartStructure {
  /** OpenStreetMap의 man_made 값: breakwater(방파제), pier(부두와 잔교), groyne(돌제) */
  kind: string;
  /** true이면 points가 구조물의 윤곽이고, false이면 중심선이다. */
  closed: boolean;
  /** (경도, 위도)의 목록 */
  points: [number, number][];
}

/** 바다를 건너는 다리. 여러 조각으로 등록된 다리를 하나로 이은 것이다. */
export interface ChartBridge {
  name?: string;
  /** OpenStreetMap의 bridge:structure 값: cable-stayed(사장교), suspension(현수교), beam(거더교) 등 */
  structure?: string;
  /** 상판의 폭 (m). 차로의 수로 추정한 값이다. */
  width: number;
  /** 가장 높은 지점에서의 다리 밑 높이 (m). 자료에 없어서 다리의 형식으로 추정한 값이다. */
  clearance: number;
  length: number;
  /** 중심선의 (경도, 위도) 목록 */
  points: [number, number][];
}

/** scripts/fetch-chart.mjs가 저장하는 형식 */
export interface ChartData {
  places: ChartPlace[];
  structures: ChartStructure[];
  bridges: ChartBridge[];
  urban: [number, number][][];
}

const DATA_URL = '/data/chart.json';
let pending: Promise<ChartData> | undefined;

/** 지명과 육지의 지물을 불러온다. 해도와 3D 화면이 함께 사용하므로, 한 번만 요청하고 결과를 공유한다. */
export function loadChart(): Promise<ChartData> {
  pending ??= fetch(DATA_URL).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<ChartData>;
  });
  return pending;
}
