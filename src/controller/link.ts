import { Peer, type DataConnection, type PeerConnectOption } from 'peerjs';
import { HELM_CHANNEL } from './protocol';

/** 게임과 컨트롤러가 화면에 표시하는 연결 상태 */
export type LinkStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export const LINK_STATUS_LABELS: Record<LinkStatus, string> = {
  connecting: '연결 중',
  connected: '연결됨',
  reconnecting: '다시 연결 중',
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

/** 끊긴 뒤 다시 연결을 시도하기까지 기다리는 시간(ms). 실패할 때마다 두 배로 늘려서, 게임이 닫힌 채로 두어도 공개 신호 서버에 계속 자주 접속하지 않게 한다. */
const RETRY_MIN_MS = 1500;
const RETRY_MAX_MS = 10_000;

/** 게임 탭이 닫혀서 그 ID를 찾을 수 없을 때의 안내 */
const GAME_GONE_NOTICE = '게임을 찾을 수 없습니다. PC에서 게임이 열려 있는지 확인하고, QR 코드를 다시 찍어 주세요.';

/** 연결이 늦어질 때 컨트롤러가 띄우는 안내 */
export const SAME_WIFI_NOTICE = 'PC와 같은 와이파이에 연결되어 있는지 확인해 주세요.';

/**
 * 게임 쪽의 연결. 같은 PC의 탭과 핸드폰에서 오는 조종 메시지를 같은 콜백으로 넘긴다.
 * 같은 PC의 탭은 처음부터 받고, 핸드폰은 open을 부른 뒤부터 받는다.
 */
export class HelmHost {
  private peer?: Peer;
  private connection?: DataConnection;
  private readonly channel = new BroadcastChannel(HELM_CHANNEL);

  constructor(private readonly onText: (text: string) => void) {
    this.channel.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') onText(event.data);
    });
  }

  /** 연결된 컨트롤러에 메시지를 보낸다. 같은 PC의 탭과 핸드폰 모두에 보내고, 연결된 핸드폰이 없으면 핸드폰에는 보내지 않는다. */
  send(text: string): void {
    this.channel.postMessage(text);
    if (this.connection?.open) void this.connection.send(text);
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
 * @param onText 게임이 보낸 메시지를 받을 때마다 부른다
 * @returns 조종 메시지를 보내는 함수. 연결되기 전에 보낸 메시지는 버린다
 */
export function connectToGame(
  peerId: string | undefined,
  onStatus: (status: LinkStatus, notice?: string) => void,
  onText: (text: string) => void,
): (text: string) => void {
  if (peerId === undefined) {
    const channel = new BroadcastChannel(HELM_CHANNEL);
    channel.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') onText(event.data);
    });
    // 같은 PC의 탭에는 연결을 맺는 과정이 없으므로, 게임 탭이 열려 있는지와 관계없이 연결된 것으로 표시한다.
    onStatus('connected');
    return (text) => channel.postMessage(text);
  }

  let peer: Peer | undefined;
  let connection: DataConnection | undefined;
  let retry: number | undefined;
  let retryDelay = RETRY_MIN_MS;
  let connectedOnce = false;
  let closing = false;
  const startedAt = performance.now();

  // 한 번도 연결되지 않은 채 오래 걸리면, 다른 네트워크에 있어서 서로의 LAN 주소로 닿지 않는 경우가 많다.
  const firstNotice = () =>
    !connectedOnce && performance.now() - startedAt > CONNECT_TIMEOUT_MS ? SAME_WIFI_NOTICE : undefined;

  /**
   * 연결이 끊겼거나 맺지 못했을 때 부른다. 잠시 기다렸다가 처음부터 다시 연결한다.
   * 끊긴 연결을 되살리기보다 새로 맺는 편이, 핸드폰이 잠들었다 깨어난 경우까지 한 가지 방법으로 다룰 수 있다.
   */
  const lost = (notice?: string) => {
    if (closing || retry !== undefined) return;
    onStatus(connectedOnce ? 'reconnecting' : 'connecting', notice ?? firstNotice());
    retry = window.setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  };

  const connect = () => {
    window.clearTimeout(retry);
    retry = undefined;
    peer?.destroy();
    const current = (peer = new Peer(PEER_OPTIONS));
    current.on('open', () => {
      const conn = (connection = current.connect(peerId, CONNECT_OPTIONS));
      conn.on('data', (data) => {
        if (typeof data === 'string') onText(data);
      });
      conn.on('open', () => {
        connectedOnce = true;
        retryDelay = RETRY_MIN_MS;
        onStatus('connected');
        // PeerJS는 ICE가 failed가 되어야 close를 알리므로, disconnected가 되는 몇 초 안에 끊긴 것으로 보고 다시 연결한다.
        conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
          const state = conn.peerConnection.iceConnectionState;
          if (conn === connection && (state === 'disconnected' || state === 'failed')) lost();
        });
      });
      conn.on('close', () => {
        if (conn === connection) lost();
      });
    });
    current.on('error', (error) => {
      if (current !== peer) return;
      console.warn('게임에 연결하지 못했습니다.', error);
      lost(error.type === 'peer-unavailable' ? GAME_GONE_NOTICE : undefined);
    });
  };

  onStatus('connecting');
  connect();
  // 연결 중에 오래 머무르면 같은 와이파이인지 확인하라고 안내한다. 연결을 맺지 못해도 오류가 나지 않는 경우가 있다.
  window.setTimeout(() => {
    if (!connectedOnce) onStatus('connecting', SAME_WIFI_NOTICE);
  }, CONNECT_TIMEOUT_MS);
  // 다른 앱으로 바꾸면 iOS가 페이지를 멈추면서 연결이 끊긴다. 돌아오면 기다리지 않고 바로 다시 연결한다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !connection?.open) connect();
  });
  // 페이지를 닫을 때 연결을 직접 닫아야, 게임이 끊긴 것을 기다리지 않고 바로 알 수 있다.
  window.addEventListener('pagehide', () => {
    closing = true;
    peer?.destroy();
  });
  return (text) => {
    if (connection?.open) void connection.send(text);
  };
}
