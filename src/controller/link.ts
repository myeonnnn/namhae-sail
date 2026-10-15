import { Peer, type DataConnection, type PeerConnectOption } from 'peerjs';
import { HELM_CHANNEL } from './protocol';

/** 게임과 컨트롤러가 화면에 표시하는 연결 상태 */
export type LinkStatus = 'connecting' | 'connected' | 'disconnected';

export const LINK_STATUS_LABELS: Record<LinkStatus, string> = {
  connecting: '연결 중',
  connected: '연결됨',
  disconnected: '끊김',
};

// 조종 값은 초당 30번 새 값을 보내므로, 잃어버린 메시지를 다시 보내거나 순서를 맞추느라 기다리면 오히려 지난 값을 쓰게 된다.
// 메시지는 이미 문자열이므로 PeerJS의 직렬화를 거치지 않고 그대로 보낸다.
const CONNECT_OPTIONS: PeerConnectOption = { serialization: 'raw', reliable: false };

// 핸드폰은 PC와 같은 와이파이에서만 연결한다. STUN과 TURN 서버를 비워 두면 브라우저가 자기 LAN 주소만 알리므로,
// 조종 값이 공유기 밖으로 나가지 않고, 해외에 있는 공개 중계 서버를 거쳐 느려지는 일도 없다.
const PEER_OPTIONS = { config: { iceServers: [] } };

/** 이 시간(ms) 안에 연결되지 않으면 같은 와이파이가 아닌 것으로 보고 안내한다. */
const CONNECT_TIMEOUT_MS = 10_000;

/** 연결이 늦어질 때 컨트롤러가 띄우는 안내 */
export const SAME_WIFI_NOTICE = 'PC와 같은 와이파이에 연결되어 있는지 확인해 주세요.';

/**
 * 게임 쪽의 연결. 같은 PC의 탭과 핸드폰에서 오는 조종 메시지를 같은 콜백으로 넘긴다.
 * 같은 PC의 탭은 처음부터 받고, 핸드폰은 open을 부른 뒤부터 받는다.
 */
export class HelmHost {
  private peer?: Peer;
  private connection?: DataConnection;

  constructor(private readonly onText: (text: string) => void) {
    new BroadcastChannel(HELM_CHANNEL).addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') onText(event.data);
    });
  }

  /**
   * 시그널링 서버에 접속해서 핸드폰이 연결할 ID를 받는다. 여러 번 불러도 한 번만 접속한다.
   * 공개 서버에 접속하므로, 핸드폰을 쓰지 않는 사람까지 접속하지 않도록 메뉴를 열 때 부른다.
   * @param onStatus 연결 상태가 바뀔 때마다 부른다. peerId는 서버에서 ID를 받은 뒤부터 넘긴다
   */
  open(onStatus: (status: LinkStatus, peerId?: string) => void): void {
    if (this.peer) return;
    const peer = (this.peer = new Peer(PEER_OPTIONS));
    onStatus('connecting');

    peer.on('open', (id) => onStatus(this.connection?.open ? 'connected' : 'connecting', id));
    peer.on('connection', (connection) => {
      // 컨트롤러는 하나만 쓴다. 핸드폰 두 대가 번갈아 조종하면 배가 어느 쪽을 따르는지 알 수 없다.
      this.connection?.close();
      this.connection = connection;
      connection.on('open', () => {
        onStatus('connected', peer.id);
        // PeerJS는 ICE가 failed가 되어야 close를 알리는데, 핸드폰이 화면을 끄거나 와이파이를 벗어나면 그때까지 수십 초가 걸린다.
        // 그래서 ICE가 disconnected가 되는 몇 초 안에 끊김으로 표시하고, 다시 이어지면 연결됨으로 되돌린다.
        const pc = connection.peerConnection;
        pc.addEventListener('iceconnectionstatechange', () => {
          if (this.connection !== connection) return;
          const state = pc.iceConnectionState;
          if (state === 'disconnected' || state === 'failed') onStatus('disconnected', peer.id);
          else if (state === 'connected' || state === 'completed') onStatus('connected', peer.id);
        });
      });
      connection.on('data', (data) => {
        if (typeof data === 'string') this.onText(data);
      });
      connection.on('close', () => {
        // 새 연결로 바꾸면서 닫은 이전 연결이면 상태를 바꾸지 않는다.
        if (this.connection === connection) onStatus('disconnected', peer.id);
      });
    });
    // 시그널링 서버와의 연결만 끊긴 것이므로, 맺어 둔 핸드폰의 연결은 그대로 두고 새 핸드폰을 받을 수 있게 다시 접속한다.
    peer.on('disconnected', () => peer.reconnect());
    peer.on('error', (error) => {
      console.warn('핸드폰 연결에 실패했습니다.', error);
      onStatus('disconnected', peer.id || undefined);
    });
  }
}

/**
 * 컨트롤러 쪽의 연결. 게임 ID가 있으면 그 게임에 WebRTC로 연결하고, 없으면 같은 PC의 게임 탭에 보낸다.
 * @returns 조종 메시지를 보내는 함수. 연결되기 전에 보낸 메시지는 버린다
 */
export function connectToGame(
  peerId: string | undefined,
  onStatus: (status: LinkStatus, notice?: string) => void,
): (text: string) => void {
  if (peerId === undefined) {
    const channel = new BroadcastChannel(HELM_CHANNEL);
    // 같은 PC의 탭에는 연결을 맺는 과정이 없으므로, 게임 탭이 열려 있는지와 관계없이 연결된 것으로 표시한다.
    onStatus('connected');
    return (text) => channel.postMessage(text);
  }

  let connection: DataConnection | undefined;
  const peer = new Peer(PEER_OPTIONS);
  onStatus('connecting');
  // 다른 네트워크에 있으면 서로의 LAN 주소로 닿지 않아서, 오류 없이 연결 중에 오래 머무른다.
  const timeout = window.setTimeout(() => {
    if (!connection?.open) onStatus('disconnected', SAME_WIFI_NOTICE);
  }, CONNECT_TIMEOUT_MS);
  peer.on('open', () => {
    connection = peer.connect(peerId, CONNECT_OPTIONS);
    connection.on('open', () => {
      window.clearTimeout(timeout);
      onStatus('connected');
    });
    connection.on('close', () => onStatus('disconnected', SAME_WIFI_NOTICE));
  });
  // 페이지를 닫을 때 연결을 직접 닫아야, 게임이 끊긴 것을 기다리지 않고 바로 알 수 있다.
  window.addEventListener('pagehide', () => peer.destroy());
  peer.on('error', (error) => {
    console.warn('게임에 연결하지 못했습니다.', error);
    onStatus('disconnected');
  });
  return (text) => {
    if (connection?.open) void connection.send(text);
  };
}
