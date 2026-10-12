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
import { Ship } from './ship/ship';
import { SPORT_YACHT } from './ship/shipSpec';
import { Hud } from './ui/hud';
import { latLonToWorld, WORLD_ORIGIN } from './geo/projection';
import { Seamarks } from './world/seamarks';
import { Terrain } from './world/terrain';

// 부산항 북항의 입구에서 남동쪽으로 약 3km 떨어진 해상. 오륙도의 남쪽이며, 항구를 향해서 출발한다.
// 조종할 선박. shipSpec.ts에 정의된 다른 선박으로 바꾸면 모델과 조종 특성, 카메라의 거리가 함께 바뀐다.
const SHIP = SPORT_YACHT;

const START = { lat: 35.07, lon: 129.125, headingDeg: 315 };

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const { renderer, scene, camera } = createStage(canvas);

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
let lastGroundedAt = -Infinity;

startLoop({
  update(dt) {
    ship.update(dt, input, windVelocity(wind));
    if (ship.resolveGrounding((x, z) => terrain.isLand(x, z))) lastGroundedAt = performance.now();
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
    hud.update({ camera, state: ship.state, controls: ship.controls, wind, lastGroundedAt });
    renderer.render(scene, camera);
  },
});
