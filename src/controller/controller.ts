import './controller.css';
import { formatRaceTime } from '../ui/raceHud';
import { canRunCommand, decodeSituation, encodeCommand, type ControllerCommand, type GameSituation } from './commands';
import { connectToGame, LINK_STATUS_LABELS, type LinkStatus } from './link';
import { peerIdFromUrl } from './pairing';
import { decodeShipStatus, encodeHelm, type HelmMessage } from './protocol';
import { controllerScreen, helmForScreen, type ControllerScreen } from './screens';
import { rudderFromRoll, screenRoll, smoothRoll } from './tilt';

// 게임은 메시지가 0.5초 끊기면 키보드로 돌아가므로, 그보다 충분히 자주 보낸다.
const SEND_INTERVAL_MS = 1000 / 30;

// 페이지를 열 때마다 새 session을 정해서, 게임이 다시 연 컨트롤러의 누적 값을 이어 붙이지 않게 한다.
const helm: HelmMessage = {
  throttleRate: 0,
  rudder: 0,
  neutralCount: 0,
  resetCount: 0,
  viewResetCount: 0,
  viewX: 0,
  viewY: 0,
  session: Math.random().toString(36).slice(2),
};

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

// ---- 시점 ----

// 왼쪽 영역을 끈 거리를 누적해서 보낸다. 게임은 직전 메시지와의 차이만큼 시점을 돌리므로, 메시지를 잃어도 끈 만큼은 반영된다.
// 아이폰의 터치 이벤트는 movementX를 주지 않는 경우가 있어서, 직전 좌표와의 차이로 끈 거리를 구한다.
const viewPad = $('#view-pad');
let dragPointer: number | undefined;
let dragLast = { x: 0, y: 0 };
viewPad.addEventListener('pointerdown', (event) => {
  if (dragPointer !== undefined || event.target !== viewPad) return;
  dragPointer = event.pointerId;
  dragLast = { x: event.clientX, y: event.clientY };
  viewPad.setPointerCapture(event.pointerId);
  viewPad.classList.add('dragging');
});
viewPad.addEventListener('pointermove', (event) => {
  if (event.pointerId !== dragPointer) return;
  helm.viewX += event.clientX - dragLast.x;
  helm.viewY += event.clientY - dragLast.y;
  dragLast = { x: event.clientX, y: event.clientY };
});
const endDrag = (event: PointerEvent) => {
  if (event.pointerId !== dragPointer) return;
  dragPointer = undefined;
  viewPad.classList.remove('dragging');
};
viewPad.addEventListener('pointerup', endDrag);
viewPad.addEventListener('pointercancel', endDrag);
viewPad.addEventListener('lostpointercapture', endDrag);
$('#view-reset').addEventListener('click', () => helm.viewResetCount++);

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
  resetButton.hidden = !capsized;
}

// ---- 기울기 조타 ----

const rudderValue = $<HTMLOutputElement>('#rudder-value');
const rudderFill = $('#rudder-fill');
const wheelRim = $('#wheel-rim');
const enableTilt = $<HTMLButtonElement>('#enable-tilt');
const tiltHint = $('#tilt-hint');

// 센서는 손의 미세한 떨림까지 재므로, 각도를 부드럽게 따라간 값으로 타와 화면을 정한다.
let smoothedRoll: number | undefined;
let lastMotionAt: number | undefined;

function onMotion(event: DeviceMotionEvent): void {
  const gravity = event.accelerationIncludingGravity;
  if (gravity?.x == null || gravity.y == null) return;
  // 앱을 잠시 벗어났다 돌아오면 간격이 길어지므로, 0.5초를 넘으면 그 사이를 따라가지 않고 지금 값에서 다시 시작한다.
  const dt = lastMotionAt === undefined ? 0 : (event.timeStamp - lastMotionAt) / 1000;
  lastMotionAt = event.timeStamp;
  if (dt > 0.5) smoothedRoll = undefined;
  const roll = (smoothedRoll = smoothRoll(smoothedRoll, screenRoll({ x: gravity.x, y: gravity.y }, screenAngle()), dt));
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
  if (window.screen.orientation) return window.screen.orientation.angle;
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

// ---- 화면 꺼짐 방지 ----

// 기울기로만 조타하면 화면을 만지지 않는 시간이 길어서, 자동 잠금으로 화면이 꺼지고 연결이 끊긴다.
// 다른 앱에 다녀오면 잠금이 풀리므로 돌아올 때마다 다시 요청한다. 지원하지 않는 브라우저에서는 그냥 넘어간다.
async function keepScreenOn(): Promise<void> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    await navigator.wakeLock.request('screen');
  } catch {
    // 배터리 절약 모드처럼 브라우저가 거절하는 경우가 있다. 조종에는 지장이 없으므로 무시한다.
  }
}
void keepScreenOn();
document.addEventListener('visibilitychange', () => void keepScreenOn());
// 사용자가 화면을 만진 뒤에만 허락하는 브라우저도 있으므로, 처음 만질 때 한 번 더 요청한다.
document.addEventListener('pointerdown', () => void keepScreenOn(), { once: true });

// ---- 상황별 화면 ----

// 게임이 마지막으로 알려 준 상황. 핸드폰의 화면을 상황에 맞게 바꾸는 데 쓴다.
let situation: GameSituation | undefined;
let linkStatus: LinkStatus = 'connecting';
let menuOpen = false;
/** 시작 화면에서 "타임어택"을 눌러 코스 목록을 보고 있으면 true */
let pickingCourse = false;
let currentScreen: ControllerScreen = 'waiting';

const overlay = $('#overlay');
const raceInfo = $('#race-info');
const countdown = $('#countdown');
// 덮는 화면을 마지막으로 그린 내용. 같으면 다시 그리지 않아서, 누르고 있는 버튼이 바뀌어 눌림이 사라지지 않게 한다.
let overlayKey = '';

$('#menu-open').addEventListener('click', () => {
  menuOpen = true;
  render();
});

/** 상황이나 연결 상태가 바뀔 때마다 화면을 다시 정한다. */
function render(): void {
  const screen = (currentScreen = controllerScreen(situation, menuOpen));
  if (screen !== 'start') pickingCourse = false;
  // 메뉴는 조종 화면 위에서만 열리므로, 시작이나 결과 화면으로 넘어가면 닫힌 것으로 둔다.
  if (screen !== 'menu' && screen !== 'drive') menuOpen = false;
  document.body.dataset.screen = screen;

  const race = situation?.race;
  raceInfo.hidden = situation?.scene !== 'racing' || !race;
  if (race && !raceInfo.hidden) raceInfo.textContent = `${race.courseName} · ${formatRaceTime(race.elapsed ?? 0)}`;
  countdown.hidden = situation?.scene !== 'countdown' || race?.countdown === undefined;
  if (!countdown.hidden) countdown.textContent = String(race?.countdown);

  overlay.hidden = screen === 'drive';
  if (overlay.hidden) {
    overlayKey = '';
    return;
  }
  // 지난 시간처럼 자주 바뀌지만 이 화면에 보이지 않는 값은 빼고 비교한다.
  const key = JSON.stringify([
    screen,
    pickingCourse,
    linkStatus,
    { ...situation, race: race && { ...race, elapsed: 0 } },
  ]);
  if (key === overlayKey) return;
  overlayKey = key;
  overlay.className = 'overlay';
  overlay.replaceChildren(...buildOverlay(screen));
}

function buildOverlay(current: ControllerScreen): Node[] {
  switch (current) {
    case 'waiting':
      overlay.classList.add('overlay-center');
      return [
        heading('h2', 'PC의 게임과 연결하는 중'),
        paragraph(`${LINK_STATUS_LABELS[linkStatus]} · 잠시만 기다려 주세요.`),
      ];
    case 'loading':
      overlay.classList.add('overlay-center');
      return [
        heading('h2', 'PC에서 게임을 불러오는 중'),
        paragraph('준비가 끝나면 이 화면에서 바로 시작할 수 있습니다.'),
      ];
    case 'start':
      return pickingCourse ? buildCoursePicker() : buildStart();
    case 'result':
      return buildResult();
    case 'menu':
      return buildMenu();
    default:
      return [];
  }
}

function buildStart(): Node[] {
  overlay.classList.add('overlay-center');
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  const race = tile('타임어택', undefined, () => {
    pickingCourse = true;
    render();
  });
  race.disabled = !canSend();
  actions.append(commandTile('항해 시작', undefined, { kind: 'startSailing' }, 'primary'), race);
  return [heading('h1', 'Namhae Sail'), paragraph('PC 화면을 보면서 핸드폰으로 시작하세요.'), actions];
}

function buildCoursePicker(): Node[] {
  const back = tile('뒤로', undefined, () => {
    pickingCourse = false;
    render();
  });
  back.classList.add('close');
  const head = document.createElement('div');
  head.className = 'overlay-head';
  head.append(heading('h2', '타임어택 코스'), back);
  const list = column();
  for (const course of situation?.courses ?? []) {
    list.append(commandTile(course.name, course.note, { kind: 'startRace', courseId: course.id }));
  }
  return [head, list];
}

function buildResult(): Node[] {
  overlay.classList.add('overlay-center');
  const race = situation?.race;
  const record = document.createElement('div');
  record.className = 'record';
  record.textContent = race?.time === undefined ? '—' : formatRaceTime(race.time);
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.append(
    commandTile('다시 도전', undefined, { kind: 'retryRace' }, 'primary'),
    commandTile('자유 항해', undefined, { kind: 'quitRace' }),
  );
  return [heading('h2', race?.courseName ?? '타임어택'), record, actions];
}

function buildMenu(): Node[] {
  const close = tile('닫기', undefined, () => {
    menuOpen = false;
    render();
  });
  close.classList.add('close');
  const head = document.createElement('div');
  head.className = 'overlay-head';
  head.append(heading('h2', '메뉴'), close);

  const races = column('타임어택');
  const racing = situation?.scene === 'countdown' || situation?.scene === 'racing';
  if (racing) races.append(commandTile('그만두기', '자유 항해로 돌아갑니다', { kind: 'quitRace' }, 'quit', true));
  for (const course of situation?.courses ?? []) {
    races.append(commandTile(course.name, course.note, { kind: 'startRace', courseId: course.id }, undefined, true));
  }

  const starts = column('시작 위치');
  for (const start of situation?.starts ?? []) {
    starts.append(commandTile(start.name, start.note, { kind: 'moveToStart', startId: start.id }, undefined, true));
  }

  // 파도 세기와 소리는 여러 번 바꿔 보도록 메뉴를 닫지 않는다.
  const settings = column('파도 세기');
  const levels = document.createElement('div');
  levels.className = 'levels';
  for (let level = 1; level <= 5; level++) {
    const button = commandTile(String(level), undefined, { kind: 'setSeaLevel', level });
    button.classList.toggle('selected', situation?.seaLevel === level);
    levels.append(button);
  }
  settings.append(levels);
  if (situation?.seaLevelLocked) settings.append(paragraph('타임어택을 하는 동안에는 파도 세기를 바꿀 수 없습니다.'));
  const soundHeading = heading('h3', '소리');
  soundHeading.style.marginTop = '8px';
  const soundOn = situation?.soundOn ?? true;
  settings.append(
    soundHeading,
    commandTile(soundOn ? '소리 켜짐' : '소리 꺼짐', '눌러서 바꿉니다', { kind: 'setSound', on: !soundOn }),
  );

  const grid = document.createElement('div');
  grid.className = 'menu-grid';
  grid.append(races, starts, settings);
  return [head, grid];
}

/** 명령을 보내는 버튼. 지금 상황에서 할 수 없거나 연결이 끊겨 있으면 누를 수 없다. */
function commandTile(
  label: string,
  note: string | undefined,
  command: ControllerCommand,
  variant?: 'primary' | 'quit',
  closesMenu = false,
): HTMLButtonElement {
  const button = tile(label, note, () => {
    if (!sendCommand(command)) return;
    if (closesMenu) {
      menuOpen = false;
      render();
    }
  });
  if (variant) button.classList.add(variant);
  button.disabled = !canSend() || !situation || !canRunCommand(command, situation);
  return button;
}

function tile(label: string, note: string | undefined, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile';
  button.textContent = label;
  if (note) {
    const small = document.createElement('small');
    small.textContent = note;
    button.append(small);
  }
  button.addEventListener('click', onClick);
  return button;
}

function column(title?: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'menu-column';
  if (title) element.append(heading('h3', title));
  return element;
}

function heading(tag: 'h1' | 'h2' | 'h3', text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function paragraph(text: string): HTMLElement {
  const element = document.createElement('p');
  element.textContent = text;
  return element;
}

/** 연결이 끊긴 동안에는 명령을 보내지 않는다. 끊긴 동안 누른 명령을 모아 두었다가 나중에 보내지 않는다. */
function canSend(): boolean {
  return linkStatus === 'connected';
}

function sendCommand(command: ControllerCommand): boolean {
  return canSend() && link.sendCommand(encodeCommand(command));
}

// ---- 연결 ----

// 주소에 게임 ID가 있으면 QR 코드로 연 핸드폰이므로 그 게임에 연결하고, 없으면 같은 PC의 게임 탭에 보낸다.
const statusElement = $('#status');
const linkNotice = $('#link-notice');
const link = connectToGame(
  peerIdFromUrl(location.href),
  (status, notice) => {
    linkStatus = status;
    statusElement.dataset.status = status;
    statusElement.textContent = LINK_STATUS_LABELS[status];
    linkNotice.textContent = notice ?? '';
    linkNotice.hidden = !notice;
    render();
  },
  (text) => {
    showShipStatus(text);
    const next = decodeSituation(text);
    if (!next) return;
    situation = next;
    render();
  },
);
render();

// 값이 바뀔 때만 보내지 않고 계속 보낸다. 게임은 메시지가 계속 오는 것으로 컨트롤러가 살아 있다고 판단한다.
// 조종 화면이 아닐 때는 레버를 밀지 않고 타를 가운데로 둔 값을 보내서, 메뉴를 고르는 동안 배가 움직이지 않게 한다.
window.setInterval(() => link.sendHelm(encodeHelm(helmForScreen(currentScreen, helm))), SEND_INTERVAL_MS);
