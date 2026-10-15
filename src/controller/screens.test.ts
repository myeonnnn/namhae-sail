import { describe, expect, it } from 'vitest';
import type { GameScene, GameSituation } from './commands';
import type { HelmMessage } from './protocol';
import { controllerScreen, helmForScreen, type ControllerScreen } from './screens';

const ALL_SCENES: GameScene[] = ['loading', 'start', 'sailing', 'countdown', 'racing', 'finished'];
const ALL_SCREENS: ControllerScreen[] = ['waiting', 'loading', 'start', 'drive', 'menu', 'result'];
/** 명세가 "조종 화면이 아닐 때"로 든 화면: 연결을 기다리는 중, 불러오는 중, 시작, 결과, 메뉴 */
const NON_DRIVE_SCREENS: ControllerScreen[] = ['waiting', 'loading', 'start', 'result', 'menu'];

/** 화면은 장면만으로 정해지므로, 나머지 값은 장면에 어울리는 평범한 값으로 둔다. */
function situation(scene: GameScene): GameSituation {
  const race =
    scene === 'countdown'
      ? { courseName: '한산도 한 바퀴', countdown: 3 }
      : scene === 'racing'
        ? { courseName: '한산도 한 바퀴', elapsed: 42.5 }
        : scene === 'finished'
          ? { courseName: '한산도 한 바퀴', time: 318.25 }
          : undefined;
  return {
    scene,
    capsized: false,
    ...(race ? { race } : {}),
    courses: [{ id: 'hansan', name: '한산도 한 바퀴', note: '통영항에서 한산도를 돌아오는 코스' }],
    starts: [{ id: '0', name: '통영항', note: '항구 앞의 잔잔한 바다' }],
    seaLevel: 2,
    seaLevelLocked: scene === 'countdown' || scene === 'racing',
    soundOn: true,
  };
}

/**
 * 명세 "핸드폰의 상황별 화면"의 표.
 * 메뉴는 조종 화면에서 메뉴 버튼으로 여는 것이므로, 조종 화면이 아닌 장면에서는 menuOpen이어도 그 장면의 화면이다.
 */
const EXPECTED: Record<GameScene, { closed: ControllerScreen; open: ControllerScreen }> = {
  loading: { closed: 'loading', open: 'loading' },
  start: { closed: 'start', open: 'start' },
  sailing: { closed: 'drive', open: 'menu' },
  countdown: { closed: 'drive', open: 'menu' },
  racing: { closed: 'drive', open: 'menu' },
  finished: { closed: 'result', open: 'result' },
};

describe('controllerScreen: 게임이 알려 준 상황에 맞는 화면', () => {
  it('게임의 상황을 아직 받지 못했으면 메뉴를 열었든 아니든 연결을 기다리는 화면이다', () => {
    expect(controllerScreen(undefined, false)).toBe('waiting');
    expect(controllerScreen(undefined, true)).toBe('waiting');
  });

  for (const scene of ALL_SCENES) {
    it(`${scene} 장면에서 메뉴를 닫아 두면 ${EXPECTED[scene].closed} 화면이다`, () => {
      expect(controllerScreen(situation(scene), false)).toBe(EXPECTED[scene].closed);
    });
    it(`${scene} 장면에서 메뉴를 열어 두면 ${EXPECTED[scene].open} 화면이다`, () => {
      expect(controllerScreen(situation(scene), true)).toBe(EXPECTED[scene].open);
    });
  }

  it('조종 장면에서 메뉴를 닫으면 같은 상황에서 조종 화면으로 돌아간다', () => {
    for (const scene of ['sailing', 'countdown', 'racing'] as const) {
      const now = situation(scene);
      expect(controllerScreen(now, true)).toBe('menu');
      expect(controllerScreen(now, false)).toBe('drive');
    }
  });

  it('전복된 상태여도 조종 장면이면 조종 화면이다 (복구 버튼을 눌러야 하므로)', () => {
    // 명세는 화면을 장면으로만 정한다. 전복은 화면을 바꾸는 조건으로 적혀 있지 않다.
    expect(controllerScreen({ ...situation('sailing'), capsized: true }, false)).toBe('drive');
    expect(controllerScreen({ ...situation('racing'), capsized: true }, false)).toBe('drive');
  });
});

/** 기울기와 버튼을 모두 쓰고 있는 조종 값. 0이 아닌 값이어야 조종 화면이 아닐 때 바뀌는지 알 수 있다. */
const ACTIVE_HELM: HelmMessage = { throttleRate: 1, rudder: -0.7, neutralCount: 3, resetCount: 5 };

/** 조종 값의 경계: 레버를 끝까지 내리고 타를 우현 끝까지, 누른 횟수 0 */
const EDGE_HELMS: HelmMessage[] = [
  ACTIVE_HELM,
  { throttleRate: -1, rudder: 1, neutralCount: 0, resetCount: 0 },
  { throttleRate: 0.25, rudder: 0.4, neutralCount: 12, resetCount: 0 },
  { throttleRate: 0, rudder: 0, neutralCount: 0, resetCount: 7 },
];

describe('helmForScreen: 화면에 따라 보내는 조종 값', () => {
  it('조종 화면에서는 기울기와 스로틀 버튼의 값을 그대로 보낸다', () => {
    for (const helm of EDGE_HELMS) {
      expect(helmForScreen('drive', helm)).toEqual(helm);
    }
  });

  for (const screen of NON_DRIVE_SCREENS) {
    it(`${screen} 화면에서는 스로틀 레버를 밀지 않고(0) 타를 가운데(0)로 둔 값을 보낸다`, () => {
      for (const helm of EDGE_HELMS) {
        const sent = helmForScreen(screen, helm);
        // 부호 있는 0(-0)도 "레버를 밀지 않음", "가운데"이므로 크기로 확인한다.
        expect(Math.abs(sent.throttleRate)).toBe(0);
        expect(Math.abs(sent.rudder)).toBe(0);
      }
    });
  }

  it('어느 화면에서도 중립과 복구 버튼을 누른 횟수는 그대로 보낸다', () => {
    // 횟수가 바뀌면 게임이 새로 누른 것으로 보거나(늘어남) 컨트롤러를 새로 연 것으로 본다(줄어듦).
    for (const screen of ALL_SCREENS) {
      for (const helm of EDGE_HELMS) {
        const sent = helmForScreen(screen, helm);
        expect(sent.neutralCount).toBe(helm.neutralCount);
        expect(sent.resetCount).toBe(helm.resetCount);
      }
    }
  });

  it('조종 화면이 아니어도 보낼 조종 값을 돌려준다 (메시지가 끊긴 것으로 보이지 않게)', () => {
    for (const screen of NON_DRIVE_SCREENS) {
      const sent = helmForScreen(screen, ACTIVE_HELM);
      expect(sent).toBeDefined();
      expect(Number.isFinite(sent.throttleRate)).toBe(true);
      expect(Number.isFinite(sent.rudder)).toBe(true);
    }
  });

  it('메뉴나 다른 화면에서 조종 화면으로 돌아오면 그때의 기울기와 버튼으로 다시 조종한다', () => {
    for (const screen of NON_DRIVE_SCREENS) {
      const helm: HelmMessage = { ...ACTIVE_HELM };
      helmForScreen(screen, helm);
      // 조종 화면이 아닐 때 넘긴 값을 고쳐 두면, 돌아왔을 때 같은 값으로 불러도 조종이 0으로 남는다.
      expect(helm).toEqual(ACTIVE_HELM);
      expect(helmForScreen('drive', helm)).toEqual(ACTIVE_HELM);
    }
  });

  it('상황이 바뀌는 흐름 내내 화면에 맞는 조종 값이 나온다', () => {
    // 연결 대기 -> 불러오는 중 -> 시작 -> 자유 항해 -> 메뉴 열기 -> 메뉴 닫기
    const steps: { situation: GameSituation | undefined; menuOpen: boolean; drives: boolean }[] = [
      { situation: undefined, menuOpen: false, drives: false },
      { situation: situation('loading'), menuOpen: false, drives: false },
      { situation: situation('start'), menuOpen: false, drives: false },
      { situation: situation('sailing'), menuOpen: false, drives: true },
      { situation: situation('sailing'), menuOpen: true, drives: false },
      { situation: situation('sailing'), menuOpen: false, drives: true },
      { situation: situation('finished'), menuOpen: false, drives: false },
    ];
    for (const step of steps) {
      const sent = helmForScreen(controllerScreen(step.situation, step.menuOpen), ACTIVE_HELM);
      if (step.drives) {
        expect(sent).toEqual(ACTIVE_HELM);
      } else {
        expect(Math.abs(sent.throttleRate)).toBe(0);
        expect(Math.abs(sent.rudder)).toBe(0);
        expect(sent.neutralCount).toBe(ACTIVE_HELM.neutralCount);
        expect(sent.resetCount).toBe(ACTIVE_HELM.resetCount);
      }
    }
  });
});
