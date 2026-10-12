/** 선박 한 종류의 외형과 조종 특성을 정의한다. 힘은 모두 질량으로 나눈 가속도 단위이다. */
export interface ShipSpec {
  model: {
    url: string;
    /** 원본 모델의 길이 (모델 단위) */
    sourceLength: number;
    /** 월드에서의 길이 (m) */
    length: number;
    /** 월드에서의 폭 (m). 부력을 계산할 때 수면을 읽는 범위로 사용한다. */
    beam: number;
    /** 물에 잠기는 깊이 (m). 원본 모델의 원점이 선체 바닥에 있으므로 이만큼 내려서 배치한다. */
    draft: number;
    /** 원본 모델의 선수가 +Z를 향하면 true. 프로젝트의 규약인 -Z에 맞춰서 뒤집는다. */
    bowTowardPositiveZ: boolean;
  };
  physics: {
    thrustAccel: number;
    reverseThrustRatio: number;
    surgeLinearDrag: number;
    surgeQuadraticDrag: number;
    swayDrag: number;
    rudderGain: number;
    propWashGain: number;
    yawLinearDrag: number;
    yawQuadraticDrag: number;
  };
  controls: {
    /** 스로틀 레버가 초당 움직이는 양 */
    throttleRate: number;
    /** 타가 초당 움직이는 양 */
    rudderRate: number;
  };
  motion: {
    /** 선회할 때의 기울기 계수. 양수이면 선회의 바깥쪽으로 기울어진다. */
    heelGain: number;
    /** 선체가 수면의 변화를 따라가는 빠르기 (1/s). 값이 작을수록 무겁고 둔하게 움직인다. */
    waveResponse: number;
    /** 수면의 좌우 기울기 중에서 선체의 횡동요로 반영하는 비율 */
    rollRatio: number;
  };
  camera: {
    distance: number;
    minDistance: number;
    maxDistance: number;
    targetHeight: number;
  };
}

/**
 * Kenney Watercraft Kit의 여객선 모델(CC0).
 * 원본의 비율이 실제 선박보다 짧고 높아서, 폭이 약 40m가 되는 길이로 맞췄다.
 * 실제 선박의 수치를 그대로 적용하면 조종이 지나치게 느리므로, 가속과 선회를 게임에 맞춰서 과장했다.
 * 최고 속력은 약 30노트이고 정지 상태에서 약 20초 만에 도달하며, 전속에서의 선회 반경은 약 230m이다.
 */
export const OCEAN_LINER: ShipSpec = {
  model: {
    url: '/models/kenney-watercraft/ship-ocean-liner.glb',
    sourceLength: 21.28,
    length: 180,
    beam: 40,
    draft: 8.5,
    bowTowardPositiveZ: true,
  },
  physics: {
    thrustAccel: 1.0,
    reverseThrustRatio: 0.5,
    surgeLinearDrag: 0.01,
    surgeQuadraticDrag: 0.0035,
    swayDrag: 0.8,
    rudderGain: 0.0026,
    propWashGain: 0.008,
    yawLinearDrag: 0.5,
    yawQuadraticDrag: 1.0,
  },
  controls: {
    throttleRate: 0.8,
    rudderRate: 0.8,
  },
  motion: {
    heelGain: 0.05,
    waveResponse: 1.2,
    rollRatio: 0.6,
  },
  camera: {
    distance: 420,
    minDistance: 120,
    maxDistance: 1500,
    targetHeight: 20,
  },
};
