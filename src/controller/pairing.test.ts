import { describe, expect, it } from 'vitest';
import { controllerUrl, peerIdFromUrl } from './pairing';

// 게임이 열려 있을 수 있는 주소. 배포 사이트, 개발 서버, 같은 와이파이의 핸드폰이 접속하는 주소,
// 그리고 쿼리나 해시가 붙은 주소를 모두 포함한다.
const GAME_URLS = [
  'https://namhae-sail.vercel.app/',
  'http://localhost:5190/',
  'http://192.168.0.12:5190/',
  'https://namhae-sail.vercel.app/?debug=1',
  'http://localhost:5190/#route',
  'http://192.168.0.12:5190/?a=1&b=2#x',
];

// 시그널링 서버가 정하는 ID는 영문과 숫자만이라고 보장할 수 없으므로,
// 주소에서 특별한 뜻을 가지는 문자(&, =, #, ?, /, +, %, 공백)와 한글이 섞인 ID도 확인한다.
const PEER_IDS = ['abc123', '3f2a9c1e-7b4d-4e8a-9f00-1c2d3e4f5a6b', 'a b&c=d#e?f/g+h%20i', '한려수도-요트', '%', '+'];

describe('컨트롤러 페이지 주소의 게임 ID', () => {
  it('게임이 만든 주소에서 같은 게임 ID를 다시 읽어 낸다', () => {
    for (const gameUrl of GAME_URLS) {
      for (const peerId of PEER_IDS) {
        expect(peerIdFromUrl(controllerUrl(gameUrl, peerId))).toBe(peerId);
      }
    }
  });

  it('게임 주소에 붙은 쿼리나 해시가 읽어 낸 게임 ID를 바꾸지 않는다', () => {
    const peerId = 'game-42';
    for (const suffix of ['', '?peer=other', '#other', '?id=x&peer=y#peer=z']) {
      expect(peerIdFromUrl(controllerUrl(`https://namhae-sail.vercel.app/${suffix}`, peerId))).toBe(peerId);
    }
  });

  it('게임이 만든 주소는 게임과 같은 사이트의 컨트롤러 페이지를 가리킨다', () => {
    for (const gameUrl of GAME_URLS) {
      const result = new URL(controllerUrl(gameUrl, 'abc123'));
      // QR 코드로 핸드폰이 열 수 있어야 하므로 절대 주소이고, 출처(프로토콜, 호스트, 포트)가 게임과 같다.
      expect(result.origin).toBe(new URL(gameUrl).origin);
      expect(result.pathname.endsWith('/controller.html')).toBe(true);
    }
  });
});

describe('게임 ID가 없는 컨트롤러 주소', () => {
  it('주소에 게임 ID가 없으면 ID를 읽지 않는다(같은 PC의 게임 탭과 연결한다)', () => {
    for (const url of [
      'https://namhae-sail.vercel.app/controller.html',
      'http://localhost:5190/controller.html',
      'http://192.168.0.12:5190/controller.html',
    ]) {
      expect(peerIdFromUrl(url)).toBeUndefined();
    }
  });

  it('게임 ID가 비어 있으면 ID를 읽지 않는다(같은 PC의 게임 탭과 연결한다)', () => {
    for (const gameUrl of GAME_URLS) {
      expect(peerIdFromUrl(controllerUrl(gameUrl, ''))).toBeUndefined();
    }
  });
});
