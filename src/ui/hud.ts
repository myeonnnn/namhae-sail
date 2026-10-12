import { worldToLatLon } from '../geo/projection';
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
    const { lat, lon } = worldToLatLon(state.x, state.z);
    fields.position.textContent = `${formatAngle(lat, 'N', 'S')} ${formatAngle(lon, 'E', 'W')}`;
  }
}

/** 해도에서 사용하는 도와 분의 형식으로 표시한다. 위도 1분은 1해리(1852m)에 해당한다. */
function formatAngle(value: number, positive: string, negative: string): string {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return `${degrees}°${minutes.toFixed(3).padStart(6, '0')}′${value >= 0 ? positive : negative}`;
}
