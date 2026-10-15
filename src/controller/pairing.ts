/** 컨트롤러 페이지의 주소에서 게임 ID를 담는 쿼리 이름 */
const GAME_PARAM = 'game';

/**
 * 게임에 연결할 컨트롤러 페이지의 주소를 만든다. QR 코드에 담는 주소이다.
 * @param gameUrl 지금 열려 있는 게임 페이지의 주소 (location.href)
 * @param peerId 게임이 시그널링 서버에서 받은 ID
 * @returns 게임과 같은 사이트에 있는 컨트롤러 페이지의 주소. peerIdFromUrl로 peerId를 다시 읽을 수 있다
 */
export function controllerUrl(gameUrl: string, peerId: string): string {
  // 상대 경로로 풀면 게임의 쿼리와 해시는 버려지고, 게임이 하위 경로에 배포되어도 같은 폴더의 컨트롤러를 가리킨다.
  const url = new URL('controller.html', gameUrl);
  url.searchParams.set(GAME_PARAM, peerId);
  return url.href;
}

/**
 * 컨트롤러 페이지의 주소에서 연결할 게임의 ID를 읽는다.
 * ID가 없거나 비어 있으면 undefined를 돌려준다. 이때 컨트롤러는 같은 PC의 게임 탭과 연결한다.
 */
export function peerIdFromUrl(url: string): string | undefined {
  return new URL(url).searchParams.get(GAME_PARAM) || undefined;
}
