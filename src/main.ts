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

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const { renderer, scene, camera } = createStage(canvas);

const input = new Input();
const wake = new Wake(renderer, OCEAN_LINER.model);
const ocean = new Ocean(scene, renderer, wake);
const ship = new Ship(OCEAN_LINER);
scene.add(ship.object);

const chaseCamera = new ChaseCamera(camera, canvas, OCEAN_LINER.camera);
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const hud = new Hud(hudRoot);
const axisGizmo = new AxisGizmo(hudRoot);

startLoop({
  update(dt) {
    ship.update(dt, input);
  },
  render(frameTime, elapsed) {
    if (input.isDown('KeyC')) chaseCamera.resetView();
    ship.syncObject(elapsed, frameTime);
    chaseCamera.update(frameTime, ship.state);
    wake.update(elapsed, ship.state);
    ocean.update(elapsed, ship.state.x, ship.state.z, camera, canvas.clientHeight);
    hud.update(ship.state, ship.controls);
    axisGizmo.update(camera, ship.state);
    renderer.render(scene, camera);
  },
});
