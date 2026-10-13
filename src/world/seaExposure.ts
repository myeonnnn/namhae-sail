import type { Exposure } from '../ocean/waves';
import { OPEN_SEA_FETCH, Shelter } from './shelter';

// 수십 km를 따라가며 재는 계산이고 배는 그 사이에 얼마 움직이지 않으므로, 이 간격(초)으로만 다시 잰다.
const MEASURE_INTERVAL = 0.5;

/**
 * 한 지점이 바람과 너울에 얼마나 열려 있는지를 추적한다. 섬에 가려진 곳에서는 파도가 낮아진다.
 * 육지의 격자를 만들기 전이거나 만들지 못했으면 열린 바다로 가정한다.
 */
export class SeaExposure implements Exposure {
  fetch = OPEN_SEA_FETCH;
  swellFetch = OPEN_SEA_FETCH;
  private shelter?: Shelter;
  private age = Infinity;

  /** @param onShelter 육지의 격자가 준비되면 한 번 호출된다. */
  constructor(onShelter?: (shelter: Shelter) => void) {
    void Shelter.load()
      .then((shelter) => {
        this.shelter = shelter;
        onShelter?.(shelter);
      })
      .catch((error) => console.warn('육지의 격자를 만들지 못했습니다. 파도가 섬에 가려지지 않습니다.', error));
  }

  /**
   * @param x, z 파도를 볼 지점 (월드 좌표). 보통은 배의 위치이다.
   * @param windFromDeg, swellFromDeg 바람과 너울이 오는 방향 (북쪽을 0으로 하는 시계 방향 각도)
   */
  update(frameTime: number, x: number, z: number, windFromDeg: number, swellFromDeg: number): void {
    this.age += frameTime;
    if (!this.shelter || this.age < MEASURE_INTERVAL) return;
    this.age = 0;
    this.fetch = this.shelter.fetch(x, z, windFromDeg);
    this.swellFetch = this.shelter.fetch(x, z, swellFromDeg);
  }
}
