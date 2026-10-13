/**
 * 화면 위의 버튼을 만든다.
 * 키보드로 배를 조종하는 화면이므로, 버튼이 포커스를 가지면 스로틀 중립 키인 Space나 방향키가 버튼을 누르게 된다.
 * 그래서 탭으로 이동할 수 없게 하고, 누른 뒤에는 포커스를 풀어 준다.
 */
export function createButton(options: {
  /** 버튼의 내용. 문자열이면 글자로, 요소의 목록이면 그대로 넣는다. */
  content?: string | Node[];
  /** 아이콘처럼 마크업으로 적은 내용. 코드에 적어 둔 문자열만 넣어야 한다. */
  html?: string;
  className?: string;
  /** 아이콘만 있는 버튼에 주는 이름. 마우스를 올렸을 때의 설명과 화면 낭독기용 이름으로 함께 쓰인다. */
  label?: string;
  onClick: () => void;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  if (options.className) button.className = options.className;
  if (typeof options.content === 'string') button.textContent = options.content;
  else if (options.content) button.append(...options.content);
  if (options.html) button.innerHTML = options.html;
  if (options.label) {
    button.title = options.label;
    button.setAttribute('aria-label', options.label);
  }
  button.addEventListener('click', () => {
    options.onClick();
    button.blur();
  });
  return button;
}

/**
 * 글자가 바뀌었을 때에만 고친다.
 * 매 프레임 갱신하는 표시 장치에서 같은 값을 다시 쓰면, 브라우저가 그때마다 글자를 새로 만들고 배치를 다시 계산한다.
 */
export function writeText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** 속성의 값이 바뀌었을 때에만 고친다. */
export function writeAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
