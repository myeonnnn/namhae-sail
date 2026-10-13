import { BREAKING_STEEPNESS, sampleCrest, sampleWaveHeight } from '../ocean/waves';
import { apparentWind, type ShipState } from './shipPhysics';
import type { ShipSpec } from './shipSpec';

// 선체의 길이와 폭에 대한 비율로 표현한 수면의 측정 위치
const HULL_SAMPLES_ALONG = [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42];
const HULL_SAMPLES_ACROSS = [-0.35, 0, 0.35];
const SAMPLE_COUNT = HULL_SAMPLES_ALONG.length * HULL_SAMPLES_ACROSS.length;
// 빠르게 달릴수록 마루에 세게 부딪힌다. 속력이 이 값(m/s)만큼 늘 때마다 충격이 정지해 있을 때의 크기만큼 더해진다.
const IMPACT_SPEED_SCALE = 20;
// 고속으로 가파른 마루를 넘으면 선체가 떠올랐다가 떨어지면서, 파도를 받는 방향과 관계없이 기울어진 수면 쪽으로 넘어간다.
// 그 세기를 옆에서 맞을 때의 충격에 대한 비율로 정하고, 이 속력(m/s)에서 최대가 되게 한다.
const SLAM_SHARE = 0.25;
const SLAM_FULL_SPEED = 15;

/** 지금의 수면과 바람이 선체에 주는 영향 */
export interface SeaLoad {
  /** 선체가 놓인 수면의 평균 높이 (m) */
  heave: number;
  /** 수면의 앞뒤 기울기 (rad) */
  pitch: number;
  /** 수면의 좌우 기울기 (rad). 우현 쪽이 높으면 양수이다. */
  surfaceSlope: number;
  /** 선회와 바람, 부서지는 파도가 선체를 기울이는 힘. 잔잔한 물에서 만드는 기울기(rad)로 표현하며, 우현이 올라가는 쪽이 양수이다. */
  heeling: number;
  /** 부서지는 마루가 선체를 때리는 세기 (0 이상). 0이면 부서지는 파도를 맞고 있지 않다. */
  breaking: number;
}

const load: SeaLoad = { heave: 0, pitch: 0, surfaceSlope: 0, heeling: 0, breaking: 0 };

/**
 * 선체의 수선면에 격자 모양으로 점을 찍고, 각 점에서 읽은 수면의 높이에 평면을 맞춘다.
 * 평면의 평균 높이가 상하 움직임이, 앞뒤 기울기가 종동요가 되고, 좌우 기울기는 횡동요를 일으키는 힘이 된다.
 * 매 프레임 호출하므로 같은 객체를 다시 사용해서 반환한다.
 *
 * @param time 수면의 셰이더에 전달하는 시간과 같아야 한다.
 * @param wind 바람이 공기를 이동시키는 속도 (월드 좌표, m/s)
 */
export function measureSeaLoad(
  spec: ShipSpec,
  state: ShipState,
  wind: { x: number; z: number },
  time: number,
): SeaLoad {
  const { length, beam } = spec.model;
  const sin = Math.sin(state.heading);
  const cos = Math.cos(state.heading);

  let heightSum = 0;
  let alongMoment = 0;
  let alongSquare = 0;
  let acrossMoment = 0;
  let acrossSquare = 0;
  for (const along of HULL_SAMPLES_ALONG) {
    for (const across of HULL_SAMPLES_ACROSS) {
      const forward = along * length;
      const starboard = across * beam;
      const height = sampleWaveHeight(
        state.x + forward * sin + starboard * cos,
        state.z - forward * cos + starboard * sin,
        time,
      );
      heightSum += height;
      alongMoment += forward * height;
      alongSquare += forward * forward;
      acrossMoment += starboard * height;
      acrossSquare += starboard * starboard;
    }
  }
  load.heave = heightSum / SAMPLE_COUNT;
  load.pitch = Math.atan(alongMoment / alongSquare);
  load.surfaceSlope = Math.atan(acrossMoment / acrossSquare) * spec.motion.rollRatio;

  // 선회할 때의 기울기
  const turn = spec.motion.heelGain * state.yawRate * state.surge;

  // 옆바람은 수면 위의 선체를 바람이 불어 가는 쪽으로 민다. 우현 쪽으로 부는 바람은 우현을 내리누른다(음수).
  const { starboard: crosswind } = apparentWind(state, wind);
  const windHeel = -spec.motion.windHeel * crosswind * Math.abs(crosswind);

  // 부서지는 마루는 선체의 옆면을 때려서, 파도가 진행하는 쪽으로 선체를 넘어뜨린다.
  // 선수나 선미로 받으면 옆으로 미는 성분이 없어서, 천천히 갈 때에는 거의 기울지 않는다.
  const crest = sampleCrest(state.x, state.z, time);
  const speed = Math.hypot(state.surge, state.sway);
  const impact = Math.max(crest.steepness - BREAKING_STEEPNESS, 0) * (1 + speed / IMPACT_SPEED_SCALE);
  const towardStarboard = crest.dirX * cos + crest.dirZ * sin;
  const slam = SLAM_SHARE * Math.min(speed / SLAM_FULL_SPEED, 1);
  load.breaking = impact * (Math.abs(towardStarboard) + slam);
  const breakingHeel = spec.motion.breakingHeel * impact * (-towardStarboard + slam * Math.sign(load.surfaceSlope));

  load.heeling = turn + windHeel + breakingHeel;
  return load;
}
