const KEY_GUIDE: ReadonlyArray<[keys: string[], action: string]> = [
  [['W', 'S'], '스로틀 증가 / 감소'],
  [['A', 'D'], '좌현 / 우현 타'],
  [['Space'], '스로틀 중립'],
  [['C'], '시점 초기화'],
  [['드래그'], '시점 회전'],
  [['휠'], '카메라 거리'],
  [['Esc'], '메뉴 닫기'],
];

/** 조작 키와 그 동작을 한 줄씩 나열한 목록을 생성한다. */
export function createKeyGuide(): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'hud-keys';
  for (const [keyNames, action] of KEY_GUIDE) {
    const keys = document.createElement('dt');
    for (const name of keyNames) {
      const key = document.createElement('kbd');
      key.textContent = name;
      keys.append(key);
    }
    const description = document.createElement('dd');
    description.textContent = action;
    list.append(keys, description);
  }
  return list;
}
