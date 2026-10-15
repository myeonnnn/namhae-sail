import type { GameSituation } from './commands';
import type { HelmMessage } from './protocol';

/**
 * 핸드폰이 보여 주는 화면.
 * - waiting: 게임의 상황을 아직 받지 못함
 * - loading: PC에서 게임을 불러오는 중
 * - start: 게임의 시작 화면에 맞춘 화면 (항해 시작, 타임어택)
 * - drive: 조종 화면
 * - menu: 조종 화면에서 연 메뉴
 * - result: 타임어택 결과
 */
export type ControllerScreen = 'waiting' | 'loading' | 'start' | 'drive' | 'menu' | 'result';

/**
 * 게임이 알려 준 상황과, 사용자가 메뉴를 열었는지로 핸드폰의 화면을 정한다.
 * - 상황을 받지 못했으면 waiting
 * - loading이면 loading, start이면 start, finished이면 result
 * - sailing, countdown, racing이면 drive. 이때 메뉴를 열었으면 menu
 * - 메뉴는 조종 화면 위에서만 열린다. loading, start, finished에서는 menuOpen이어도 그 상황의 화면을 보여 준다
 * @param situation 게임이 마지막으로 알려 준 상황. 아직 받지 못했으면 undefined
 * @param menuOpen 사용자가 메뉴를 열어 둔 상태이면 true
 */
export function controllerScreen(situation: GameSituation | undefined, menuOpen: boolean): ControllerScreen {
  switch (situation?.scene) {
    case undefined:
      return 'waiting';
    case 'loading':
      return 'loading';
    case 'start':
      return 'start';
    case 'finished':
      return 'result';
    default:
      // 메뉴는 조종 화면 위에 여는 것이므로, 시작이나 결과처럼 따로 할 일이 있는 화면에서는 열지 않는다.
      return menuOpen ? 'menu' : 'drive';
  }
}

/**
 * 지금 화면에서 게임에 보낼 조종 값을 정한다.
 * - drive이면 helm을 그대로 돌려준다
 * - 그 밖의 화면에서는 throttleRate를 0(레버를 밀지 않음), rudder를 0(가운데)으로 바꾼다. 누른 횟수는 그대로 둔다
 * 조종 화면이 아니어도 이 값을 계속 보내서, 게임이 연결이 끊긴 것으로 보고 스로틀을 중립으로 돌리지 않게 한다.
 */
export function helmForScreen(screen: ControllerScreen, helm: HelmMessage): HelmMessage {
  if (screen === 'drive') return helm;
  // 메뉴를 고르느라 핸드폰을 기울여도 배가 돌지 않게 하고, 레버는 그 자리에 둔다.
  return { ...helm, throttleRate: 0, rudder: 0 };
}
