import { Inclinometer, SeaDirectionDial } from './dials';
import { createButton } from './dom';

interface GuideItem {
  title: string;
  body: string;
  /** 설명 옆에 그릴 그림을 만든다. 계기는 실제 계기판과 같은 부품을 예시의 값으로 그린다. */
  figure(): HTMLElement;
}

/** 계기 하나를 예시의 값으로 그린 그림 */
function dial(markup: string, setup: (container: HTMLElement) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'guide-figure';
  container.innerHTML = markup;
  setup(container);
  return container;
}

/** 계기가 아닌 항목에 넣는 단순한 그림 */
function sketch(svg: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'guide-figure';
  container.innerHTML = svg;
  return container;
}

const ITEMS: GuideItem[] = [
  {
    title: '파도 방향 계기',
    body: '위쪽이 선수입니다. 하늘색 화살표는 풍랑이, 주황색 화살표는 너울이 오는 방향입니다. 화살표가 좌우의 붉은 호에 들어가면 파도를 옆으로 받는 중이고, 선체가 가장 크게 기울어집니다. 선수를 돌려서 파도를 앞이나 뒤로 받으세요.',
    figure: () =>
      dial(SeaDirectionDial.MARKUP, (container) =>
        new SeaDirectionDial(container).update(0, { speed: 20, fromDeg: 95 }, { height: 1.5, fromDeg: 150 }),
      ),
  },
  {
    title: '경사계',
    body: '선체의 좌우 기울기입니다. 추가 붉은 구간(30° 이상)에 들어가면 위험하고, 약 65°를 넘으면 스스로 일어서지 못하고 뒤집힙니다. 기울어지는 쪽의 반대로 타를 쓰면 선체가 일어섭니다.',
    figure: () => dial(Inclinometer.MARKUP, (container) => new Inclinometer(container).update((34 * Math.PI) / 180)),
  },
  {
    title: '흰 물거품',
    body: '수면에서 희게 부서지는 곳은 선체를 넘어뜨릴 만큼 가파른 마루입니다. 화면에 보이는 물거품과 선체가 받는 힘은 같은 기준으로 계산하므로, 물거품을 피하면 실제로 안전합니다.',
    figure: () =>
      sketch(`<svg viewBox="0 0 72 58" width="72" height="58" aria-hidden="true">
        <path d="M2 40 C14 40 18 18 30 18 C40 18 42 34 52 36 C60 38 64 34 70 34 L70 56 L2 56 Z" fill="#12456b" />
        <path d="M22 22 C26 16 34 16 38 22 C34 20 26 20 22 22 Z M27 17 C30 14 34 15 36 18" fill="#f2f8fb" stroke="#f2f8fb" stroke-width="2" stroke-linecap="round" />
      </svg>`),
  },
  {
    title: '속력',
    body: '빠를수록 마루에 세게 부딪히고, 높은 속력으로 가파른 마루를 넘으면 파도를 앞이나 뒤로 받아도 기울어집니다. 위험한 구간에서는 S로 스로틀을 내리세요. 뒤집혀서 받는 벌점보다 잠깐 늦추는 편이 빠릅니다.',
    figure: () =>
      sketch(`<svg viewBox="0 0 72 58" width="72" height="58" aria-hidden="true">
        <rect x="31" y="6" width="10" height="46" rx="5" fill="rgba(232,241,248,0.14)" />
        <rect x="31" y="20" width="10" height="9" rx="4" fill="#7fd0ff" />
        <path d="M52 14 L52 30 M47 25 L52 30 L57 25" fill="none" stroke="#ffb45c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>`),
  },
];

/**
 * 계기판을 읽는 법과 거친 바다에서 조종하는 요령을 한 장에 모은 안내 화면.
 * 시작 화면과 설정 메뉴에서 열고, 닫기 버튼이나 Esc, 바깥을 눌러서 닫는다.
 */
export class Guide {
  private readonly overlay = document.createElement('div');

  constructor(root: HTMLElement) {
    const { overlay } = this;
    overlay.className = 'guide-overlay';
    overlay.hidden = true;

    const card = document.createElement('div');
    card.className = 'guide-card';
    const title = document.createElement('h2');
    title.textContent = '거친 바다에서 살아남는 법';
    const lead = document.createElement('p');
    lead.className = 'guide-lead';
    lead.textContent =
      '배를 뒤집는 것은 바람이 아니라 파도입니다. 파도를 어느 쪽에서, 얼마나 빠르게 받는지를 계기로 읽고 조절하세요.';
    card.append(title, lead);

    for (const item of ITEMS) {
      const row = document.createElement('section');
      row.className = 'guide-item';
      const text = document.createElement('div');
      const heading = document.createElement('h3');
      heading.textContent = item.title;
      const body = document.createElement('p');
      body.textContent = item.body;
      text.append(heading, body);
      row.append(item.figure(), text);
      card.append(row);
    }

    card.append(createButton({ content: '닫기', className: 'guide-close', onClick: () => this.close() }));
    overlay.append(card);
    root.append(overlay);

    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) this.close();
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') this.close();
    });
  }

  open(): void {
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
  }
}
