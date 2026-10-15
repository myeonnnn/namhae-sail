import type { LatLon } from '../geo/projection';

/** 하루 중의 시각. 화면의 조절 막대가 이 객체의 값을 직접 변경한다. */
export interface TimeOfDay {
  /** 한국 표준시 기준의 시각 (0~24, 소수는 분을 나타낸다) */
  hour: number;
  /** 1월 1일을 1로 하는 날짜의 순번. 계절에 따라 태양의 높이와 일출, 일몰 시각이 달라진다. */
  dayOfYear: number;
}

const KST_OFFSET_HOURS = 9;
const DEG = Math.PI / 180;

export function createTimeOfDay(): TimeOfDay {
  const now = new Date();
  const startOfYear = Date.UTC(now.getFullYear(), 0, 0);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return { hour: 15, dayOfYear: Math.round((today - startOfYear) / 86400000) };
}

export interface SunPosition {
  /** 태양을 향하는 단위 벡터 (월드 좌표: +X 동쪽, +Y 위쪽, -Z 북쪽) */
  x: number;
  y: number;
  z: number;
  /** 수평선으로부터의 고도 (도). 음수이면 태양이 수평선 아래에 있다. */
  elevationDeg: number;
  /** 북쪽을 0으로 하는 시계 방향의 방위 (도) */
  azimuthDeg: number;
}

/**
 * 주어진 날짜와 시각, 위치에서 태양이 하늘의 어디에 있는지 계산한다.
 * 미국 해양대기청(NOAA)의 근사식을 사용하며, 오차는 1° 이내이다.
 */
export function sunPosition({ hour, dayOfYear }: TimeOfDay, { lat, lon }: LatLon): SunPosition {
  const yearAngle = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);

  // 균시차: 지구의 공전 궤도가 타원이고 자전축이 기울어져 있어서 생기는, 시계의 정오와 태양의 남중 사이의 차이 (분)
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(yearAngle) -
      0.032077 * Math.sin(yearAngle) -
      0.014615 * Math.cos(2 * yearAngle) -
      0.040849 * Math.sin(2 * yearAngle));

  // 적위: 태양이 적도에서 남북으로 얼마나 치우쳐 있는지를 나타내는 각도이며, 계절을 결정한다.
  const declination =
    0.006918 -
    0.399912 * Math.cos(yearAngle) +
    0.070257 * Math.sin(yearAngle) -
    0.006758 * Math.cos(2 * yearAngle) +
    0.000907 * Math.sin(2 * yearAngle) -
    0.002697 * Math.cos(3 * yearAngle) +
    0.00148 * Math.sin(3 * yearAngle);

  // 시간각: 태양이 남중한 뒤로 지구가 자전한 각도. 정오에 0이고 오후에 양수이다.
  const solarMinutes = hour * 60 + equationOfTime + 4 * lon - 60 * KST_OFFSET_HOURS;
  const hourAngle = (solarMinutes / 4 - 180) * DEG;

  const latRad = lat * DEG;
  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const north =
    Math.cos(latRad) * Math.sin(declination) - Math.sin(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const up = Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);

  return {
    x: east,
    y: up,
    z: -north,
    elevationDeg: Math.asin(up) / DEG,
    azimuthDeg: (Math.atan2(east, north) / DEG + 360) % 360,
  };
}

export interface Sunlight {
  /** 가장 밝은 성분이 1이 되도록 정규화한 색상 (선형 RGB) */
  color: [number, number, number];
  /** 0~1 범위의 상대적인 세기. 태양이 머리 위에 있을 때 1에 가깝다. */
  strength: number;
}

// 대기가 빛을 흩어 놓는 정도를 색상별로 나타낸 값. 파란빛이 가장 많이 흩어진다.
const OPTICAL_DEPTH = [0.08, 0.12, 0.2] as const;

/**
 * 태양의 고도로부터 지표에 도달하는 햇빛의 색상과 세기를 구한다.
 * 태양이 낮을수록 빛이 대기를 길게 통과하고, 파란빛이 먼저 흩어져서 붉고 약한 빛만 남는다.
 */
export function sunlight(elevationDeg: number): Sunlight {
  const clamped = Math.max(elevationDeg, -1);
  // 대기 질량: 빛이 통과하는 대기의 두께를 머리 위 방향의 두께에 대한 배수로 나타낸 값 (Kasten–Young 식)
  const airMass = 1 / (Math.sin(clamped * DEG) + 0.50572 * (clamped + 6.07995) ** -1.6364);
  const transmitted = OPTICAL_DEPTH.map((depth) => Math.exp(-depth * airMass));
  const peak = Math.max(...transmitted);
  // 태양이 수평선을 지나는 동안 서서히 사라지게 한다.
  const aboveHorizon = smoothstep(elevationDeg, -1.5, 2);
  return {
    color: [transmitted[0] / peak, transmitted[1] / peak, transmitted[2] / peak],
    strength: peak * aboveHorizon,
  };
}

function smoothstep(x: number, min: number, max: number): number {
  const t = Math.min(1, Math.max(0, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
}
