import { createButton } from './dom';

const GEAR_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.5 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.5 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1c-1.5.9-3.3-.9-2.4-2.4a1.7 1.7 0 0 0-1-2.6c-1.8-.4-1.8-2.9 0-3.4a1.7 1.7 0 0 0 1-2.5c-.9-1.6.9-3.3 2.4-2.4a1.7 1.7 0 0 0 2.6-1.1z" />
    <circle cx="12" cy="12" r="3" />
  </svg>`;
const BUTTON_LABEL = '설정';

/**
 * 톱니바퀴 버튼을 누르면 아래로 펼쳐지는 설정 메뉴.
 * 메뉴 안의 각 항목은 제목을 누르면 내용이 펼쳐지는 구역이며, addSection으로 추가한다.
 */
export class SettingsMenu {
  private readonly button: HTMLButtonElement;
  private readonly dropdown = document.createElement('div');

  constructor(root: HTMLElement) {
    const container = document.createElement('div');
    container.className = 'hud-settings';

    const { dropdown } = this;
    const button = (this.button = createButton({
      html: GEAR_ICON,
      className: 'hud-icon-button hud-settings-button',
      label: BUTTON_LABEL,
      onClick: () => this.setOpen(dropdown.hidden !== false),
    }));
    button.setAttribute('aria-haspopup', 'true');

    dropdown.className = 'hud-panel hud-settings-dropdown';
    this.setOpen(false);

    // 메뉴의 바깥을 누르거나 Esc를 누르면 닫는다.
    document.addEventListener('pointerdown', (event) => {
      if (!container.contains(event.target as Node)) this.setOpen(false);
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') this.setOpen(false);
    });

    container.append(button, dropdown);
    root.append(container);
  }

  /** 메뉴에 구역을 추가한다. 제목을 누르면 내용이 펼쳐지거나 접힌다. */
  addSection(title: string, content: HTMLElement, expanded = false): void {
    const section = document.createElement('section');
    section.className = 'hud-settings-section';

    const header = createButton({
      content: title,
      className: 'hud-settings-header',
      onClick: () => setExpanded(content.hidden !== false),
    });
    const setExpanded = (value: boolean) => {
      content.hidden = !value;
      header.setAttribute('aria-expanded', String(value));
    };
    setExpanded(expanded);

    content.classList.add('hud-settings-content');
    section.append(header, content);
    this.dropdown.append(section);
  }

  /** 메뉴를 닫는다. 메뉴 안의 항목을 골랐을 때, 화면을 가리지 않도록 호출한다. */
  close(): void {
    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    this.dropdown.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }
}
