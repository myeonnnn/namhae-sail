import './controller.css';
import { connectToGame, LINK_STATUS_LABELS } from './link';
import { peerIdFromUrl } from './pairing';
import { encodeHelm, type HelmMessage } from './protocol';

// 게임은 메시지가 0.5초 끊기면 키보드로 돌아가므로, 그보다 충분히 자주 보낸다.
const SEND_INTERVAL_MS = 1000 / 30;

const helm: HelmMessage = { throttle: 0, rudder: 0 };

/**
 * 끌어서 -1~1의 값을 정하는 슬라이더.
 * 기본 range 입력은 세로로 세우기 어렵고 핸드폰마다 모양이 달라서, 포인터 이벤트로 직접 만든다.
 */
function bindSlider(
  track: HTMLElement,
  axis: 'vertical' | 'horizontal',
  onChange: (value: number) => void,
  options: { returnToCenter: boolean },
): (value: number) => void {
  const thumb = track.querySelector<HTMLElement>('.thumb')!;
  let activePointer: number | undefined;

  const show = (value: number) => {
    // 세로 슬라이더는 위가 +1이므로, 화면 좌표와 방향이 반대다.
    const pos = axis === 'vertical' ? (1 - value) / 2 : (value + 1) / 2;
    thumb.style.setProperty('--pos', String(pos));
    thumb.classList.toggle('ahead', axis === 'vertical' && value > 0);
    thumb.classList.toggle('astern', axis === 'vertical' && value < 0);
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)));
  };

  const set = (value: number) => {
    show(value);
    onChange(value);
  };

  const valueAt = (event: PointerEvent): number => {
    const rect = track.getBoundingClientRect();
    // 손잡이의 가운데가 손가락 아래에 오도록, 손잡이의 크기만큼 움직일 수 있는 범위를 줄인다.
    const thumbSize = axis === 'vertical' ? thumb.offsetHeight : thumb.offsetWidth;
    const length = (axis === 'vertical' ? rect.height : rect.width) - thumbSize;
    const offset = (axis === 'vertical' ? event.clientY - rect.top : event.clientX - rect.left) - thumbSize / 2;
    const t = Math.min(1, Math.max(0, offset / length));
    return axis === 'vertical' ? 1 - 2 * t : 2 * t - 1;
  };

  track.addEventListener('pointerdown', (event) => {
    if (activePointer !== undefined) return;
    activePointer = event.pointerId;
    track.setPointerCapture(event.pointerId);
    track.classList.add('dragging');
    set(valueAt(event));
  });
  track.addEventListener('pointermove', (event) => {
    if (event.pointerId === activePointer) set(valueAt(event));
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    activePointer = undefined;
    track.classList.remove('dragging');
    if (options.returnToCenter) set(0);
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);

  show(0);
  return set;
}

const throttleValue = document.querySelector<HTMLOutputElement>('#throttle-value')!;
const rudderValue = document.querySelector<HTMLOutputElement>('#rudder-value')!;

// 스로틀은 레버처럼 손을 떼도 그 위치에 머무르고, 타는 손을 떼면 가운데로 돌아온다.
const setThrottle = bindSlider(
  document.querySelector<HTMLElement>('#throttle')!,
  'vertical',
  (value) => {
    helm.throttle = value;
    throttleValue.value = `${Math.round(value * 100)}%`;
  },
  { returnToCenter: false },
);
bindSlider(
  document.querySelector<HTMLElement>('#rudder')!,
  'horizontal',
  (value) => {
    helm.rudder = value;
    rudderValue.value = `${Math.round(value * 100)}%`;
  },
  { returnToCenter: true },
);
document.querySelector<HTMLButtonElement>('#neutral')!.addEventListener('click', () => setThrottle(0));

// 주소에 게임 ID가 있으면 QR 코드로 연 핸드폰이므로 그 게임에 연결하고, 없으면 같은 PC의 게임 탭에 보낸다.
const statusElement = document.querySelector<HTMLElement>('#status')!;
const send = connectToGame(peerIdFromUrl(location.href), (status) => {
  statusElement.dataset.status = status;
  statusElement.textContent = LINK_STATUS_LABELS[status];
});

// 값이 바뀔 때만 보내지 않고 계속 보낸다. 게임은 메시지가 계속 오는 것으로 컨트롤러가 살아 있다고 판단한다.
window.setInterval(() => send(encodeHelm(helm)), SEND_INTERVAL_MS);
