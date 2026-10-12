const FIXED_DT = 1 / 60;
// 탭이 비활성화되었다가 돌아왔을 때 물리 스텝이 한꺼번에 몰리지 않도록 프레임 시간을 제한한다.
const MAX_FRAME_TIME = 0.1;

export interface LoopHandlers {
  /** 고정된 시간 간격으로 호출되는 물리 갱신 */
  update(dt: number): void;
  /** 화면 주사율마다 한 번씩 호출되는 렌더링 */
  render(frameTime: number, elapsed: number): void;
}

export function startLoop({ update, render }: LoopHandlers): void {
  let previous = performance.now();
  let accumulator = 0;
  let elapsed = 0;

  const frame = (now: number) => {
    const frameTime = Math.min((now - previous) / 1000, MAX_FRAME_TIME);
    previous = now;
    accumulator += frameTime;
    elapsed += frameTime;

    while (accumulator >= FIXED_DT) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    render(frameTime, elapsed);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
