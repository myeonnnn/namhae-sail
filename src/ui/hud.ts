import type { ShipControls, ShipState } from '../ship/shipPhysics';

const MS_TO_KNOTS = 1.943844;
const MAX_RUDDER_DEG = 35;

export class Hud {
  private readonly fields: Record<'speed' | 'heading' | 'throttle' | 'rudder' | 'position', HTMLElement>;

  constructor(root: HTMLElement) {
    const status = document.createElement('dl');
    status.className = 'hud-panel hud-status';
    const field = (label: string) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      status.append(term, value);
      return value;
    };
    this.fields = {
      speed: field('속력'),
      heading: field('침로'),
      throttle: field('스로틀'),
      rudder: field('타각'),
      position: field('위치'),
    };

    const help = document.createElement('div');
    help.className = 'hud-panel hud-help';
    help.innerHTML = [
      'W / S : 스로틀 증가 / 감소',
      'A / D : 좌현 / 우현 타',
      'Space : 스로틀 중립',
      'C : 시점 초기화',
      '드래그 / 휠 : 시점 회전 / 거리',
    ].join('<br />');

    root.append(status, help);
  }

  update(state: ShipState, controls: ShipControls): void {
    const { fields } = this;
    const speed = Math.hypot(state.surge, state.sway) * Math.sign(state.surge || 1);
    const rudderDeg = controls.rudder * MAX_RUDDER_DEG;

    fields.speed.textContent = `${(speed * MS_TO_KNOTS).toFixed(1)} kn`;
    fields.heading.textContent = `${((state.heading * 180) / Math.PI).toFixed(0).padStart(3, '0')}°`;
    fields.throttle.textContent = `${(controls.throttle * 100).toFixed(0)} %`;
    fields.rudder.textContent =
      Math.abs(rudderDeg) < 0.5 ? '중앙' : `${rudderDeg > 0 ? '우현' : '좌현'} ${Math.abs(rudderDeg).toFixed(0)}°`;
    // -Z가 북쪽이므로 북쪽 거리는 z의 부호를 뒤집어서 표시한다.
    fields.position.textContent = `E ${state.x.toFixed(0)} m / N ${(-state.z).toFixed(0)} m`;
  }
}
