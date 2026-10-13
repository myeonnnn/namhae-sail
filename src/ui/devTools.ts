import type { ChartPlace } from '../world/chartData';
import { createButton } from './dom';

export interface DevToolsActions {
  toggleObserver(): void;
  moveShipHere(): void;
  goToPlace(place: ChartPlace): void;
}

const PLACE_KINDS: ReadonlyArray<[ChartPlace['kind'], string]> = [
  ['city', '시'],
  ['town', '읍면'],
  ['island', '섬'],
];

/**
 * 개발 도구 메뉴에 넣는 개발 도구: 관찰 모드를 켜고 끄는 버튼, 배를 옮기는 버튼, 장소로 바로 이동하는 목록.
 * 구역의 여러 곳을 확인할 때 배를 직접 몰고 가지 않아도 되게 한다.
 */
export function createDevTools(places: Promise<ChartPlace[]>, actions: DevToolsActions): HTMLElement {
  const container = document.createElement('div');
  container.className = 'hud-devtools';

  const button = (label: string, shortcut: string, onClick: () => void) =>
    createButton({ html: `${label} <kbd>${shortcut}</kbd>`, onClick });

  const select = document.createElement('select');
  select.tabIndex = -1;
  const placeholder = document.createElement('option');
  placeholder.textContent = '장소로 이동…';
  placeholder.value = '';
  select.append(placeholder);

  void places.then((list) => {
    for (const [kind, label] of PLACE_KINDS) {
      const group = document.createElement('optgroup');
      group.label = label;
      list
        .filter((place) => place.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        .forEach((place) => {
          const option = document.createElement('option');
          option.textContent = place.name;
          option.value = String(list.indexOf(place));
          group.append(option);
        });
      select.append(group);
    }
    select.addEventListener('change', () => {
      if (select.value !== '') actions.goToPlace(list[Number(select.value)]);
      select.value = '';
      select.blur();
    });
  });

  container.append(
    button('관찰 모드', 'F', actions.toggleObserver),
    button('배를 이 위치로', 'T', actions.moveShipHere),
    select,
  );
  return container;
}
