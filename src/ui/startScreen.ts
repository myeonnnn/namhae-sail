import { createKeyGuide } from './keyGuide';

/** 화면의 각 요소와, 그것을 그리는 데 사용한 자료 또는 계산 */
const DATA_SOURCES: ReadonlyArray<[subject: string, source: string]> = [
  ['지형의 높이', 'NASA의 위성 측량(SRTM)을 바탕으로 한 공개 표고 자료 (Mapzen Terrain Tiles)'],
  ['해안선과 해도', 'OpenStreetMap에 등록된 해안선, 지명, 시가지'],
  ['방파제, 부두, 다리', 'OpenStreetMap에 등록된 윤곽. 높이는 자료에 없어서 추정한 값입니다.'],
  ['등대, 등표, 부표', 'OpenStreetMap에 등록된 위치와 등화의 색상, 깜빡이는 주기'],
  ['파도', '풍속으로부터 파도의 높이를 구하는 해양학의 경험식 (Pierson–Moskowitz 스펙트럼)'],
  ['태양과 햇빛', '오늘 날짜와 시각, 이 해역의 위치로 계산한 태양의 고도와 방위'],
];

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
  private readonly raceButton = document.createElement('button');
  private ready = false;

  /**
   * @param actions.timeAttack 타임어택 버튼을 눌렀을 때 호출한다. 시작 화면을 닫은 다음에 호출된다.
   * @param actions.guide 가이드를 여는 버튼을 눌렀을 때 호출한다. 시작 화면은 닫지 않는다.
   */
  constructor(root: HTMLElement, actions: { timeAttack?: () => void; guide?: () => void } = {}) {
    const { overlay, status, button, raceButton } = this;
    overlay.className = 'start-screen';

    const card = document.createElement('div');
    card.className = 'start-card';

    const title = document.createElement('h1');
    const logo = document.createElement('img');
    logo.src = '/favicon.svg';
    logo.alt = '';
    logo.width = 34;
    logo.height = 34;
    title.append(logo, 'Namhae Sail');
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

    // 화면에 보이는 것이 어떤 자료와 계산에서 나온 것인지 알려 준다.
    const sources = document.createElement('dl');
    sources.className = 'start-sources';
    for (const [subject, source] of DATA_SOURCES) {
      const term = document.createElement('dt');
      term.textContent = subject;
      const description = document.createElement('dd');
      description.textContent = source;
      sources.append(term, description);
    }
    const sourcesTitle = document.createElement('h2');
    sourcesTitle.textContent = '사용한 데이터';

    status.className = 'start-status';
    status.textContent = '지형과 선박을 불러오는 중…';

    button.type = 'button';
    button.textContent = '항해 시작';
    button.hidden = true;
    button.addEventListener('click', () => this.dismiss());

    raceButton.type = 'button';
    raceButton.className = 'start-secondary';
    raceButton.textContent = '타임어택 도전';
    raceButton.hidden = true;
    raceButton.addEventListener('click', () => {
      this.dismiss();
      actions.timeAttack?.();
    });

    card.append(guide, sourcesTitle, sources, status, button);
    if (actions.timeAttack) card.append(raceButton);
    if (actions.guide) {
      const guideButton = document.createElement('button');
      guideButton.type = 'button';
      guideButton.className = 'start-link';
      guideButton.textContent = '계기판을 읽는 법과 거친 바다의 요령 보기';
      guideButton.addEventListener('click', () => actions.guide?.());
      card.append(guideButton);
    }
    overlay.append(card);
    root.append(overlay);

    // 준비가 끝난 뒤에는 조종에 쓰는 키를 눌러도 바로 시작한다.
    window.addEventListener('keydown', (event) => {
      if (document.querySelector('.guide-overlay:not([hidden])')) return;
      if (this.ready && ['Enter', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) this.dismiss();
    });
  }

  /** 자료를 모두 불러왔을 때 호출한다. 진행 상태를 지우고 시작 버튼을 보여 준다. */
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.status.hidden = true;
    this.button.hidden = false;
    this.raceButton.hidden = false;
  }

  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.overlay.classList.add('start-screen-leaving');
    // 서서히 사라지는 동안에도 아래의 화면을 조작할 수 있도록, 사라진 뒤에 요소를 제거한다.
    window.setTimeout(() => this.overlay.remove(), 400);
  }
}
