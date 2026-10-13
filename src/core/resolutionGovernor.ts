// 해상도를 바꾸는 한 단계 (CSS 픽셀에 대한 배율)
const STEP = 0.25;
// 프레임 시간(초)의 평균이 이보다 길면 느린 것으로, 이보다 짧으면 여유가 있는 것으로 본다. 각각 초당 48프레임과 57프레임에 해당한다.
const SLOW_FRAME = 1 / 48;
const FAST_FRAME = 1 / 57;
// 프레임 시간을 이 길이(초)의 구간마다 평균해서 판단한다. 한두 프레임이 튀는 것에는 반응하지 않게 한다.
const WINDOW = 1;
// 느린 구간이 이 횟수만큼 이어지면 해상도를 낮춘다.
const SLOW_WINDOWS = 2;
// 여유가 있는 상태가 이 시간(초) 동안 이어지면 해상도를 한 단계 올려 본다.
const RAISE_WAIT = 8;
const MAX_RAISE_WAIT = 120;
// 올린 뒤에 이 시간(초) 안에 다시 느려지면, 그 해상도는 감당하지 못하는 것으로 본다.
const FAILED_RAISE_WINDOW = 6;
// 해상도를 바꾼 직후에는 버퍼를 다시 만드느라 프레임이 흔들리므로, 이 시간(초) 동안은 판단하지 않는다.
const SETTLE = 1;
// 이보다 긴 프레임(초)은 탭을 전환했거나 자료를 불러오느라 잠깐 멈춘 것이므로 판단에서 제외한다.
const HITCH = 0.09;

/**
 * 프레임이 느려지면 장면을 그리는 해상도를 낮추고, 여유가 생기면 다시 올린다.
 *
 * 수면과 하늘은 픽셀마다 계산하는 양이 많아서, 그리는 비용이 픽셀의 수에 거의 비례한다.
 * 창의 크기와 화면의 배율, GPU의 성능은 기기마다 다르므로, 해상도를 고정하지 않고 실제 프레임 시간을 보고 맞춘다.
 * 해상도가 오르내리기를 되풀이하지 않도록, 올렸다가 곧 다시 느려지면 다음에는 더 오래 기다린 뒤에 올린다.
 */
export class ResolutionGovernor {
  /** 지금 사용할 해상도 (CSS 픽셀에 대한 배율) */
  ratio: number;
  private readonly minRatio: number;
  private windowTime = 0;
  private windowFrames = 0;
  private slowWindows = 0;
  private fastFor = 0;
  private settling = 0;
  private raiseWait = RAISE_WAIT;
  private sinceRaise = Infinity;

  /**
   * @param maxRatio 해상도의 상한. 화면의 배율보다 높게 그려도 보이는 것이 달라지지 않는다.
   * @param minRatio 해상도의 하한. 이보다 낮추면 화면이 눈에 띄게 흐려진다.
   */
  constructor(
    private readonly maxRatio: number,
    minRatio = 1,
  ) {
    this.minRatio = Math.min(minRatio, maxRatio);
    this.ratio = maxRatio;
  }

  /**
   * 한 프레임에 걸린 시간(초)을 알려 준다. 매 프레임 호출한다.
   * @returns 해상도를 바꿔야 하면 새 배율을, 그대로이면 undefined를 반환한다.
   */
  update(frameTime: number): number | undefined {
    if (frameTime >= HITCH) return undefined;
    this.sinceRaise += frameTime;
    if (this.settling > 0) {
      this.settling -= frameTime;
      return undefined;
    }

    this.windowTime += frameTime;
    this.windowFrames++;
    if (this.windowTime < WINDOW) return undefined;
    const average = this.windowTime / this.windowFrames;
    this.slowWindows = average > SLOW_FRAME ? this.slowWindows + 1 : 0;
    this.fastFor = average < FAST_FRAME ? this.fastFor + this.windowTime : 0;
    this.windowTime = 0;
    this.windowFrames = 0;

    if (this.slowWindows >= SLOW_WINDOWS && this.ratio > this.minRatio) {
      if (this.sinceRaise < FAILED_RAISE_WINDOW) this.raiseWait = Math.min(this.raiseWait * 2, MAX_RAISE_WAIT);
      return this.change(Math.max(this.ratio - STEP, this.minRatio));
    }
    if (this.fastFor >= this.raiseWait && this.ratio < this.maxRatio) {
      this.sinceRaise = 0;
      return this.change(Math.min(this.ratio + STEP, this.maxRatio));
    }
    return undefined;
  }

  private change(ratio: number): number {
    this.ratio = ratio;
    this.slowWindows = 0;
    this.fastFor = 0;
    this.windowTime = 0;
    this.windowFrames = 0;
    this.settling = SETTLE;
    return ratio;
  }
}
