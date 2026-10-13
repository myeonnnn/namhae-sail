import './style.css';
import { Input } from './core/input';
import { Observer } from './core/observer';
import { startLoop } from './core/loop';
import { createStage } from './core/renderer';
import { createSeaState, updateSeaState } from './environment/seaState';
import { createTimeOfDay, sunPosition } from './environment/sun';
import { createSwell } from './environment/swell';
import { createWind, windVelocity } from './environment/wind';
import { Ocean } from './ocean/ocean';
import { Wake } from './ocean/wake';
import { updateWaves } from './ocean/waves';
import { ChaseCamera } from './ship/chaseCamera';
import { ImpactSpray } from './ship/impactSpray';
import { Ship } from './ship/ship';
import { SPORT_YACHT } from './ship/shipSpec';
import { createDevTools } from './ui/devTools';
import { Hud } from './ui/hud';
import { SeamarkInspector } from './ui/seamarkInspector';
import { createStartPointList } from './ui/startPoints';
import { StartScreen } from './ui/startScreen';
import { readStartOptions } from './dev/startOptions';
import { latLonToWorld, WORLD_ORIGIN } from './geo/projection';
import { isOutsideRegion, REGION } from './geo/region';
import { resolveCollisions } from './sim/collisions';
import { loadChart } from './world/chartData';
import { loadSeamarkRecords } from './world/seamarkData';
import { Seamarks } from './world/seamarks';
import { OPEN_SEA_FETCH, Shelter } from './world/shelter';
import { Bridges } from './world/bridges';
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
const wind = createWind();
const swell = createSwell();
const sea = createSeaState(wind, swell);
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
const hud = new Hud(document.querySelector<HTMLElement>('#hud')!, { wind, swell, sea }, timeOfDay, {
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

// 파도가 자라는 조건 가운데 위치에 따라 달라지는 값. 섬에 가려진 곳에서는 파도가 낮아진다.
// 육지의 격자를 받기 전에는 열린 바다로 가정한다.
const exposure = { fetch: OPEN_SEA_FETCH, swellFetch: OPEN_SEA_FETCH };
let shelter: Shelter | undefined;
void Shelter.load()
  .then((loaded) => (shelter = loaded))
  .catch((error) => console.warn('육지의 격자를 만들지 못했습니다. 파도가 섬에 가려지지 않습니다.', error));
// 수십 km를 따라가며 재는 계산이고 배는 그 사이에 얼마 움직이지 않으므로, 이 간격(초)으로만 다시 잰다.
const EXPOSURE_INTERVAL = 0.5;
let exposureAge = Infinity;

const impactSpray = new ImpactSpray(scene);
// 이 속력(m/s)보다 느린 접촉은 연출 없이 경고만 표시한다. 육지에 닿은 채로 밀고 있을 때 매 스텝 반복되는 것을 막는다.
const MIN_IMPACT_SPEED = 1;
// 이 속력(m/s)에서 연출의 세기가 최대가 된다.
const FULL_IMPACT_SPEED = 15;
let simulationTime = 0;

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
let wasCapsized = false;
// 부서지는 마루가 선체를 때리는 세기가 이 값을 넘으면 물보라를 일으킨다. 같은 파도에서 연달아 일으키지 않도록 간격(초)을 둔다.
const BREAKER_SPRAY_THRESHOLD = 0.03;
const BREAKER_SPRAY_INTERVAL = 1.2;
let breakerSprayAge = Infinity;

/** 전복되는 순간과, 부서지는 파도가 선체의 옆면을 때리는 순간을 연출한다. */
function playSeaEffects(frameTime: number): void {
  const { x, z } = ship.state;
  if (ship.capsized) {
    if (!wasCapsized) {
      wasCapsized = true;
      impactSpray.burst(x, 0.5, z, 1, SHIP.model.length * 0.6);
      chaseCamera.shake(1);
    }
    // 경고는 일정 시간이 지나면 사라지므로, 뒤집혀 있는 동안에는 계속 다시 표시한다.
    showAlert('전복되었습니다: R 키로 다시 시작');
    return;
  }
  breakerSprayAge += frameTime;
  if (ship.breaking > BREAKER_SPRAY_THRESHOLD && breakerSprayAge > BREAKER_SPRAY_INTERVAL) {
    breakerSprayAge = 0;
    const intensity = Math.min(ship.breaking / (BREAKER_SPRAY_THRESHOLD * 4), 1);
    impactSpray.burst(x, 0.5, z, intensity, SHIP.model.beam);
    chaseCamera.shake(intensity * 0.5);
  }
}

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
  wasCapsized = false;
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

hud.addSettingsSection(
  '시작 위치',
  createStartPointList(REGION.starts, (point) => {
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

// ---- 시작 화면 ----
const startScreen = new StartScreen(document.body);
if (startOptions.skipIntro) startScreen.dismiss();
// 선박의 모델과 지도의 자료를 받은 다음에, 주변의 지형이 모두 그려질 때까지 기다린다.
// 자료를 받지 못해도 시작은 할 수 있어야 하므로 실패는 무시하고, 15초가 지나면 기다리지 않는다.
const assetsLoaded = Promise.allSettled([ship.ready, loadChart(), loadSeamarkRecords()]);
let assetsDone = false;
void assetsLoaded.then(() => (assetsDone = true));
window.setTimeout(() => startScreen.markReady(), 15000);

startLoop({
  update(dt) {
    // 시작 화면이 떠 있는 동안에는 배가 바람에 밀려서 움직이지 않도록 시간을 멈춘다.
    if (!startScreen.dismissed) return;
    // 관찰 모드에서는 조종에 쓰는 키로 카메라를 움직이므로, 배의 시간을 멈춘다.
    if (observer.active) return;
    ship.update(dt, input, windVelocity(wind));
    simulationTime += dt;
    // 충돌을 처리하면 속도가 0이 되므로, 연출에 사용할 속력을 먼저 기록한다.
    const { surge, sway } = ship.state;
    const impactSpeed = Math.hypot(surge, sway);
    const movingAhead = surge >= 0;

    const collision = resolveCollisions(ship, SHIP, world, simulationTime);
    if (!collision) return;
    showAlert(collision.message);
    if (collision.impact > 0) playImpact(impactSpeed, movingAhead, collision.impact);
  },
  render(frameTime, elapsed) {
    if (assetsDone && terrain.isSettled) startScreen.markReady();
    if (input.isDown('KeyC')) chaseCamera.resetView();
    if (ship.capsized && input.consumePress('KeyR')) placeShip(restart.x, restart.z, restart.heading);
    if (DEV_TOOLS) {
      if (input.consumePress('KeyF')) setObserver(!observer.active);
      if (input.consumePress('KeyT')) moveShipToObserver();
    }
    if (observer.active) observer.update(frameTime, input, chaseCamera.viewHeading, chaseCamera.viewDistance);
    // 지형과 표지, 수면의 격자는 카메라가 보고 있는 곳을 중심으로 불러오고 배치한다.
    const focus = observer.active ? observer : ship.state;

    exposureAge += frameTime;
    if (shelter && exposureAge >= EXPOSURE_INTERVAL) {
      exposureAge = 0;
      exposure.fetch = shelter.fetch(focus.x, focus.z, wind.fromDeg);
      exposure.swellFetch = shelter.fetch(focus.x, focus.z, swell.fromDeg);
    }
    updateSeaState(sea, wind, swell, frameTime);
    updateWaves(wind, swell, exposure, frameTime);
    ship.syncObject(elapsed, frameTime, windVelocity(wind));
    playSeaEffects(frameTime);
    chaseCamera.update(frameTime, focus);
    terrain.update(focus.x, focus.z);
    seamarks.update(elapsed, focus.x, focus.z);
    wake.update(elapsed, ship.state);
    // 맵의 범위 안에서는 위치에 따른 태양의 차이가 1° 미만이므로, 고정된 기준 지점으로 계산한다.
    ocean.setSun(sunPosition(timeOfDay, WORLD_ORIGIN));
    ocean.update(elapsed, focus.x, focus.z, camera, canvas.clientHeight, wind);
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
    seamarkInspector.update(camera, ship.state);
    renderer.render(scene, camera);
  },
});
