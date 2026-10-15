/**
 * 핸드폰이 버튼으로 내리는 명령. PC에서 같은 버튼을 누른 것과 같다.
 * - startSailing: 시작 화면의 "항해 시작"
 * - startRace: 타임어택 코스를 골라서 시작한다
 * - quitRace: 타임어택을 그만두고 자유 항해로 돌아간다
 * - retryRace: 타임어택 결과 화면의 "다시 도전"
 * - moveToStart: 시작 위치로 배를 옮긴다
 * - setSeaLevel: 파도 세기를 1~5 중 하나로 바꾼다
 * - setSound: 소리를 켜거나 끈다
 */
export type ControllerCommand =
  | { kind: 'startSailing' }
  | { kind: 'startRace'; courseId: string }
  | { kind: 'quitRace' }
  | { kind: 'retryRace' }
  | { kind: 'moveToStart'; startId: string }
  | { kind: 'setSeaLevel'; level: number }
  | { kind: 'setSound'; on: boolean };

/**
 * 게임의 큰 흐름에서 지금 어디에 있는지.
 * - loading: 시작 화면이 떠 있고 자료를 아직 불러오는 중
 * - start: 시작 화면이 떠 있고 시작할 수 있음
 * - sailing: 자유 항해
 * - countdown: 타임어택 출발 전의 카운트다운
 * - racing: 타임어택 진행 중
 * - finished: 타임어택을 마치고 결과를 보여 주는 중
 */
export type GameScene = 'loading' | 'start' | 'sailing' | 'countdown' | 'racing' | 'finished';

/** 핸드폰의 메뉴에 보여 줄 항목 (타임어택 코스, 시작 위치) */
export interface MenuItem {
  /** 명령에 담아 보내는 값. 코스는 코스의 ID, 시작 위치는 목록의 순번이다. */
  id: string;
  name: string;
  /** 어떤 곳인지 알려 주는 짧은 설명 */
  note: string;
}

/** 타임어택을 하는 동안의 정보 */
export interface RaceSummary {
  courseName: string;
  /** countdown일 때 출발까지 남은 초 */
  countdown?: number;
  /** racing일 때 출발한 뒤로 지난 초 */
  elapsed?: number;
  /** finished일 때의 기록 (초) */
  time?: number;
}

/** 게임이 핸드폰에 알려 주는 지금의 상황 */
export interface GameSituation {
  scene: GameScene;
  /** 배가 전복되었으면 true */
  capsized: boolean;
  /** scene이 countdown, racing, finished일 때만 있다 */
  race?: RaceSummary;
  courses: MenuItem[];
  starts: MenuItem[];
  /** 지금의 파도 세기 (1~5의 정수) */
  seaLevel: number;
  /** true이면 지금은 파도 세기를 바꿀 수 없다 (타임어택 중) */
  seaLevelLocked: boolean;
  soundOn: boolean;
}

/** 조종 값, 배의 상태와 같은 통로로 오가므로, 종류를 구별하는 표지를 붙인다. */
const COMMAND_TYPE = 'command';
const SITUATION_TYPE = 'situation';
const SCENES: readonly GameScene[] = ['loading', 'start', 'sailing', 'countdown', 'racing', 'finished'];

/** 명령을 전송할 문자열로 바꾼다. 값을 검사하지 않고 그대로 적는다. 검사는 받는 쪽의 decodeCommand가 한다. */
export function encodeCommand(command: ControllerCommand): string {
  return JSON.stringify({ type: COMMAND_TYPE, ...command });
}

/**
 * 받은 문자열을 명령으로 읽는다.
 * 형식이 맞지 않으면 undefined를 돌려준다: 명령 메시지가 아니거나, 모르는 kind이거나, 필요한 값이 없거나 형식이 틀린 경우이다.
 * courseId와 startId는 비어 있지 않은 문자열, level은 1~5의 정수, on은 참거짓이어야 한다.
 * 조종 메시지, 배의 상태 메시지, 상황 메시지를 넣어도 undefined이다.
 */
export function decodeCommand(text: string): ControllerCommand | undefined {
  const data = parseObject(text);
  if (data?.type !== COMMAND_TYPE) return undefined;
  switch (data.kind) {
    case 'startSailing':
    case 'quitRace':
    case 'retryRace':
      return { kind: data.kind };
    case 'startRace':
      return isId(data.courseId) ? { kind: 'startRace', courseId: data.courseId } : undefined;
    case 'moveToStart':
      return isId(data.startId) ? { kind: 'moveToStart', startId: data.startId } : undefined;
    case 'setSeaLevel':
      return isSeaLevel(data.level) ? { kind: 'setSeaLevel', level: data.level } : undefined;
    case 'setSound':
      return typeof data.on === 'boolean' ? { kind: 'setSound', on: data.on } : undefined;
    default:
      return undefined;
  }
}

/** 상황을 전송할 문자열로 바꾼다. 값을 검사하지 않고 그대로 적는다. */
export function encodeSituation(situation: GameSituation): string {
  return JSON.stringify({ type: SITUATION_TYPE, ...situation });
}

/**
 * 받은 문자열을 상황으로 읽는다.
 * 형식이 맞지 않으면 undefined를 돌려준다: 상황 메시지가 아니거나, scene이 GameScene이 아니거나,
 * 참거짓 값이 참거짓이 아니거나, seaLevel이 1~5의 정수가 아니거나, 목록의 항목에 문자열 id, name, note가 없거나,
 * race의 숫자가 유한한 수가 아닌 경우이다.
 * 조종 메시지, 배의 상태 메시지, 명령 메시지를 넣어도 undefined이다.
 */
export function decodeSituation(text: string): GameSituation | undefined {
  const data = parseObject(text);
  if (data?.type !== SITUATION_TYPE) return undefined;
  const { scene, capsized, race, courses, starts, seaLevel, seaLevelLocked, soundOn } = data;
  if (!SCENES.includes(scene as GameScene)) return undefined;
  if (typeof capsized !== 'boolean' || typeof seaLevelLocked !== 'boolean' || typeof soundOn !== 'boolean')
    return undefined;
  if (!isSeaLevel(seaLevel) || !isMenu(courses) || !isMenu(starts)) return undefined;
  const situation: GameSituation = {
    scene: scene as GameScene,
    capsized,
    courses: courses.map(({ id, name, note }) => ({ id, name, note })),
    starts: starts.map(({ id, name, note }) => ({ id, name, note })),
    seaLevel,
    seaLevelLocked,
    soundOn,
  };
  if (race !== undefined) {
    const summary = readRace(race);
    if (!summary) return undefined;
    situation.race = summary;
  }
  return situation;
}

/**
 * 지금 상황에서 이 명령을 실행할 수 있는지 판단한다. PC에서 같은 버튼을 누를 수 있는지와 같다.
 * - 자료를 불러오는 중(loading)에는 어떤 명령도 실행하지 않는다.
 * - startSailing: 시작 화면(start)에서만
 * - startRace: 시작 화면을 닫은 뒤의 모든 상황과 시작 화면(start)에서. courseId가 courses에 있어야 한다
 * - quitRace: countdown, racing, finished에서만
 * - retryRace: finished에서만
 * - moveToStart: 시작 화면을 닫은 뒤에만 (sailing, countdown, racing, finished). startId가 starts에 있어야 한다
 * - setSeaLevel: seaLevelLocked가 아닐 때만. 시작 화면에서도 된다
 * - setSound: 언제나 (loading 제외)
 */
export function canRunCommand(command: ControllerCommand, situation: GameSituation): boolean {
  const { scene } = situation;
  // 자료를 불러오는 동안에는 시작 화면의 버튼도 아직 보이지 않으므로, 핸드폰에서도 아무것도 하지 않는다.
  if (scene === 'loading') return false;
  const sailing = scene !== 'start';
  const inRace = scene === 'countdown' || scene === 'racing' || scene === 'finished';
  switch (command.kind) {
    case 'startSailing':
      return scene === 'start';
    case 'startRace':
      return situation.courses.some((course) => course.id === command.courseId);
    case 'quitRace':
      return inRace;
    case 'retryRace':
      return scene === 'finished';
    case 'moveToStart':
      // PC에서는 시작 화면에 가려서 메뉴의 시작 위치를 누를 수 없다.
      return sailing && situation.starts.some((start) => start.id === command.startId);
    case 'setSeaLevel':
      return !situation.seaLevelLocked;
    case 'setSound':
      return true;
  }
}

/** 메시지는 네트워크 너머에서 오므로, 깨진 문자열 때문에 게임의 프레임이 예외로 멈추면 안 된다. */
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSeaLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function isMenu(value: unknown): value is MenuItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        ['id', 'name', 'note'].every((key) => typeof (item as Record<string, unknown>)[key] === 'string'),
    )
  );
}

function readRace(value: unknown): RaceSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { courseName, countdown, elapsed, time } = value as Record<string, unknown>;
  if (typeof courseName !== 'string') return undefined;
  const summary: RaceSummary = { courseName };
  for (const [key, number] of [
    ['countdown', countdown],
    ['elapsed', elapsed],
    ['time', time],
  ] as const) {
    if (number === undefined) continue;
    if (typeof number !== 'number' || !Number.isFinite(number)) return undefined;
    summary[key] = number;
  }
  return summary;
}
