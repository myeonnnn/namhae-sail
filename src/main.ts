import './style.css';
import { HelmHost } from './controller/link';
import {
  canRunCommand,
  decodeCommand,
  encodeSituation,
  type ControllerCommand,
  type GameScene,
  type GameSituation,
  type MenuItem,
} from './controller/commands';
import { decodeHelm, encodeShipStatus, isNewPress, viewDragDelta, type HelmMessage } from './controller/protocol';
import { checkRemoteLink, chooseHelm, isHelmKeyDown, keyboardHelm, type RemoteHelm } from './core/helm';
import { Input } from './core/input';
import { Observer } from './core/observer';
import { startLoop } from './core/loop';
import { createStage } from './core/renderer';
import { COURSES } from './course/course';
import { LocalRecordStore } from './course/records';
import { createTimeOfDay, sunPosition } from './environment/sun';
import { createWeather, updateWeather } from './environment/weather';
import { windVelocity } from './environment/wind';
import { Ocean, SHALLOW_RANGE } from './ocean/ocean';
import { Wake } from './ocean/wake';
import { currentWaveHeight, updateWaves } from './ocean/waves';
import { ChaseCamera } from './ship/chaseCamera';
import { respawnHeading } from './sim/respawn';
import { ImpactSpray } from './ship/impactSpray';
import { Ship } from './ship/ship';
import { SPORT_YACHT } from './ship/shipSpec';
import { AmbientSound } from './ui/ambientSound';
import { isMuted, playSplash } from './ui/sound';
import { createCourseList } from './ui/courseList';
import { createButton } from './ui/dom';
import { createDevTools } from './ui/devTools';
import { Guide } from './ui/guide';
import { PhonePanel } from './ui/phonePanel';
import { createKeyGuide } from './ui/keyGuide';
import { Hud } from './ui/hud';
import { RaceHud } from './ui/raceHud';
import { SeamarkInspector } from './ui/seamarkInspector';
import { createStartPointList } from './ui/startPoints';
import { StartScreen } from './ui/startScreen';
import { readStartOptions } from './dev/startOptions';
import { latLonToWorld, WORLD_ORIGIN } from './geo/projection';
import { isOutsideRegion, REGION, type StartPoint } from './geo/region';
import { TimeAttack } from './game/timeAttack';
import { Coach } from './sim/coach';
import { resolveCollisions } from './sim/collisions';
import { SeaEffects } from './sim/seaEffects';
import { loadChart } from './world/chartData';
import { loadSeamarkRecords } from './world/seamarkData';
import { Seamarks } from './world/seamarks';
import { SeaExposure } from './world/seaExposure';
import { Bridges } from './world/bridges';
import { CourseGates } from './world/courseGates';
import { Structures } from './world/structures';
import { Terrain } from './world/terrain';

// 조종할 선박. shipSpec.ts에 정의된 다른 선박으로 바꾸면 모델과 조종 특성, 카메라의 거리가 함께 바뀐다.
const SHIP = SPORT_YACHT;

// 운영 구역의 첫 번째 시작 지점에서 시작한다. 나머지 지점은 시작 위치 메뉴에서 골라서 이동할 수 있다.
const START = REGION.starts[0];

// 개발 도구(관찰 모드, 배의 순간 이동, 장소로 바로 이동, 주소로 시작 위치 지정)는 로컬의 개발 서버에서만 켠다.
// Vite는 배포용으로 빌드할 때 import.meta.env.DEV를 false로 바꾸므로, 이 조건으로 감싼 코드는 결과물에서 제거된다.
const DEV_TOOLS = import.meta.env.DEV;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const stage = createStage(canvas);
const { renderer, scene, camera } = stage;

const input = new Input();
const weather = createWeather();
const { wind, swell } = weather;
// 파도가 자라는 조건 가운데 위치에 따라 달라지는 값. 섬에 가려진 곳에서는 파도가 낮아진다.
// 육지의 격자가 준비되면, 해안에 가까운 수면을 얕은 물의 색으로 칠할 수 있도록 수면에 전달한다.
const exposure = new SeaExposure((shelter) => ocean.setShore(shelter.shoreMap(SHALLOW_RANGE)));
const timeOfDay = createTimeOfDay();
const wake = new Wake(renderer, SHIP.model);
const ocean = new Ocean(scene, renderer, wake);
const ship = new Ship(SHIP);
// (개발 서버에서만) 주소로 시작 위치와 방향을 지정할 수 있다.
const startOptions = readStartOptions(DEV_TOOLS, START);
const requestedPoint = latLonToWorld(startOptions);
Object.assign(ship.state, startOptions.observe ? latLonToWorld(START) : requestedPoint);
ship.state.heading = degToRad(startOptions.headingDeg);
scene.add(ship.object);

const terrain = new Terrain(scene);
const structures = new Structures(scene);
const bridges = new Bridges(scene);
// 등대와 등표는 방파제 위에 있으면 그 윗면에, 아니면 지형 위에 세운다.
const seamarks = new Seamarks(scene, (x, z) => structures.topNear(x, z, 8) ?? terrain.heightAt(x, z));

const chaseCamera = new ChaseCamera(camera, canvas, SHIP.camera);
chaseCamera.alignTo(ship.state.heading);
const hud = new Hud(document.querySelector<HTMLElement>('#hud')!, weather, timeOfDay, {
  // 레이더에 넓은 물체로 표시하는 것: 육지, 방파제와 부두, 그리고 선박이 지나갈 수 없을 만큼 낮은 다리.
  // 아래로 지나갈 수 있는 다리의 상판은 장애물이 아니므로 표시하지 않고, 실제로 부딪히는 교각만 점으로 표시한다.
  isSolid: (x, z) =>
    terrain.isLand(x, z) || structures.contains(x, z) || (bridges.clearanceAt(x, z) ?? Infinity) < SHIP.model.airDraft,
  *marks() {
    yield* seamarks.nearby();
    for (const pier of bridges.allPiers()) yield { x: pier.x, z: pier.z, structure: true };
  },
});
const world = { terrain, structures, bridges, seamarks };

// 화면에 잠시 표시하는 경고. HUD가 표시한 시각을 보고 일정 시간이 지나면 숨긴다.
const alert = { message: '', at: -Infinity };
function showAlert(message: string): void {
  alert.message = message;
  alert.at = performance.now();
}

// 조작대의 크기는 화면의 크기에 따라 달라지므로, 크기가 바뀔 때마다 카메라에 다시 알려 준다.
const syncBottomInset = () => stage.setBottomInset(hud.consoleHeight);
window.addEventListener('resize', syncBottomInset);
syncBottomInset();

const impactSpray = new ImpactSpray(scene);
// 이 속력(m/s)보다 느린 접촉은 연출 없이 경고만 표시한다. 육지에 닿은 채로 밀고 있을 때 매 스텝 반복되는 것을 막는다.
const MIN_IMPACT_SPEED = 1;
// 이 속력(m/s)에서 연출의 세기가 최대가 된다.
const FULL_IMPACT_SPEED = 15;
// 파도의 시각 (초). 수면의 셰이더와 부력, 부표의 움직임이 모두 이 값을 사용해야 화면과 물리가 일치한다.
// 루프가 센 시간에서 기준 시각을 뺀 값이며, 타임어택을 시작할 때 기준을 옮겨서 0으로 되돌린다.
let seaTime = 0;
let seaClockOrigin = 0;
let loopElapsed = 0;

/** 충돌한 쪽의 선체 끝에서 물보라를 일으키고 카메라를 흔든다. */
function playImpact(speed: number, movingAhead: boolean, strength: number): void {
  if (speed < MIN_IMPACT_SPEED) return;
  const intensity = Math.min(speed / FULL_IMPACT_SPEED, 1) * strength;
  const { x, z, heading } = ship.state;
  const reach = SHIP.model.length * 0.48 * (movingAhead ? 1 : -1);
  impactSpray.burst(x + Math.sin(heading) * reach, 0.5, z - Math.cos(heading) * reach, intensity, SHIP.model.beam);
  chaseCamera.shake(intensity);
}

const seaEffects = new SeaEffects(ship, SHIP.model, impactSpray, chaseCamera, showAlert, playSplash);

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// ---- 관찰 모드와 개발 도구 ----
const observer = new Observer();
// 관찰 모드에서 휠로 조절할 수 있는 카메라 거리의 범위 (m). 구역 전체를 내려다볼 수 있을 만큼 멀리 허용한다.
const OBSERVER_DISTANCE_RANGE = [20, 9000] as const;

function setObserver(active: boolean): void {
  if (active === observer.active) return;
  if (active) {
    observer.enter(ship.state.x, ship.state.z, ship.state.heading);
    chaseCamera.setDistanceRange(...OBSERVER_DISTANCE_RANGE);
  } else {
    observer.exit();
    chaseCamera.setDistanceRange();
  }
}

/** 배를 관찰 지점으로 옮긴다. 육지나 구조물 위, 구역의 바깥으로는 옮기지 않는다. */
function moveShipToObserver(): void {
  if (!observer.active) return;
  const { x, z } = observer;
  if (isOutsideRegion(x, z) || terrain.isLand(x, z) || structures.contains(x, z) || bridges.hitsPier(x, z)) {
    showAlert('이 위치로는 배를 옮길 수 없습니다 (육지, 구조물 또는 구역의 바깥)');
    return;
  }
  placeShip(x, z, ship.state.heading);
}

/** 배를 지정한 위치에 정지한 상태로 놓는다. */
function placeShip(x: number, z: number, heading: number): void {
  Object.assign(ship.state, { x, z, heading, surge: 0, sway: 0, yawRate: 0 });
  ship.recover();
  ship.controls.throttle = 0;
  ship.controls.rudder = 0;
  // 이전의 위치에서 새 위치까지 항적이 이어지지 않도록 기록을 지운다.
  wake.reset();
  hud.resetTrack();
  setObserver(false);
  // 카메라가 이전의 방향에서 천천히 돌아오지 않고, 바로 선미 쪽에서 바라보게 한다.
  chaseCamera.alignTo(heading);
  chaseCamera.resetView();
}

// 엔진과 파도, 바람의 소리
const ambientSound = new AmbientSound();

// ---- 가이드와 조언 ----
const guide = new Guide(document.body);
const coach = new Coach();
hud.addMenuSection(
  'help',
  '항해 가이드',
  createButton({
    content: '계기판을 읽는 법과 거친 바다의 요령',
    onClick: () => {
      hud.closeMenus();
      guide.open();
    },
  }),
  true,
);
hud.addMenuSection('help', '조작키', createKeyGuide(), true);

// ---- 타임어택 ----
const timeAttack = new TimeAttack({
  ship,
  weather,
  hud,
  raceHud: new RaceHud(document.querySelector<HTMLElement>('#hud')!),
  gates: new CourseGates(scene),
  seaEffects,
  records: new LocalRecordStore(),
  placeShip,
  restartSeaClock: () => (seaClockOrigin = loopElapsed),
});

hud.setMenuContent(
  'race',
  createCourseList(COURSES, {
    start: (course) => timeAttack.start(course),
    quit: () => {
      timeAttack.quit();
      hud.closeMenus();
    },
  }),
);

hud.setMenuContent(
  'start',
  createStartPointList(REGION.starts, (point) => moveToStartPoint(point)),
);

function moveToStartPoint(point: StartPoint): void {
  // 다른 곳으로 옮기면 코스를 벗어나므로, 도전하고 있었으면 그만둔다.
  timeAttack.quit();
  const { x, z } = latLonToWorld(point);
  placeShip(x, z, degToRad(point.headingDeg));
  hud.closeMenus();
}

if (DEV_TOOLS) {
  hud.setMenuContent(
    'dev',
    createDevTools(
      loadChart().then((chart) => chart.places),
      {
        toggleObserver: () => setObserver(!observer.active),
        moveShipHere: moveShipToObserver,
        goToPlace: (place) => {
          setObserver(true);
          Object.assign(observer, latLonToWorld(place));
        },
      },
    ),
  );
}

if (startOptions.observe) {
  setObserver(true);
  Object.assign(observer, requestedPoint);
}

const seamarkInspector = new SeamarkInspector(document.querySelector<HTMLElement>('#hud')!, canvas, seamarks);

// (개발 서버에서만) 브라우저의 콘솔과 성능 측정 스크립트에서 장면을 조사할 수 있도록 주요 객체를 꺼내 둔다.
if (DEV_TOOLS) Object.assign(window, { __namhae: { stage, renderer, scene, camera, ship, ocean, ambientSound } });

// ---- 시작 화면 ----
const startScreen = new StartScreen(document.body, {
  timeAttack: () => timeAttack.start(COURSES[0]),
  guide: () => guide.open(),
});
if (startOptions.skipIntro) startScreen.dismiss();
// 선박의 모델과 지도의 자료를 받은 다음에, 주변의 지형이 모두 그려질 때까지 기다린다.
// 자료를 받지 못해도 시작은 할 수 있어야 하므로 실패는 무시하고, 15초가 지나면 기다리지 않는다.
const assetsLoaded = Promise.allSettled([ship.ready, loadChart(), loadSeamarkRecords()]);
let assetsDone = false;
void assetsLoaded.then(() => (assetsDone = true));
window.setTimeout(() => startScreen.markReady(), 15000);

// ---- 핸드폰 컨트롤러 ----
// 컨트롤러가 보낸 마지막 조종 값. 받은 시각을 함께 두어, 메시지가 끊기면 키보드로 돌아간다.
// 형식이 맞지 않는 메시지는 버리고 직전 값을 그대로 둔다.
let remoteHelm: RemoteHelm | undefined;
// 중립과 복구는 누른 횟수로 오므로, 직전 횟수와 비교해서 새로 누른 것만 다음 단계에 한 번 반영한다.
let pressCounts: { neutral?: number; reset?: number; viewReset?: number } = {};
// 시점은 끈 거리의 누적 값으로 오므로, 직전 메시지와의 차이만큼 돌린다.
let lastHelmMessage: HelmMessage | undefined;
// 핸드폰의 시점 영역은 PC 화면보다 훨씬 좁아서, 같은 픽셀 비율로는 한 바퀴를 돌리려면 여러 번 끌어야 한다.
// 영역을 한 번 가로질러 끌면(약 250px) 배를 반 바퀴쯤 돌도록 키운다.
const PHONE_VIEW_DRAG_SCALE = 2.5;
let remoteNeutral = false;
// 직전 물리 단계에 핸드폰의 메시지가 오고 있었는지. 끊긴 순간을 알아채서 스로틀을 중립으로 돌리는 데 쓴다.
let remoteLinkActive = false;
let remoteReset = false;
const helmHost = new HelmHost((text) => {
  const command = decodeCommand(text);
  if (command) {
    runCommand(command);
    return;
  }
  const message = decodeHelm(text);
  if (!message) return;
  if (isNewPress(pressCounts.neutral, message.neutralCount)) remoteNeutral = true;
  if (isNewPress(pressCounts.reset, message.resetCount)) remoteReset = true;
  if (isNewPress(pressCounts.viewReset, message.viewResetCount)) chaseCamera.resetView();
  pressCounts = { neutral: message.neutralCount, reset: message.resetCount, viewReset: message.viewResetCount };
  const drag = viewDragDelta(lastHelmMessage, message);
  lastHelmMessage = message;
  if (drag.x !== 0 || drag.y !== 0) {
    chaseCamera.rotateBy(drag.x * PHONE_VIEW_DRAG_SCALE, drag.y * PHONE_VIEW_DRAG_SCALE);
  }
  remoteHelm = { throttleRate: message.throttleRate, rudder: message.rudder, receivedAt: performance.now() / 1000 };
});
// 컨트롤러는 레버를 미는 방향만 보내므로, 스로틀이 지금 몇 %인지는 게임이 알려 준다.
const STATUS_INTERVAL = 0.1;
let statusSentAt = -Infinity;

// ---- 핸드폰의 명령과 게임의 상황 ----

const COURSE_ITEMS: MenuItem[] = COURSES.map(({ id, name, note }) => ({ id, name, note }));
// 시작 위치에는 ID가 없으므로 목록의 순번을 ID로 쓴다. 목록은 게임을 연 동안 바뀌지 않는다.
const START_ITEMS: MenuItem[] = REGION.starts.map(({ name, note }, index) => ({ id: String(index), name, note }));

/** 핸드폰이 화면을 정하는 데 쓰는 지금의 상황 */
function currentSituation(): GameSituation {
  const race = timeAttack.summary;
  let scene: GameScene = 'sailing';
  if (!startScreen.dismissed) scene = startScreen.isReady ? 'start' : 'loading';
  else if (race?.phase === 'countdown') scene = 'countdown';
  else if (race?.phase === 'running') scene = 'racing';
  else if (race?.phase === 'finished') scene = 'finished';
  const situation: GameSituation = {
    scene,
    capsized: ship.capsized,
    courses: COURSE_ITEMS,
    starts: START_ITEMS,
    seaLevel: weather.sea.level,
    // PC에서도 도전하는 동안(결과를 보는 동안 포함)에는 파도 세기의 버튼이 잠긴다.
    seaLevelLocked: timeAttack.active,
    soundOn: !isMuted(),
  };
  if (race && scene !== 'sailing') {
    situation.race = { courseName: race.course.name };
    // 남은 초는 화면의 카운트다운 숫자(3, 2, 1)와 같게 올림한다. 지난 시간은 0.1초 단위로 보내서 상황이 너무 자주 바뀌지 않게 한다.
    if (scene === 'countdown') situation.race.countdown = Math.ceil(race.countdown);
    if (scene === 'racing') situation.race.elapsed = Math.floor(race.total * 10) / 10;
    if (scene === 'finished') situation.race.time = race.total;
  }
  return situation;
}

/** 핸드폰이 보낸 명령을 PC에서 같은 버튼을 누른 것처럼 실행한다. 지금 상황에서 할 수 없는 명령은 무시한다. */
function runCommand(command: ControllerCommand): void {
  if (!canRunCommand(command, currentSituation())) return;
  switch (command.kind) {
    case 'startSailing':
      startScreen.dismiss();
      break;
    case 'startRace': {
      const course = COURSES.find(({ id }) => id === command.courseId);
      if (!course) return;
      startScreen.dismiss();
      timeAttack.start(course);
      break;
    }
    case 'quitRace':
      timeAttack.quit();
      break;
    case 'retryRace':
      timeAttack.retry();
      break;
    case 'moveToStart':
      moveToStartPoint(REGION.starts[Number(command.startId)]);
      break;
    case 'setSeaLevel':
      hud.setSeaLevel(command.level);
      break;
    case 'setSound':
      hud.setSound(command.on);
      break;
  }
  sendSituation();
}

// 상황은 바뀔 때만 보내되, 같은 PC의 탭처럼 연결된 순간을 알 수 없는 컨트롤러도 곧 받도록 2초마다 한 번은 다시 보낸다.
const SITUATION_CHECK_INTERVAL = 0.25;
const SITUATION_REPEAT_INTERVAL = 2;
let situationCheckedAt = -Infinity;
let situationSentAt = -Infinity;
let lastSituation = '';
function sendSituation(force = false): void {
  const text = encodeSituation(currentSituation());
  const now = performance.now() / 1000;
  if (!force && text === lastSituation && now - situationSentAt < SITUATION_REPEAT_INTERVAL) return;
  lastSituation = text;
  situationSentAt = now;
  helmHost.sendControl(text);
}
// 핸드폰의 명령 통로가 열리면 기다리지 않고 지금의 상황을 보낸다.
helmHost.onControlOpen = () => sendSituation(true);
// 메뉴와 시작 화면의 QR 코드는 같은 연결을 쓴다. 시작 화면에서 연결한 핸드폰은 시작 화면을 닫아도 그대로 남는다.
const phonePanels = [new PhonePanel('menu')];
let phoneConnected = false;
const openPhoneLink = () =>
  helmHost.open((status, peerId) => {
    phonePanels.forEach((panel) => panel.setStatus(status, peerId));
    const connected = status === 'connected';
    if (connected === phoneConnected) return;
    phoneConnected = connected;
    // 연결되면 QR 코드는 더 볼 일이 없으므로 메뉴를 닫고, 메뉴를 열지 않아도 연결된 것을 알 수 있게 버튼에 표시한다.
    if (connected) hud.closeMenus();
    hud.setMenuLabel('phone', connected ? '핸드폰 연결됨' : undefined, connected ? 'connected' : undefined);
    hud.setPhoneHints(connected);
  });
hud.setMenuContent('phone', phonePanels[0].element, openPhoneLink);
const startPhonePanel = new PhonePanel('start');
if (startScreen.addAside(startPhonePanel.element)) {
  phonePanels.push(startPhonePanel);
  openPhoneLink();
}

// 물리의 한 스텝에서 선박이 이동하기 전의 위치. 관문을 지났는지 판정하는 데 사용한다.
const stepStart = { x: 0, z: 0 };

startLoop({
  update(dt) {
    // 시작 화면이 떠 있는 동안에는 배가 바람에 밀려서 움직이지 않도록 시간을 멈춘다.
    if (!startScreen.dismissed) return;
    // 관찰 모드에서는 조종에 쓰는 키로 카메라를 움직이므로, 배의 시간을 멈춘다.
    if (observer.active) return;
    // 카운트다운을 세는 동안에는 배를 세워 둔다.
    if (timeAttack.frozen) {
      timeAttack.step(dt, ship.state, ship.state);
      return;
    }
    stepStart.x = ship.state.x;
    stepStart.z = ship.state.z;
    const now = performance.now() / 1000;
    const keyboardActive = isHelmKeyDown(input);
    const link = checkRemoteLink(remoteLinkActive, keyboardActive, remoteHelm, now);
    remoteLinkActive = link.active;
    let helm = chooseHelm(keyboardHelm(input), keyboardActive, remoteHelm, now);
    if (remoteNeutral || link.neutral) {
      helm = { ...helm, neutral: true };
      remoteNeutral = false;
    }
    if (link.neutral) hud.showTip('핸드폰 연결이 끊겨서 스로틀을 중립으로 돌렸습니다.');
    ship.update(dt, helm, windVelocity(wind));
    // 충돌을 처리하면 속도가 0이 되므로, 연출에 사용할 속력을 먼저 기록한다.
    const { surge, sway } = ship.state;
    const impactSpeed = Math.hypot(surge, sway);
    const movingAhead = surge >= 0;

    const collision = resolveCollisions(ship, SHIP, world, seaTime);
    if (collision) {
      showAlert(collision.message);
      if (collision.impact > 0) playImpact(impactSpeed, movingAhead, collision.impact);
    }
    // 이번 스텝에 이동한 선분이 관문을 지났는지 확인한다.
    timeAttack.step(dt, stepStart, ship.state);
  },
  render(frameTime, elapsed) {
    if (assetsDone && terrain.isSettled) startScreen.markReady();
    // 시작 화면이 떠 있는 동안에는 자료를 불러오느라 프레임이 느리므로, 항해를 시작한 뒤부터 해상도를 조절한다.
    if (startScreen.dismissed) stage.adaptResolution(frameTime);
    if (input.isDown('KeyC')) chaseCamera.resetView();
    // 복구 버튼은 항상 보이지만 R 키와 같이 전복되었을 때만 동작한다. 전복되지 않았을 때 누른 것은 버린다.
    const resetPressed = remoteReset;
    remoteReset = false;
    if (ship.capsized && (resetPressed || input.consumePress('KeyR'))) {
      if (timeAttack.active) timeAttack.respawn();
      // 자유 항해에서는 처음 자리로 되돌리지 않고, 뒤집힌 그 자리에서 파도를 선수로 받도록 세워서 이어 가게 한다.
      else placeShip(ship.state.x, ship.state.z, respawnHeading(ship.state.heading, wind));
    }
    if (elapsed - situationCheckedAt >= SITUATION_CHECK_INTERVAL) {
      situationCheckedAt = elapsed;
      sendSituation();
    }
    if (elapsed - statusSentAt >= STATUS_INTERVAL) {
      statusSentAt = elapsed;
      helmHost.send(encodeShipStatus({ throttle: ship.controls.throttle, capsized: ship.capsized }));
    }
    if (DEV_TOOLS) {
      if (input.consumePress('KeyF')) setObserver(!observer.active);
      if (input.consumePress('KeyT')) moveShipToObserver();
    }
    if (observer.active) observer.update(frameTime, input, chaseCamera.viewHeading, chaseCamera.viewDistance);
    // 지형과 표지, 수면의 격자는 카메라가 보고 있는 곳을 중심으로 불러오고 배치한다.
    const focus = observer.active ? observer : ship.state;

    loopElapsed = elapsed;
    seaTime = elapsed - seaClockOrigin;
    updateWeather(weather, frameTime, timeAttack.weatherRandom);
    exposure.update(frameTime, focus.x, focus.z, wind.fromDeg, swell.fromDeg);
    updateWaves(wind, swell, exposure, frameTime);
    ship.syncObject(seaTime, frameTime, windVelocity(wind));
    seaEffects.update(frameTime);
    chaseCamera.update(frameTime, focus);
    terrain.update(focus.x, focus.z);
    seamarks.update(seaTime, focus.x, focus.z);
    wake.update(seaTime, ship.state);
    // 맵의 범위 안에서는 위치에 따른 태양의 차이가 1° 미만이므로, 고정된 기준 지점으로 계산한다.
    ocean.setSun(sunPosition(timeOfDay, WORLD_ORIGIN));
    ocean.update(seaTime, focus.x, focus.z, camera, wind);
    impactSpray.update(frameTime);
    hud.update({
      frameTime,
      camera,
      state: ship.state,
      controls: ship.controls,
      wind,
      engine: { rpm: ship.rpm, maxRpm: SHIP.engine.maxRpm },
      heel: ship.heel,
      fetch: exposure.fetch,
      shipLength: SHIP.model.length,
      alert,
      focus: observer.active ? observer : undefined,
    });
    timeAttack.render();
    // 시작 화면에서는 엔진이 꺼진 것처럼 파도와 바람의 소리만 낸다.
    ambientSound.update({
      rpmRatio: startScreen.dismissed ? ship.rpm / SHIP.engine.maxRpm : 0,
      waveHeight: currentWaveHeight(),
      windSpeed: wind.speed,
    });
    // 배를 조종하고 있을 때에만 요령을 알려 준다.
    if (startScreen.dismissed && !observer.active && !timeAttack.frozen) {
      const offBow = Math.abs(((((wind.fromDeg - (ship.state.heading * 180) / Math.PI) % 360) + 540) % 360) - 180);
      const tip = coach.update(frameTime, {
        heel: ship.heel,
        seaOffBow: offBow,
        windSpeed: wind.speed,
        speed: Math.hypot(ship.state.surge, ship.state.sway),
        breaking: ship.breaking,
        capsized: ship.capsized,
      });
      if (tip) hud.showTip(tip);
    }
    seamarkInspector.update(camera, ship.state);
    renderer.render(scene, camera);
  },
});
