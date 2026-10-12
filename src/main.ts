import './style.css';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { createStage } from './core/renderer';
import { Ocean } from './ocean/ocean';
import { ChaseCamera } from './ship/chaseCamera';
import { Ship } from './ship/ship';
import { AxisGizmo } from './ui/axisGizmo';
import { Hud } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const { renderer, scene, camera } = createStage(canvas);

const input = new Input();
const ocean = new Ocean(scene, renderer);
const ship = new Ship();
scene.add(ship.object);

const chaseCamera = new ChaseCamera(camera, canvas);
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const hud = new Hud(hudRoot);
const axisGizmo = new AxisGizmo(hudRoot);

startLoop({
  update(dt) {
    ship.update(dt, input);
  },
  render(frameTime, elapsed) {
    if (input.isDown('KeyC')) chaseCamera.resetView();
    ship.syncObject(elapsed);
    chaseCamera.update(frameTime, ship.state);
    ocean.update(frameTime, camera);
    hud.update(ship.state, ship.controls);
    axisGizmo.update(camera, ship.state);
    renderer.render(scene, camera);
  },
});
