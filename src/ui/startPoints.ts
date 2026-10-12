export interface StartPoint {
  name: string;
  /** 어떤 곳인지 알려 주는 짧은 설명 */
  note: string;
  lat: number;
  lon: number;
  headingDeg: number;
}

/** 설정 메뉴에 넣는 시작 위치의 목록. 항목을 누르면 배를 그 위치로 옮긴다. */
export function createStartPointList(points: StartPoint[], onSelect: (point: StartPoint) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'hud-start-points';
  for (const point of points) {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    const name = document.createElement('strong');
    name.textContent = point.name;
    const note = document.createElement('span');
    note.textContent = point.note;
    button.append(name, note);
    button.addEventListener('click', () => {
      onSelect(point);
      // 버튼에 포커스가 남아 있으면 스로틀 중립 키인 Space가 버튼을 누르게 된다.
      button.blur();
    });
    list.append(button);
  }
  return list;
}
