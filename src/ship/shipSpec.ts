/** 선박 한 종류의 외형과 조종 특성을 정의한다. 힘은 모두 질량으로 나눈 가속도 단위이다. */
export interface ShipSpec {
  model: {
    url: string;
    /** 원본 모델의 길이 (모델 단위) */
    sourceLength: number;
    /** 월드에서의 길이 (m) */
    length: number;
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
    heaveAmplitude: number;
    heavePeriod: number;
    pitchAmplitude: number;
    pitchPeriod: number;
    rollAmplitude: number;
    rollPeriod: number;
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
 * 최고 속력은 약 22노트이고, 전속에서의 선회 반경은 약 380m이다.
 */
export const OCEAN_LINER: ShipSpec = {
  model: {
    url: '/models/kenney-watercraft/ship-ocean-liner.glb',
    sourceLength: 21.28,
    length: 180,
    draft: 8.5,
    bowTowardPositiveZ: true,
  },
  physics: {
    thrustAccel: 0.25,
    reverseThrustRatio: 0.5,
    surgeLinearDrag: 0.004,
    surgeQuadraticDrag: 0.0016,
    swayDrag: 0.5,
    rudderGain: 0.0004,
    propWashGain: 0.0015,
    yawLinearDrag: 0.15,
    yawQuadraticDrag: 2.0,
  },
  controls: {
    throttleRate: 0.4,
    rudderRate: 0.4,
  },
  motion: {
    heelGain: 0.15,
    heaveAmplitude: 0.3,
    heavePeriod: 11,
    pitchAmplitude: 0.004,
    pitchPeriod: 9,
    rollAmplitude: 0.01,
    rollPeriod: 14,
  },
  camera: {
    distance: 420,
    minDistance: 120,
    maxDistance: 1500,
    targetHeight: 20,
  },
};
