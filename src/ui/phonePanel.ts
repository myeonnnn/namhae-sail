import qrcode from 'qrcode-generator';
import { LINK_STATUS_LABELS, type LinkStatus } from '../controller/link';
import { controllerUrl } from '../controller/pairing';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** 핸드폰을 컨트롤러로 쓰는 데 필요한 환경. 연결이 안 될 때 사용자가 스스로 원인을 찾을 수 있게 보여 준다. */
const REQUIREMENTS: ReadonlyArray<[subject: string, detail: string]> = [
  ['와이파이', 'PC와 핸드폰이 같은 와이파이에 있어야 합니다. 공용, 게스트 와이파이에서는 연결되지 않을 수 있습니다.'],
  ['핸드폰', 'iPhone은 iOS 13 이상의 Safari, 안드로이드는 최신 Chrome. 기울기를 재는 동작 센서가 필요합니다.'],
  ['PC', '최신 Chrome, Edge, Safari, Firefox'],
];

/** 시작 화면에서 보여 주는 연결 순서 */
const STEPS = [
  'PC와 핸드폰을 같은 와이파이에 연결합니다.',
  '핸드폰 카메라로 QR 코드를 찍습니다.',
  '핸드폰을 가로로 들고 "기울기 사용"을 누릅니다.',
  '핸드폰을 핸들처럼 돌려 조타하고, 오른쪽 버튼으로 스로틀을 조절합니다.',
];

/**
 * 핸드폰을 연결하는 QR 코드와 연결 상태, 필요한 환경을 보여 준다.
 * 메뉴(menu)에는 짧게, 시작 화면(start)에는 소개와 연결 순서를 더해서 보여 준다.
 */
export class PhonePanel {
  readonly element = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly qr = document.createElement('div');
  private peerId?: string;
  /** 컨트롤러 주소의 기준이 되는 게임 주소. 개발 중에 localhost로 열었으면 LAN 주소로 바꾼다. */
  private gameUrl = location.href;

  constructor(variant: 'menu' | 'start') {
    this.element.className = `hud-phone hud-phone-${variant}`;
    this.status.className = 'hud-phone-status';
    this.qr.className = 'hud-phone-qr';

    if (variant === 'start') {
      const title = document.createElement('h2');
      title.className = 'hud-phone-title';
      title.textContent = '핸드폰을 컨트롤러로';
      const intro = document.createElement('p');
      intro.className = 'hud-phone-intro';
      intro.textContent = '앱을 설치하지 않고, 핸드폰을 핸들처럼 돌려서 조타하고 버튼으로 스로틀을 조절할 수 있습니다.';
      this.element.append(title, intro, this.qr, this.status, createSteps());
    } else {
      const hint = document.createElement('p');
      hint.className = 'hud-phone-hint';
      hint.textContent = '핸드폰 카메라로 QR 코드를 찍으면 컨트롤러가 열립니다.';
      this.element.append(this.status, this.qr, hint);
    }
    this.element.append(createRequirements());

    // localhost 주소는 핸드폰에서 핸드폰 자신을 가리키므로, 개발 서버에 LAN 주소를 물어서 QR 코드에 넣는다.
    if (LOCAL_HOSTS.includes(location.hostname)) {
      const warning = document.createElement('p');
      warning.className = 'hud-phone-warning';
      warning.textContent =
        '지금 주소(localhost)로는 핸드폰이 접속할 수 없습니다. 개발 서버를 pnpm dev:lan으로 다시 여세요.';
      this.element.append(warning);
      if (import.meta.env.DEV) void this.useLanAddress(warning);
    }
    this.setStatus('connecting');
  }

  setStatus(status: LinkStatus, peerId?: string): void {
    this.status.dataset.status = status;
    this.status.textContent = `핸드폰 ${LINK_STATUS_LABELS[status]}`;
    if (peerId && peerId !== this.peerId) this.showCode(peerId);
  }

  private async useLanAddress(warning: HTMLElement): Promise<void> {
    try {
      const lan = (await (await fetch('/__lan-url')).text()).trim();
      if (!lan) return;
      this.gameUrl = new URL(location.pathname, lan).href;
      warning.remove();
      if (this.peerId) this.showCode(this.peerId);
    } catch {
      // 개발 서버가 LAN 주소를 알려 주지 못하면 경고를 그대로 두어, 사용자가 Network 주소로 게임을 열게 한다.
    }
  }

  private showCode(peerId: string): void {
    this.peerId = peerId;
    // 주소는 글자로 보여 주지 않는다. 핸드폰에서 따라 칠 일이 없고, 게임 ID를 화면에 드러낼 필요도 없다.
    const url = controllerUrl(this.gameUrl, peerId);
    // 오류 정정 수준을 M으로 두어, 화면의 반사나 흔들림이 있어도 핸드폰 카메라가 읽을 수 있게 한다.
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    this.qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
}

function createSteps(): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'hud-phone-steps';
  for (const step of STEPS) {
    const item = document.createElement('li');
    item.textContent = step;
    list.append(item);
  }
  return list;
}

function createRequirements(): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'hud-phone-requirements';
  for (const [subject, detail] of REQUIREMENTS) {
    const term = document.createElement('dt');
    term.textContent = subject;
    const description = document.createElement('dd');
    description.textContent = detail;
    list.append(term, description);
  }
  return list;
}
