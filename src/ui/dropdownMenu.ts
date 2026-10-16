import { createButton } from './dom';

/**
 * 이름이 적힌 버튼을 누르면 아래로 펼쳐지는 메뉴. 화면의 왼쪽 위에 역할별로 하나씩 나란히 둔다.
 * 내용이 한 가지이면 setContent로 그대로 넣고, 여러 가지이면 제목을 누르면 펼쳐지는 구역을 addSection으로 추가한다.
 */
export class DropdownMenu {
  private readonly button: HTMLButtonElement;
  private readonly dropdown = document.createElement('div');
  private onOpen?: () => void;

  /**
   * @param bar 메뉴의 버튼들을 나란히 놓는 요소
   * @param label 버튼에 적는 이름
   * @param order 나란히 놓는 순서. 메뉴가 만들어진 순서와 관계없이 이 값이 작은 것부터 왼쪽에 놓인다.
   */
  constructor(bar: HTMLElement, label: string, order: number) {
    const container = document.createElement('div');
    container.className = 'hud-menu';
    container.style.order = String(order);

    const { dropdown } = this;
    const button = (this.button = createButton({
      content: label,
      className: 'hud-menu-button',
      onClick: () => this.setOpen(dropdown.hidden !== false),
    }));
    button.setAttribute('aria-haspopup', 'true');

    dropdown.className = 'hud-panel hud-menu-dropdown';
    this.setOpen(false);

    // 메뉴의 바깥을 누르거나 Esc를 누르면 닫는다. 다른 메뉴의 버튼을 눌러도 바깥이므로, 메뉴는 한 번에 하나만 열린다.
    document.addEventListener('pointerdown', (event) => {
      if (!container.contains(event.target as Node)) this.setOpen(false);
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') this.setOpen(false);
    });

    container.append(button, dropdown);
    bar.append(container);
  }

  /**
   * 메뉴의 내용을 제목 없이 그대로 넣는다. 내용이 한 가지뿐인 메뉴에 사용한다.
   * @param onOpen 메뉴를 열 때마다 부른다. 열기 전에는 준비할 필요가 없는 내용에 사용한다
   */
  setContent(content: HTMLElement, onOpen?: () => void): void {
    this.onOpen = onOpen;
    content.classList.add('hud-menu-content', 'hud-menu-single');
    this.dropdown.append(content);
  }

  /** 메뉴에 구역을 추가한다. 제목을 누르면 내용이 펼쳐지거나 접힌다. */
  addSection(title: string, content: HTMLElement, expanded = false): void {
    const section = document.createElement('section');
    section.className = 'hud-menu-section';

    const header = createButton({
      content: title,
      className: 'hud-menu-header',
      onClick: () => setExpanded(content.hidden !== false),
    });
    const setExpanded = (value: boolean) => {
      content.hidden = !value;
      header.setAttribute('aria-expanded', String(value));
    };
    setExpanded(expanded);

    content.classList.add('hud-menu-content');
    section.append(header, content);
    this.dropdown.append(section);
  }

  /**
   * 버튼의 이름과 상태를 바꾼다. 메뉴를 열지 않아도 상태를 알 수 있게 할 때 쓴다.
   * @param state 버튼의 data-state에 넣는 값. CSS가 이 값으로 모양을 바꾼다. 지정하지 않으면 지운다
   */
  setLabel(label: string, state?: string): void {
    this.button.textContent = label;
    if (state) this.button.dataset.state = state;
    else delete this.button.dataset.state;
  }

  /** 메뉴를 연다. 시작 화면의 "타임어택 도전"처럼 버튼을 누르지 않고 메뉴를 열 때 쓴다. */
  open(): void {
    this.setOpen(true);
  }

  /** 메뉴를 닫는다. 메뉴 안의 항목을 골랐을 때, 화면을 가리지 않도록 호출한다. */
  close(): void {
    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    this.dropdown.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.onOpen?.();
  }
}
