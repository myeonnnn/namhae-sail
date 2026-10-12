import './style.css';
import { Input } from './core/input';
import { Observer } from './core/observer';
import { startLoop } from './core/loop';
import { createStage } from './core/renderer';
import { createTimeOfDay, sunPosition } from './environment/sun';
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
import { latLonToWorld, WORLD_ORIGIN } from './geo/projection';
import region from './geo/region.json';
import { loadChart } from './world/chartData';
import { loadSeamarkRecords } from './world/seamarkData';
import { Seamarks } from './world/seamarks';
import { Bridges } from './world/bridges';
import { Structures } from './world/structures';
import { Terrain } from './world/terrain';

// 운영 구역과 시작 위치는 src/geo/region.json에서 정한다. 자료를 내려받는 스크립트도 같은 파일을 읽는다.
// 조종할 선박. shipSpec.ts에 정의된 다른 선박으로 바꾸면 모델과 조종 특성, 카메라의 거리가 함께 바뀐다.
const SHIP = SPORT_YACHT;

// region.json의 starts에 적힌 첫 번째 지점에서 시작한다. 나머지 지점은 설정 메뉴에서 골라서 이동할 수 있다.
const START = region.starts[0];

// 개발 도구(관찰 모드, 배의 순간 이동, 장소로 바로 이동, 주소로 시작 위치 지정)는 로컬의 개발 서버에서만 켠다.
// Vite는 배포용으로 빌드할 때 import.meta.env.DEV를 false로 바꾸므로, 이 조건으로 감싼 코드는 결과물에서 제거된다.
const DEV_TOOLS = import.meta.env.DEV;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const stage = createStage(canvas);
const { renderer, scene, camera } = stage;

const input = new Input();
const wind = createWind();
const timeOfDay = createTimeOfDay();
const wake = new Wake(renderer, SHIP.model);
const ocean = new Ocean(scene, renderer, wake);
const ship = new Ship(SHIP);
// (개발 서버에서만) 주소에 ?lat=34.83&lon=128.43&heading=300과 같이 적으면 그 위치와 방향에서 시작한다. 특정 장소를 확인할 때 사용한다.
// &observe를 덧붙이면 배는 기본 위치에 두고, 그 좌표를 관찰 모드로 바라보면서 시작한다. 육지 위의 좌표도 지정할 수 있다.
const query = new URLSearchParams(location.search);
const queryNumber = (name: string, fallback: number) => {
  const value = DEV_TOOLS ? Number(query.get(name) ?? NaN) : NaN;
  return Number.isFinite(value) ? value : fallback;
};
const startInObserver = DEV_TOOLS && query.has('observe');
const queryPoint = latLonToWorld({ lat: queryNumber('lat', START.lat), lon: queryNumber('lon', START.lon) });
const start = startInObserver ? latLonToWorld(START) : queryPoint;
ship.state.x = start.x;
ship.state.z = start.z;
ship.state.heading = (queryNumber('heading', START.headingDeg) * Math.PI) / 180;
scene.add(ship.object);

const terrain = new Terrain(scene);
const structures = new Structures(scene);
const bridges = new Bridges(scene);
// 등대와 등표는 방파제 위에 있으면 그 윗면에, 아니면 지형 위에 세운다.
const seamarks = new Seamarks(scene, (x, z) => structures.topNear(x, z, 8) ?? terrain.heightAt(x, z));

const chaseCamera = new ChaseCamera(camera, canvas, SHIP.camera);
chaseCamera.alignTo(ship.state.heading);
const hud = new Hud(document.querySelector<HTMLElement>('#hud')!, wind, timeOfDay);
const alert = { message: '', at: -Infinity };

// 운영 구역의 경계를 월드 좌표로 바꿔 둔다. 북쪽이 -Z이므로, 북쪽 끝의 z가 남쪽 끝의 z보다 작다.
const regionMin = latLonToWorld({ lat: region.bounds.north, lon: region.bounds.west });
const regionMax = latLonToWorld({ lat: region.bounds.south, lon: region.bounds.east });
const isOutsideRegion = (x: number, z: number) =>
  x < regionMin.x || x > regionMax.x || z < regionMin.z || z > regionMax.z;

// 조작대의 크기는 화면의 크기에 따라 달라지므로, 크기가 바뀔 때마다 카메라에 다시 알려 준다.
const syncBottomInset = () => stage.setBottomInset(hud.consoleHeight);
window.addEventListener('resize', syncBottomInset);
syncBottomInset();

const impactSpray = new ImpactSpray(scene);
// 이 속력(m/s)보다 느린 접촉은 연출 없이 경고만 표시한다. 육지에 닿은 채로 밀고 있을 때 매 스텝 반복되는 것을 막는다.
const MIN_IMPACT_SPEED = 1;
// 이 속력(m/s)에서 연출의 세기가 최대가 된다.
const FULL_IMPACT_SPEED = 15;
let simulationTime = 0;

/** 충돌한 쪽의 선체 끝에서 물보라를 일으키고 카메라를 흔든다. */
function playImpact(speed: number, movingAhead: boolean, strength = 1): void {
  if (speed < MIN_IMPACT_SPEED) return;
  const intensity = Math.min(speed / FULL_IMPACT_SPEED, 1) * strength;
  const { x, z, heading } = ship.state;
  const reach = SHIP.model.length * 0.48 * (movingAhead ? 1 : -1);
  impactSpray.burst(x + Math.sin(heading) * reach, 0.5, z - Math.cos(heading) * reach, intensity, SHIP.model.beam);
  chaseCamera.shake(intensity);
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
    alert.message = '이 위치로는 배를 옮길 수 없습니다 (육지, 구조물 또는 구역의 바깥)';
    alert.at = performance.now();
    return;
  }
  placeShip(x, z, ship.state.heading);
}

/** 배를 지정한 위치에 정지한 상태로 놓는다. */
function placeShip(x: number, z: number, heading: number): void {
  Object.assign(ship.state, { x, z, heading, surge: 0, sway: 0, yawRate: 0 });
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
  createStartPointList(region.starts, (point) => {
    const { x, z } = latLonToWorld(point);
    placeShip(x, z, (point.headingDeg * Math.PI) / 180);
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

if (startInObserver) {
  setObserver(true);
  Object.assign(observer, queryPoint);
}

const seamarkInspector = new SeamarkInspector(document.querySelector<HTMLElement>('#hud')!, canvas, seamarks);

// ---- 시작 화면 ----
const startScreen = new StartScreen(document.body);
// 개발 서버에서 주소로 위치를 지정했을 때에는 특정 장소를 바로 확인하려는 것이므로 시작 화면을 건너뛴다.
if (DEV_TOOLS && (query.has('lat') || query.has('observe') || query.has('skipIntro'))) startScreen.dismiss();
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

    if (isOutsideRegion(ship.state.x, ship.state.z)) {
      // 구역의 바깥에는 지도와 표지의 자료가 없으므로, 경계에서 배를 세운다.
      alert.message = '항해 구역의 끝입니다: 후진(S)으로 되돌아가세요';
      alert.at = performance.now();
      ship.stopAtPreviousPosition();
      return;
    }

    if (ship.resolveGrounding((x, z) => terrain.isLand(x, z))) {
      alert.message = '좌초: 후진(S)으로 이탈';
      alert.at = performance.now();
      playImpact(impactSpeed, movingAhead);
      return;
    }

    if (ship.resolveGrounding((x, z) => bridges.hitsPier(x, z))) {
      alert.message = '교각과 충돌: 후진(S)으로 이탈';
      alert.at = performance.now();
      playImpact(impactSpeed, movingAhead);
      return;
    }

    // 다리 밑의 높이가 선박보다 낮으면 지나갈 수 없다.
    let blockedClearance: number | undefined;
    const tooLow = (x: number, z: number) => {
      const clearance = bridges.clearanceAt(x, z);
      if (clearance === undefined || clearance >= SHIP.model.airDraft) return false;
      blockedClearance = clearance;
      return true;
    };
    if (ship.resolveGrounding(tooLow)) {
      alert.message = `다리 밑을 지날 수 없습니다: 높이 ${blockedClearance!.toFixed(0)}m, 선박 ${SHIP.model.airDraft}m`;
      alert.at = performance.now();
      playImpact(impactSpeed, movingAhead);
      return;
    }

    if (ship.resolveGrounding((x, z) => structures.contains(x, z))) {
      alert.message = '방파제 또는 부두와 충돌: 후진(S)으로 이탈';
      alert.at = performance.now();
      playImpact(impactSpeed, movingAhead);
      return;
    }

    const mark = seamarks.collide(
      ship.state.x,
      ship.state.z,
      ship.state.heading,
      SHIP.model.length / 2,
      SHIP.model.beam / 2,
      simulationTime,
    );
    if (mark?.kind === 'buoy') {
      // 부표는 물에 떠 있어서 밀려난다. 배는 속력을 조금 잃고 그대로 지나간다.
      alert.message = '부표와 충돌';
      alert.at = performance.now();
      playImpact(impactSpeed, movingAhead, 0.4);
      ship.state.surge *= 0.85;
    } else if (mark) {
      alert.message = `${mark.kind === 'light' ? '등대' : '등표'}와 충돌: 후진(S)으로 이탈`;
      alert.at = performance.now();
      ship.stopAtPreviousPosition();
      playImpact(impactSpeed, movingAhead);
    }
  },
  render(frameTime, elapsed) {
    if (assetsDone && terrain.isSettled) startScreen.markReady();
    if (input.isDown('KeyC')) chaseCamera.resetView();
    if (DEV_TOOLS) {
      if (input.consumePress('KeyF')) setObserver(!observer.active);
      if (input.consumePress('KeyT')) moveShipToObserver();
    }
    if (observer.active) observer.update(frameTime, input, chaseCamera.viewHeading, chaseCamera.viewDistance);
    // 지형과 표지, 수면의 격자는 카메라가 보고 있는 곳을 중심으로 불러오고 배치한다.
    const focus = observer.active ? observer : ship.state;

    updateWaves(wind, frameTime);
    ship.syncObject(elapsed, frameTime);
    chaseCamera.update(frameTime, focus);
    terrain.update(focus.x, focus.z);
    seamarks.update(elapsed, focus.x, focus.z);
    wake.update(elapsed, ship.state);
    // 맵의 범위 안에서는 위치에 따른 태양의 차이가 1° 미만이므로, 고정된 기준 지점으로 계산한다.
    ocean.setSun(sunPosition(timeOfDay, WORLD_ORIGIN));
    ocean.update(elapsed, focus.x, focus.z, camera, canvas.clientHeight, wind);
    impactSpray.update(frameTime);
    hud.update({
      camera,
      state: ship.state,
      controls: ship.controls,
      wind,
      engine: { rpm: ship.rpm, maxRpm: SHIP.engine.maxRpm },
      alert,
      focus: observer.active ? observer : undefined,
    });
    seamarkInspector.update(camera, ship.state);
    renderer.render(scene, camera);
  },
});
