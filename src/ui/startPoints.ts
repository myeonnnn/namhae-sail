import type { StartPoint } from '../geo/region';
import { createButton } from './dom';

/** 설정 메뉴에 넣는 시작 위치의 목록. 항목을 누르면 배를 그 위치로 옮긴다. */
export function createStartPointList(points: StartPoint[], onSelect: (point: StartPoint) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'hud-start-points';
  for (const point of points) {
    const name = document.createElement('strong');
    name.textContent = point.name;
    const note = document.createElement('span');
    note.textContent = point.note;
    list.append(createButton({ content: [name, note], onClick: () => onSelect(point) }));
  }
  return list;
}
