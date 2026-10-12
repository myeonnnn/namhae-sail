import './style.css';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { createStage } from './core/renderer';
import { Ocean } from './ocean/ocean';
import { Wake } from './ocean/wake';
import { ChaseCamera } from './ship/chaseCamera';
import { Ship } from './ship/ship';
import { OCEAN_LINER } from './ship/shipSpec';
import { AxisGizmo } from './ui/axisGizmo';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { latLonToWorld } from './geo/projection';
import { Terrain } from './world/terrain';

// 부산항 북항의 입구에서 남동쪽으로 약 3km 떨어진 해상. 오륙도의 남쪽이며, 항구를 향해서 출발한다.
const START = { lat: 35.07, lon: 129.125, headingDeg: 315 };

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const { renderer, scene, camera } = createStage(canvas);

const input = new Input();
const wake = new Wake(renderer, OCEAN_LINER.model);
const ocean = new Ocean(scene, renderer, wake);
const ship = new Ship(OCEAN_LINER);
const start = latLonToWorld(START);
ship.state.x = start.x;
ship.state.z = start.z;
ship.state.heading = (START.headingDeg * Math.PI) / 180;
scene.add(ship.object);

const terrain = new Terrain(scene);

const chaseCamera = new ChaseCamera(camera, canvas, OCEAN_LINER.camera);
chaseCamera.alignTo(ship.state.heading);
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const hud = new Hud(hudRoot);
const axisGizmo = new AxisGizmo(hudRoot);
const minimap = new Minimap(hudRoot);

startLoop({
  update(dt) {
    ship.update(dt, input);
    ship.resolveGrounding((x, z) => terrain.isLand(x, z));
  },
  render(frameTime, elapsed) {
    if (input.isDown('KeyC')) chaseCamera.resetView();
    ship.syncObject(elapsed, frameTime);
    chaseCamera.update(frameTime, ship.state);
    terrain.update(ship.state.x, ship.state.z);
    wake.update(elapsed, ship.state);
    ocean.update(elapsed, ship.state.x, ship.state.z, camera, canvas.clientHeight);
    hud.update(ship.state, ship.controls);
    axisGizmo.update(camera, ship.state);
    minimap.update(ship.state);
    renderer.render(scene, camera);
  },
});
