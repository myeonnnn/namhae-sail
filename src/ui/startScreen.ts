import { createKeyGuide } from './keyGuide';

/**
 * 처음 접속했을 때 화면을 덮는 시작 화면.
 * 자료를 불러오는 동안에는 진행 상태를 표시하고, 준비가 끝나면 조작 방법과 함께 시작 버튼을 보여 준다.
 * 사용자가 시작하기 전까지는 배의 시간이 흐르지 않는다.
 */
export class StartScreen {
  /** 사용자가 시작 버튼을 누르거나 키를 눌러서 화면을 닫았으면 true */
  dismissed = false;

  private readonly overlay = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly button = document.createElement('button');
  private ready = false;

  constructor(root: HTMLElement) {
    const { overlay, status, button } = this;
    overlay.className = 'start-screen';

    const card = document.createElement('div');
    card.className = 'start-card';

    const title = document.createElement('h1');
    title.textContent = 'Namhae Sail';
    const summary = document.createElement('p');
    summary.className = 'start-summary';
    summary.textContent = '통영과 거제 사이의 한려수도를 요트로 항해합니다. 지형과 해도, 바람과 파도, 태양의 위치는 실제 자료와 물리 수식으로 계산합니다.';

    card.append(title, summary);

    // 키보드 없이 터치로만 조작하는 기기에서는 배를 조종할 수 없으므로 미리 알린다.
    if (window.matchMedia('(pointer: coarse) and (hover: none)').matches) {
      const notice = document.createElement('p');
      notice.className = 'start-notice';
      notice.textContent = '이 시뮬레이터는 키보드로 조종합니다. 휴대전화나 태블릿에서는 둘러보기만 가능하며, 데스크톱에서 여는 것을 권장합니다.';
      card.append(notice);
    }

    const guide = createKeyGuide();
    guide.classList.add('start-keys');

    status.className = 'start-status';
    status.textContent = '지형과 선박을 불러오는 중…';

    button.type = 'button';
    button.textContent = '항해 시작';
    button.hidden = true;
    button.addEventListener('click', () => this.dismiss());

    card.append(guide, status, button);
    overlay.append(card);
    root.append(overlay);

    // 준비가 끝난 뒤에는 조종에 쓰는 키를 눌러도 바로 시작한다.
    window.addEventListener('keydown', (event) => {
      if (this.ready && ['Enter', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) this.dismiss();
    });
  }

  /** 자료를 모두 불러왔을 때 호출한다. 진행 상태를 지우고 시작 버튼을 보여 준다. */
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.status.hidden = true;
    this.button.hidden = false;
  }

  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.overlay.classList.add('start-screen-leaving');
    // 서서히 사라지는 동안에도 아래의 화면을 조작할 수 있도록, 사라진 뒤에 요소를 제거한다.
    window.setTimeout(() => this.overlay.remove(), 400);
  }
}
