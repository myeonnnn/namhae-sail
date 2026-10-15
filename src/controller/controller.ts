import './controller.css';
import { connectToGame, LINK_STATUS_LABELS } from './link';
import { peerIdFromUrl } from './pairing';
import { encodeHelm, type HelmMessage } from './protocol';
import { rudderFromRoll, screenRoll } from './tilt';

// 게임은 메시지가 0.5초 끊기면 키보드로 돌아가므로, 그보다 충분히 자주 보낸다.
const SEND_INTERVAL_MS = 1000 / 30;

const helm: HelmMessage = { throttle: 0, rudder: 0 };

// ---- 스로틀 ----

/**
 * 끌어서 -1~1의 값을 정하는 세로 슬라이더. 위가 +1이고, 손을 떼도 그 위치에 머무른다.
 * 기본 range 입력은 세로로 세우기 어렵고 핸드폰마다 모양이 달라서, 포인터 이벤트로 직접 만든다.
 */
function bindThrottle(track: HTMLElement, onChange: (value: number) => void): (value: number) => void {
  const thumb = track.querySelector<HTMLElement>('.thumb')!;
  let activePointer: number | undefined;

  const set = (value: number) => {
    thumb.style.setProperty('--pos', String((1 - value) / 2));
    thumb.classList.toggle('ahead', value > 0);
    thumb.classList.toggle('astern', value < 0);
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    onChange(value);
  };

  const valueAt = (event: PointerEvent): number => {
    const rect = track.getBoundingClientRect();
    // 손잡이의 가운데가 손가락 아래에 오도록, 손잡이의 크기만큼 움직일 수 있는 범위를 줄인다.
    const thumbSize = thumb.offsetHeight;
    const t = (event.clientY - rect.top - thumbSize / 2) / (rect.height - thumbSize);
    return 1 - 2 * Math.min(1, Math.max(0, t));
  };

  track.addEventListener('pointerdown', (event) => {
    if (activePointer !== undefined) return;
    activePointer = event.pointerId;
    track.setPointerCapture(event.pointerId);
    set(valueAt(event));
  });
  track.addEventListener('pointermove', (event) => {
    if (event.pointerId === activePointer) set(valueAt(event));
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId === activePointer) activePointer = undefined;
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);

  set(0);
  return set;
}

const throttleValue = document.querySelector<HTMLOutputElement>('#throttle-value')!;
const setThrottle = bindThrottle(document.querySelector<HTMLElement>('#throttle')!, (value) => {
  helm.throttle = value;
  throttleValue.value = `${Math.round(value * 100)}%`;
});
document.querySelector<HTMLButtonElement>('#neutral')!.addEventListener('click', () => setThrottle(0));

// ---- 기울기 조타 ----

const rudderValue = document.querySelector<HTMLOutputElement>('#rudder-value')!;
const rudderFill = document.querySelector<HTMLElement>('#rudder-fill')!;
const wheelSpoke = document.querySelector<HTMLElement>('#wheel-spoke')!;
const enableTilt = document.querySelector<HTMLButtonElement>('#enable-tilt')!;
const tiltHint = document.querySelector<HTMLElement>('#tilt-hint')!;

let roll = 0;
let zero = 0;

function showRudder(): void {
  const rudder = helm.rudder;
  rudderValue.value = `${rudder > 0 ? '우현' : rudder < 0 ? '좌현' : ''} ${Math.round(Math.abs(rudder) * 100)}%`.trim();
  // 막대는 가운데에서 돌린 쪽으로 채운다.
  rudderFill.style.left = `${50 + Math.min(0, rudder) * 50}%`;
  rudderFill.style.width = `${Math.abs(rudder) * 50}%`;
  rudderFill.style.background = rudder >= 0 ? 'var(--starboard)' : 'var(--port)';
  wheelSpoke.style.setProperty('--roll', `${roll - zero}deg`);
}

function onMotion(event: DeviceMotionEvent): void {
  const gravity = event.accelerationIncludingGravity;
  if (gravity?.x == null || gravity.y == null) return;
  roll = screenRoll({ x: gravity.x, y: gravity.y }, screenAngle());
  helm.rudder = rudderFromRoll(roll, zero);
  showRudder();
}

/** 화면이 돌아간 각도. 아이폰의 오래된 Safari에는 screen.orientation이 없어서 window.orientation을 쓴다. */
function screenAngle(): number {
  if (screen.orientation) return screen.orientation.angle;
  const legacy = (window as { orientation?: number }).orientation ?? 0;
  return (legacy + 360) % 360;
}

function startTilt(): void {
  window.addEventListener('devicemotion', onMotion);
  enableTilt.hidden = true;
}

// 아이폰은 사용자가 버튼을 눌렀을 때만 센서 권한을 물을 수 있고, HTTPS 페이지에서만 센서 값을 준다.
type MotionWithPermission = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const motion = (window as { DeviceMotionEvent?: MotionWithPermission }).DeviceMotionEvent;
if (!window.isSecureContext) {
  tiltHint.textContent = 'HTTPS 주소에서만 기울기를 쓸 수 있습니다.';
} else if (motion?.requestPermission) {
  enableTilt.hidden = false;
  enableTilt.addEventListener('click', () => {
    motion.requestPermission!()
      .then((state) => {
        if (state === 'granted') startTilt();
        else tiltHint.textContent = '기울기 권한이 거부되었습니다. Safari 설정에서 허용해 주세요.';
      })
      .catch(() => (tiltHint.textContent = '기울기 권한을 요청하지 못했습니다.'));
  });
} else {
  startTilt();
}

// 영점 버튼을 누르면 지금 쥐고 있는 각도를 가운데로 삼는다. 비스듬히 쥐어도 편한 자세에서 조타할 수 있다.
document.querySelector<HTMLButtonElement>('#zero')!.addEventListener('click', () => {
  zero = roll;
  helm.rudder = rudderFromRoll(roll, zero);
  showRudder();
});
showRudder();

// ---- 전송 ----

// 주소에 게임 ID가 있으면 QR 코드로 연 핸드폰이므로 그 게임에 연결하고, 없으면 같은 PC의 게임 탭에 보낸다.
const statusElement = document.querySelector<HTMLElement>('#status')!;
const send = connectToGame(peerIdFromUrl(location.href), (status) => {
  statusElement.dataset.status = status;
  statusElement.textContent = LINK_STATUS_LABELS[status];
});

// 값이 바뀔 때만 보내지 않고 계속 보낸다. 게임은 메시지가 계속 오는 것으로 컨트롤러가 살아 있다고 판단한다.
window.setInterval(() => send(encodeHelm(helm)), SEND_INTERVAL_MS);
