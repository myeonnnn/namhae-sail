import './controller.css';
import { connectToGame, LINK_STATUS_LABELS } from './link';
import { peerIdFromUrl } from './pairing';
import { decodeShipStatus, encodeHelm, type HelmMessage } from './protocol';
import { rudderFromRoll, screenRoll } from './tilt';

// 게임은 메시지가 0.5초 끊기면 키보드로 돌아가므로, 그보다 충분히 자주 보낸다.
const SEND_INTERVAL_MS = 1000 / 30;

const helm: HelmMessage = { throttleRate: 0, rudder: 0, neutralCount: 0, resetCount: 0 };

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

// 길게 누르면 iOS가 띄우는 메뉴와 확대 돋보기를 막는다. 스로틀 버튼은 누르고 있는 것이 기본 동작이다.
document.addEventListener('contextmenu', (event) => event.preventDefault());

// ---- 확대 방지 ----

// 아이폰 Safari는 viewport의 user-scalable=no를 무시해서, 두 손가락으로 벌리거나 두 번 탭하면 화면이 확대된다.
// 이 페이지는 touch-action: none이라 확대된 뒤에는 다시 축소할 수도 없으므로, 확대 제스처를 막는다.
for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

// 그래도 확대되면(가로로 돌릴 때 Safari가 확대한 채로 두는 경우 등) viewport 설정을 다시 써서 원래 크기로 되돌린다.
// Safari는 viewport의 내용이 바뀌면 배율을 다시 계산한다.
const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
function resetZoom(): void {
  if (!viewportMeta || !window.visualViewport || window.visualViewport.scale <= 1.01) return;
  const content = viewportMeta.content;
  viewportMeta.content = `${content}, minimum-scale=1.0`;
  requestAnimationFrame(() => (viewportMeta.content = content));
}
window.visualViewport?.addEventListener('resize', resetZoom);
window.addEventListener('orientationchange', () => window.setTimeout(resetZoom, 300));

// ---- 스로틀 ----

/**
 * 누르고 있는 동안만 켜지는 버튼. 키보드의 W, S처럼 레버를 미는 방향만 정하고, 레버의 값은 게임이 정한다.
 * 손가락이 버튼 밖으로 미끄러져도 떼기 전까지는 누른 것으로 본다.
 */
function bindHold(button: HTMLElement, onChange: (held: boolean) => void): void {
  let pointer: number | undefined;
  button.addEventListener('pointerdown', (event) => {
    if (pointer !== undefined) return;
    pointer = event.pointerId;
    button.setPointerCapture(event.pointerId);
    button.classList.add('pressed');
    onChange(true);
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = undefined;
    button.classList.remove('pressed');
    onChange(false);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

const held = { up: false, down: false };
const updateThrottleRate = () => (helm.throttleRate = (held.up ? 1 : 0) - (held.down ? 1 : 0));
bindHold($('#throttle-up'), (value) => {
  held.up = value;
  updateThrottleRate();
});
bindHold($('#throttle-down'), (value) => {
  held.down = value;
  updateThrottleRate();
});

// 중립과 복구는 누른 횟수를 보낸다. 메시지를 잃어도 다음 메시지에서 늘어난 횟수로 전해진다.
$('#neutral').addEventListener('click', () => helm.neutralCount++);
$('#reset').addEventListener('click', () => helm.resetCount++);

const throttleValue = $<HTMLOutputElement>('#throttle-value');
const gaugeFill = $('#gauge-fill');
const resetButton = $('#reset');

function showShipStatus(text: string): void {
  const status = decodeShipStatus(text);
  if (!status) return;
  const { throttle, capsized } = status;
  const percent = Math.round(Math.abs(throttle) * 100);
  throttleValue.value = percent === 0 ? '중립' : `${throttle > 0 ? '전진' : '후진'} ${percent}%`;
  // 눈금은 가운데에서 위(전진)나 아래(후진)로 채운다.
  gaugeFill.style.top = `${50 - Math.max(0, throttle) * 50}%`;
  gaugeFill.style.height = `${Math.abs(throttle) * 50}%`;
  gaugeFill.style.background = throttle >= 0 ? 'var(--ahead)' : 'var(--astern)';
  resetButton.classList.toggle('alert', capsized);
}

// ---- 기울기 조타 ----

const rudderValue = $<HTMLOutputElement>('#rudder-value');
const rudderFill = $('#rudder-fill');
const wheelRim = $('#wheel-rim');
const enableTilt = $<HTMLButtonElement>('#enable-tilt');
const tiltHint = $('#tilt-hint');

function onMotion(event: DeviceMotionEvent): void {
  const gravity = event.accelerationIncludingGravity;
  if (gravity?.x == null || gravity.y == null) return;
  const roll = screenRoll({ x: gravity.x, y: gravity.y }, screenAngle());
  helm.rudder = rudderFromRoll(roll);
  const percent = Math.round(Math.abs(helm.rudder) * 100);
  rudderValue.value = percent === 0 ? '0%' : `${helm.rudder > 0 ? '우현' : '좌현'} ${percent}%`;
  // 막대는 가운데에서 돌린 쪽으로 채우고, 핸들은 돌린 각도만큼 함께 돌려 보여 준다.
  rudderFill.style.left = `${50 + Math.min(0, helm.rudder) * 50}%`;
  rudderFill.style.width = `${Math.abs(helm.rudder) * 50}%`;
  rudderFill.style.background = helm.rudder >= 0 ? 'var(--starboard)' : 'var(--port)';
  wheelRim.style.setProperty('--roll', `${roll}deg`);
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
  tiltHint.hidden = true;
  document.body.classList.remove('tilt-off');
}

// 아이폰은 사용자가 버튼을 눌렀을 때만 센서 권한을 물을 수 있고, HTTPS 페이지에서만 센서 값을 준다.
type MotionWithPermission = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const motion = (window as { DeviceMotionEvent?: MotionWithPermission }).DeviceMotionEvent;
if (!window.isSecureContext) {
  tiltHint.textContent = 'HTTPS 주소에서만 기울기를 쓸 수 있습니다.';
} else if (motion?.requestPermission) {
  // 처음 연 사람은 무엇을 눌러야 할지 모르므로, 권한을 받기 전까지 버튼이 숨 쉬듯 커지고 핸들이 좌우로 흔들린다.
  enableTilt.hidden = false;
  document.body.classList.add('tilt-off');
  tiltHint.textContent = '버튼을 누르면 핸드폰을 핸들처럼 돌려서 조타합니다.';
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

// ---- 연결 ----

// 주소에 게임 ID가 있으면 QR 코드로 연 핸드폰이므로 그 게임에 연결하고, 없으면 같은 PC의 게임 탭에 보낸다.
const statusElement = $('#status');
const linkNotice = $('#link-notice');
const send = connectToGame(
  peerIdFromUrl(location.href),
  (status, notice) => {
    statusElement.dataset.status = status;
    statusElement.textContent = LINK_STATUS_LABELS[status];
    linkNotice.textContent = notice ?? '';
    linkNotice.hidden = !notice;
  },
  showShipStatus,
);

// 값이 바뀔 때만 보내지 않고 계속 보낸다. 게임은 메시지가 계속 오는 것으로 컨트롤러가 살아 있다고 판단한다.
window.setInterval(() => send(encodeHelm(helm)), SEND_INTERVAL_MS);
