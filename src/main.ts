import './style.css';
import { Input } from './core/input';
import { Observer } from './core/observer';
import { startLoop } from './core/loop';
import { createStage } from './core/renderer';
import { COURSES } from './course/course';
import { LocalRecordStore } from './course/records';
import { createTimeOfDay, sunPosition } from './environment/sun';
import { createWeather, updateWeather } from './environment/weather';
import { windVelocity } from './environment/wind';
import { Ocean } from './ocean/ocean';
import { Wake } from './ocean/wake';
import { updateWaves } from './ocean/waves';
import { ChaseCamera } from './ship/chaseCamera';
import { ImpactSpray } from './ship/impactSpray';
import { Ship } from './ship/ship';
import { SPORT_YACHT } from './ship/shipSpec';
import { createCourseList } from './ui/courseList';
import { createDevTools } from './ui/devTools';
import { Hud } from './ui/hud';
import { RaceHud } from './ui/raceHud';
import { SeamarkInspector } from './ui/seamarkInspector';
import { createStartPointList } from './ui/startPoints';
import { StartScreen } from './ui/startScreen';
import { readStartOptions } from './dev/startOptions';
import { latLonToWorld, WORLD_ORIGIN } from './geo/projection';
import { isOutsideRegion, REGION } from './geo/region';
import { TimeAttack } from './game/timeAttack';
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

// 운영 구역의 첫 번째 시작 지점에서 시작한다. 나머지 지점은 설정 메뉴에서 골라서 이동할 수 있다.
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
const exposure = new SeaExposure();
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

// 배가 뒤집혔을 때 되돌아갈 위치. 마지막으로 배를 놓은 곳이다.
const restart = { x: ship.state.x, z: ship.state.z, heading: ship.state.heading };
const seaEffects = new SeaEffects(ship, SHIP.model, impactSpray, chaseCamera, showAlert);

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
  Object.assign(restart, { x, z, heading });
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

hud.addSettingsSection(
  '타임어택',
  createCourseList(COURSES, {
    start: (course) => timeAttack.start(course),
    quit: () => {
      timeAttack.quit();
      hud.closeSettings();
    },
  }),
);

hud.addSettingsSection(
  '시작 위치',
  createStartPointList(REGION.starts, (point) => {
    // 다른 곳으로 옮기면 코스를 벗어나므로, 도전하고 있었으면 그만둔다.
    timeAttack.quit();
    const { x, z } = latLonToWorld(point);
    placeShip(x, z, degToRad(point.headingDeg));
    hud.closeSettings();
  }),
);

if (DEV_TOOLS) {
  hud.addSettingsSection(
    '개발 도구',
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
if (DEV_TOOLS) Object.assign(window, { __namhae: { stage, renderer, scene, camera, ship, ocean } });

// ---- 시작 화면 ----
const startScreen = new StartScreen(document.body, { timeAttack: () => timeAttack.start(COURSES[0]) });
if (startOptions.skipIntro) startScreen.dismiss();
// 선박의 모델과 지도의 자료를 받은 다음에, 주변의 지형이 모두 그려질 때까지 기다린다.
// 자료를 받지 못해도 시작은 할 수 있어야 하므로 실패는 무시하고, 15초가 지나면 기다리지 않는다.
const assetsLoaded = Promise.allSettled([ship.ready, loadChart(), loadSeamarkRecords()]);
let assetsDone = false;
void assetsLoaded.then(() => (assetsDone = true));
window.setTimeout(() => startScreen.markReady(), 15000);

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
    ship.update(dt, input, windVelocity(wind));
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
    if (ship.capsized && input.consumePress('KeyR')) {
      if (timeAttack.active) timeAttack.respawn();
      else placeShip(restart.x, restart.z, restart.heading);
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
    ocean.update(seaTime, focus.x, focus.z, camera, canvas.clientHeight, wind);
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
    seamarkInspector.update(camera, ship.state);
    renderer.render(scene, camera);
  },
});
