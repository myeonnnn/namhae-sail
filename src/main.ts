import './style.css';
import { Input } from './core/input';
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
import { Hud } from './ui/hud';
import { SeamarkInspector } from './ui/seamarkInspector';
import { latLonToWorld, WORLD_ORIGIN } from './geo/projection';
import { Seamarks } from './world/seamarks';
import { Terrain } from './world/terrain';

// 부산항 북항의 입구에서 남동쪽으로 약 3km 떨어진 해상. 오륙도의 남쪽이며, 항구를 향해서 출발한다.
// 조종할 선박. shipSpec.ts에 정의된 다른 선박으로 바꾸면 모델과 조종 특성, 카메라의 거리가 함께 바뀐다.
const SHIP = SPORT_YACHT;

const START = { lat: 35.07, lon: 129.125, headingDeg: 315 };

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const stage = createStage(canvas);
const { renderer, scene, camera } = stage;

const input = new Input();
const wind = createWind();
const timeOfDay = createTimeOfDay();
const wake = new Wake(renderer, SHIP.model);
const ocean = new Ocean(scene, renderer, wake);
const ship = new Ship(SHIP);
// 주소에 ?lat=35.08&lon=129.11&heading=300과 같이 적으면 그 위치와 방향에서 시작한다. 특정 장소를 확인할 때 사용한다.
const query = new URLSearchParams(location.search);
const queryNumber = (name: string, fallback: number) => {
  const value = Number(query.get(name) ?? NaN);
  return Number.isFinite(value) ? value : fallback;
};
const start = latLonToWorld({ lat: queryNumber('lat', START.lat), lon: queryNumber('lon', START.lon) });
ship.state.x = start.x;
ship.state.z = start.z;
ship.state.heading = (queryNumber('heading', START.headingDeg) * Math.PI) / 180;
scene.add(ship.object);

const terrain = new Terrain(scene);
const seamarks = new Seamarks(scene, (x, z) => terrain.heightAt(x, z));

const chaseCamera = new ChaseCamera(camera, canvas, SHIP.camera);
chaseCamera.alignTo(ship.state.heading);
const hud = new Hud(document.querySelector<HTMLElement>('#hud')!, wind, timeOfDay);
const alert = { message: '', at: -Infinity };

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
const seamarkInspector = new SeamarkInspector(document.querySelector<HTMLElement>('#hud')!, canvas, seamarks);

startLoop({
  update(dt) {
    ship.update(dt, input, windVelocity(wind));
    simulationTime += dt;
    // 충돌을 처리하면 속도가 0이 되므로, 연출에 사용할 속력을 먼저 기록한다.
    const { surge, sway } = ship.state;
    const impactSpeed = Math.hypot(surge, sway);
    const movingAhead = surge >= 0;

    if (ship.resolveGrounding((x, z) => terrain.isLand(x, z))) {
      alert.message = '좌초: 후진(S)으로 이탈';
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
    if (input.isDown('KeyC')) chaseCamera.resetView();
    updateWaves(wind, frameTime);
    ship.syncObject(elapsed, frameTime);
    chaseCamera.update(frameTime, ship.state);
    terrain.update(ship.state.x, ship.state.z);
    seamarks.update(elapsed, ship.state.x, ship.state.z);
    wake.update(elapsed, ship.state);
    // 맵의 범위 안에서는 위치에 따른 태양의 차이가 1° 미만이므로, 고정된 기준 지점으로 계산한다.
    ocean.setSun(sunPosition(timeOfDay, WORLD_ORIGIN));
    ocean.update(elapsed, ship.state.x, ship.state.z, camera, canvas.clientHeight, wind);
    impactSpray.update(frameTime);
    hud.update({
      camera,
      state: ship.state,
      controls: ship.controls,
      wind,
      engine: { rpm: ship.rpm, maxRpm: SHIP.engine.maxRpm },
      alert,
    });
    seamarkInspector.update(camera, ship.state);
    renderer.render(scene, camera);
  },
});
