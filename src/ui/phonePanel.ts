import qrcode from 'qrcode-generator';
import { LINK_STATUS_LABELS, type LinkStatus } from '../controller/link';
import { controllerUrl } from '../controller/pairing';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** 핸드폰 연결 메뉴의 내용. 핸드폰으로 찍을 QR 코드와 주소, 연결 상태를 보여 준다. */
export class PhonePanel {
  readonly element = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly qr = document.createElement('div');
  private readonly link = document.createElement('a');
  private peerId?: string;
  /** 컨트롤러 주소의 기준이 되는 게임 주소. 개발 중에 localhost로 열었으면 LAN 주소로 바꾼다. */
  private gameUrl = location.href;

  constructor() {
    this.element.className = 'hud-phone';
    this.status.className = 'hud-phone-status';
    this.qr.className = 'hud-phone-qr';
    this.link.className = 'hud-phone-link';
    this.link.target = '_blank';
    this.link.rel = 'noopener';

    const hint = document.createElement('p');
    hint.className = 'hud-phone-hint';
    hint.textContent = '핸드폰 카메라로 QR 코드를 찍으면 컨트롤러가 열립니다.';
    this.element.append(this.status, this.qr, this.link, hint);

    // localhost 주소는 핸드폰에서 핸드폰 자신을 가리키므로, 개발 서버에 LAN 주소를 물어서 QR 코드에 넣는다.
    if (LOCAL_HOSTS.includes(location.hostname)) {
      const warning = document.createElement('p');
      warning.className = 'hud-phone-warning';
      warning.textContent =
        '지금 주소(localhost)로는 핸드폰이 접속할 수 없습니다. 개발 서버가 알려 주는 Network 주소로 게임을 여세요.';
      this.element.append(warning);
      if (import.meta.env.DEV) void this.useLanAddress(warning);
    }
    this.setStatus('connecting');
  }

  setStatus(status: LinkStatus, peerId?: string): void {
    this.status.dataset.status = status;
    this.status.textContent = LINK_STATUS_LABELS[status];
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
    const url = controllerUrl(this.gameUrl, peerId);
    // 오류 정정 수준을 M으로 두어, 화면의 반사나 흔들림이 있어도 핸드폰 카메라가 읽을 수 있게 한다.
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    this.qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    this.link.href = url;
    this.link.textContent = url;
  }
}
