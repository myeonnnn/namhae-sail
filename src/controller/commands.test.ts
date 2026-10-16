import { describe, expect, it } from 'vitest';
import {
  canRunCommand,
  decodeCommand,
  decodeSituation,
  encodeCommand,
  encodeSituation,
  type ControllerCommand,
  type GameScene,
  type GameSituation,
  type MenuItem,
} from './commands';
import { decodeHelm, decodeShipStatus, encodeHelm, encodeShipStatus } from './protocol';

/** 형식과 무관하게 어느 메시지로도 읽힐 수 없는 문자열 */
const MALFORMED = ['', ' ', 'hello', '{', 'null', '42', '[]', '{}', 'true', '"startSailing"', 'kind scene'];

const COURSES: MenuItem[] = [
  { id: 'hansan', name: '한산도 한 바퀴', note: '통영항에서 한산도를 돌아오는 코스' },
  { id: 'geoje', name: '거제 건너기', note: '견내량을 지나 거제로 가는 코스' },
];

/** 시작 위치의 id는 목록의 순번이다. 코스의 id와 겹치지 않는다. */
const STARTS: MenuItem[] = [
  { id: '0', name: '통영항', note: '항구 앞의 잔잔한 바다' },
  { id: '1', name: '한산도 앞', note: '섬 사이의 좁은 물길' },
  { id: '2', name: '거제 앞바다', note: '바람이 센 열린 바다' },
];

/** 정상인 명령마다 하나씩. 코스와 시작 위치는 위 목록에 있는 것을 가리킨다. */
const VALID_COMMANDS: ControllerCommand[] = [
  { kind: 'startSailing' },
  { kind: 'startRace', courseId: 'hansan' },
  { kind: 'startRace', courseId: 'geoje' },
  { kind: 'quitRace' },
  { kind: 'retryRace' },
  { kind: 'moveToStart', startId: '0' },
  { kind: 'moveToStart', startId: '2' },
  { kind: 'setSeaLevel', level: 1 },
  { kind: 'setSeaLevel', level: 3 },
  { kind: 'setSeaLevel', level: 5 },
  { kind: 'setSound', on: true },
  { kind: 'setSound', on: false },
];

const ALL_SCENES: GameScene[] = ['loading', 'start', 'sailing', 'countdown', 'racing', 'finished'];

/**
 * 장면마다 실제 게임에서 나올 법한 상황을 만든다.
 * 타임어택 중(countdown, racing)에는 파도 세기를 바꿀 수 없으므로 seaLevelLocked를 켠다 (명세: "타임어택 중에는 파도 세기를 바꿀 수 없다").
 * finished는 잠금 여부가 명세에 정해져 있지 않으므로 기본값은 잠그지 않고, 잠금은 따로 확인한다.
 */
function situation(scene: GameScene, overrides: Partial<GameSituation> = {}): GameSituation {
  const race =
    scene === 'countdown'
      ? { courseName: '한산도 한 바퀴', countdown: 3 }
      : scene === 'racing'
        ? { courseName: '한산도 한 바퀴', elapsed: 42.5 }
        : scene === 'finished'
          ? { courseName: '거제 건너기', time: 318.25 }
          : undefined;
  return {
    scene,
    capsized: false,
    ...(race ? { race } : {}),
    courses: COURSES,
    starts: STARTS,
    seaLevel: 3,
    seaLevelLocked: scene === 'countdown' || scene === 'racing',
    soundOn: true,
    ...overrides,
  };
}

/** 형식이 틀린 명령을 encode 함수로 만든다. 전송 형식을 테스트에서 가정하지 않기 위해서이다. */
function badCommand(value: unknown): string {
  return encodeCommand(value as ControllerCommand);
}

/** 형식이 틀린 상황을 encode 함수로 만든다. */
function badSituation(overrides: Record<string, unknown>, scene: GameScene = 'sailing'): string {
  return encodeSituation({ ...situation(scene), ...overrides } as unknown as GameSituation);
}

describe('핸드폰이 보내는 명령', () => {
  it('일곱 가지 명령을 보낸 그대로 읽는다', () => {
    for (const command of VALID_COMMANDS) {
      expect(decodeCommand(encodeCommand(command)), JSON.stringify(command)).toEqual(command);
    }
  });

  it('파도 세기는 1~5의 정수만 받아들이고, 경계값 1과 5도 받아들인다', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      expect(decodeCommand(encodeCommand({ kind: 'setSeaLevel', level }))).toEqual({ kind: 'setSeaLevel', level });
    }
    for (const level of [0, 6, -1, 2.5, 4.999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decodeCommand(badCommand({ kind: 'setSeaLevel', level })), `level ${level}`).toBeUndefined();
    }
    expect(decodeCommand(badCommand({ kind: 'setSeaLevel', level: '3' }))).toBeUndefined();
    expect(decodeCommand(badCommand({ kind: 'setSeaLevel' }))).toBeUndefined();
  });

  it('모르는 종류의 명령은 무시한다', () => {
    for (const kind of ['jump', 'StartSailing', '', 'helm', 'status']) {
      expect(decodeCommand(badCommand({ kind })), `kind ${kind}`).toBeUndefined();
    }
    expect(decodeCommand(badCommand({}))).toBeUndefined();
    expect(decodeCommand(badCommand({ kind: 3 }))).toBeUndefined();
  });

  it('코스를 고르지 않았거나 코스 id가 비어 있으면 타임어택 시작 명령을 무시한다', () => {
    for (const courseId of ['', undefined, null, 3, true]) {
      expect(decodeCommand(badCommand({ kind: 'startRace', courseId })), `courseId ${courseId}`).toBeUndefined();
    }
  });

  it('위치를 고르지 않았거나 위치 id가 비어 있으면 시작 위치로 옮기기 명령을 무시한다', () => {
    for (const startId of ['', undefined, null, 0, false]) {
      expect(decodeCommand(badCommand({ kind: 'moveToStart', startId })), `startId ${startId}`).toBeUndefined();
    }
  });

  it('소리 켜기와 끄기는 참거짓이 아니면 무시한다', () => {
    for (const on of ['true', 1, 0, null, undefined]) {
      expect(decodeCommand(badCommand({ kind: 'setSound', on })), `on ${on}`).toBeUndefined();
    }
  });

  it('형식이 맞지 않는 문자열은 예외 없이 무시한다', () => {
    for (const text of MALFORMED) {
      expect(() => decodeCommand(text), JSON.stringify(text)).not.toThrow();
      expect(decodeCommand(text), JSON.stringify(text)).toBeUndefined();
    }
  });

  it('같은 통로로 오는 조종, 배의 상태, 상황 메시지는 명령으로 읽지 않는다', () => {
    expect(
      decodeCommand(
        encodeHelm({
          throttleRate: 1,
          rudder: -0.5,
          neutralCount: 2,
          resetCount: 1,
          viewResetCount: 1,
          viewX: 30,
          viewY: -12,
          session: 's1',
        }),
      ),
    ).toBeUndefined();
    expect(decodeCommand(encodeShipStatus({ throttle: 0.5, capsized: true }))).toBeUndefined();
    for (const scene of ALL_SCENES) {
      expect(decodeCommand(encodeSituation(situation(scene))), scene).toBeUndefined();
    }
  });

  it('명령 메시지는 조종 메시지나 배의 상태 메시지로 읽지 않는다', () => {
    for (const command of VALID_COMMANDS) {
      const text = encodeCommand(command);
      expect(decodeHelm(text), JSON.stringify(command)).toBeUndefined();
      expect(decodeShipStatus(text), JSON.stringify(command)).toBeUndefined();
    }
  });
});

describe('게임이 알려 주는 상황', () => {
  it('모든 장면의 상황을 보낸 그대로 읽는다', () => {
    for (const scene of ALL_SCENES) {
      const message = situation(scene);
      expect(decodeSituation(encodeSituation(message)), scene).toEqual(message);
    }
  });

  it('카운트다운의 남은 초, 진행 중의 지난 시간, 결과의 기록을 코스 이름과 함께 읽는다', () => {
    const countdown = situation('countdown', { race: { courseName: '거제 건너기', countdown: 0 } });
    const racing = situation('racing', { race: { courseName: '거제 건너기', elapsed: 0.016 } });
    const finished = situation('finished', { race: { courseName: '한산도 한 바퀴', time: 1234.5 } });
    expect(decodeSituation(encodeSituation(countdown))?.race).toEqual({ courseName: '거제 건너기', countdown: 0 });
    expect(decodeSituation(encodeSituation(racing))?.race).toEqual({ courseName: '거제 건너기', elapsed: 0.016 });
    expect(decodeSituation(encodeSituation(finished))?.race).toEqual({ courseName: '한산도 한 바퀴', time: 1234.5 });
  });

  it('전복 여부, 파도 세기, 소리, 파도 세기 잠금을 그대로 읽는다', () => {
    for (const overrides of [
      { capsized: true, seaLevel: 1, soundOn: false, seaLevelLocked: false },
      { capsized: false, seaLevel: 5, soundOn: true, seaLevelLocked: true },
      { capsized: true, seaLevel: 4, soundOn: true, seaLevelLocked: true },
    ]) {
      const message = situation('sailing', overrides);
      expect(decodeSituation(encodeSituation(message)), JSON.stringify(overrides)).toEqual(message);
    }
  });

  it('코스와 시작 위치 목록의 이름과 설명을 순서대로 읽고, 빈 목록도 받아들인다', () => {
    const full = decodeSituation(encodeSituation(situation('start')));
    expect(full?.courses).toEqual(COURSES);
    expect(full?.starts).toEqual(STARTS);
    const empty = situation('loading', { courses: [], starts: [] });
    expect(decodeSituation(encodeSituation(empty))).toEqual(empty);
  });

  it('코스 목록의 난이도를 코스마다 그대로 읽는다', () => {
    const courses: MenuItem[] = [
      { ...COURSES[0], difficulty: 'easy' },
      { ...COURSES[1], difficulty: 'normal' },
      { id: 'gyeonnae', name: '견내량 빠져나가기', note: '좁은 해협을 지나는 코스', difficulty: 'hard' },
    ];
    const message = situation('start', { courses });
    const decoded = decodeSituation(encodeSituation(message));
    expect(decoded?.courses).toEqual(courses);
    expect(decoded).toEqual(message);
  });

  it('난이도가 없는 시작 위치의 항목은 난이도 없이 그대로 읽는다', () => {
    const message = situation('sailing', { courses: [{ ...COURSES[0], difficulty: 'hard' }] });
    const decoded = decodeSituation(encodeSituation(message));
    expect(decoded?.starts).toEqual(STARTS);
    for (const start of decoded?.starts ?? []) expect(start, start.id).not.toHaveProperty('difficulty');
  });

  it('코스 항목의 난이도가 easy, normal, hard가 아니면 상황 알림 전체를 무시한다', () => {
    // null도 "난이도가 있는데 맞지 않는 값"으로 본다. 빠진 것(undefined)과는 다르다.
    for (const difficulty of ['', 'Easy', 'EASY', 'medium', '쉬움', 'easy ', 1, 0, true, null, {}, ['easy']]) {
      const courses = [
        { ...COURSES[0], difficulty: 'easy' },
        { ...COURSES[1], difficulty },
      ];
      expect(decodeSituation(badSituation({ courses })), `difficulty ${JSON.stringify(difficulty)}`).toBeUndefined();
    }
  });

  it('모르는 장면은 무시한다', () => {
    for (const scene of ['paused', '', 'Sailing', 3, null]) {
      expect(decodeSituation(badSituation({ scene })), `scene ${scene}`).toBeUndefined();
    }
  });

  it('전복 여부, 소리, 파도 세기 잠금이 참거짓이 아니면 무시한다', () => {
    for (const bad of ['true', 1, null, undefined]) {
      expect(decodeSituation(badSituation({ capsized: bad })), `capsized ${bad}`).toBeUndefined();
      expect(decodeSituation(badSituation({ soundOn: bad })), `soundOn ${bad}`).toBeUndefined();
      expect(decodeSituation(badSituation({ seaLevelLocked: bad })), `seaLevelLocked ${bad}`).toBeUndefined();
    }
  });

  it('파도 세기가 1~5의 정수가 아니면 무시한다', () => {
    for (const seaLevel of [0, 6, 2.5, -3, Number.NaN, Number.POSITIVE_INFINITY, '3', undefined]) {
      expect(decodeSituation(badSituation({ seaLevel })), `seaLevel ${seaLevel}`).toBeUndefined();
    }
  });

  it('목록의 항목에 문자열 id, 이름, 설명이 없으면 무시한다', () => {
    const broken: unknown[] = [
      { name: '한산도', note: '설명' },
      { id: 'a', note: '설명' },
      { id: 'a', name: '한산도' },
      { id: 1, name: '한산도', note: '설명' },
      { id: 'a', name: null, note: '설명' },
      { id: 'a', name: '한산도', note: 7 },
      null,
      'hansan',
    ];
    for (const item of broken) {
      expect(decodeSituation(badSituation({ courses: [COURSES[0], item] })), `course ${JSON.stringify(item)}`).toBe(
        undefined,
      );
      expect(decodeSituation(badSituation({ starts: [item, STARTS[1]] })), `start ${JSON.stringify(item)}`).toBe(
        undefined,
      );
    }
  });

  it('목록이 배열이 아니면 무시한다', () => {
    for (const bad of [undefined, null, 'hansan', COURSES[0]]) {
      expect(decodeSituation(badSituation({ courses: bad })), `courses ${JSON.stringify(bad)}`).toBeUndefined();
      expect(decodeSituation(badSituation({ starts: bad })), `starts ${JSON.stringify(bad)}`).toBeUndefined();
    }
  });

  it('타임어택의 남은 초, 지난 시간, 기록이 유한한 수가 아니면 무시한다', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        decodeSituation(badSituation({ race: { courseName: '한산도 한 바퀴', countdown: bad } }, 'countdown')),
        `countdown ${bad}`,
      ).toBeUndefined();
      expect(
        decodeSituation(badSituation({ race: { courseName: '한산도 한 바퀴', elapsed: bad } }, 'racing')),
        `elapsed ${bad}`,
      ).toBeUndefined();
      expect(
        decodeSituation(badSituation({ race: { courseName: '한산도 한 바퀴', time: bad } }, 'finished')),
        `time ${bad}`,
      ).toBeUndefined();
    }
  });

  it('형식이 맞지 않는 문자열은 예외 없이 무시한다', () => {
    for (const text of MALFORMED) {
      expect(() => decodeSituation(text), JSON.stringify(text)).not.toThrow();
      expect(decodeSituation(text), JSON.stringify(text)).toBeUndefined();
    }
  });

  it('같은 통로로 오는 조종, 배의 상태, 명령 메시지는 상황으로 읽지 않는다', () => {
    expect(
      decodeSituation(
        encodeHelm({
          throttleRate: 0,
          rudder: 0.3,
          neutralCount: 0,
          resetCount: 0,
          viewResetCount: 0,
          viewX: 0,
          viewY: 0,
          session: 's1',
        }),
      ),
    ).toBeUndefined();
    expect(decodeSituation(encodeShipStatus({ throttle: -1, capsized: false }))).toBeUndefined();
    for (const command of VALID_COMMANDS) {
      expect(decodeSituation(encodeCommand(command)), JSON.stringify(command)).toBeUndefined();
    }
  });

  it('상황 메시지는 조종 메시지나 배의 상태 메시지로 읽지 않는다', () => {
    for (const scene of ALL_SCENES) {
      const text = encodeSituation(situation(scene, { capsized: true }));
      expect(decodeHelm(text), scene).toBeUndefined();
      expect(decodeShipStatus(text), scene).toBeUndefined();
    }
  });
});

describe('지금 상황에서 실행할 수 있는 명령', () => {
  /**
   * 장면별로 각 명령을 실행할 수 있는지. PC에서 같은 버튼을 누를 수 있는지와 같다.
   * 코스와 시작 위치는 목록에 있는 것을 가리키고, 파도 세기는 아래에서 잠금과 함께 따로 확인한다.
   */
  const TABLE: Record<
    Exclude<ControllerCommand['kind'], 'setSeaLevel'>,
    { command: ControllerCommand; allowed: GameScene[] }
  > = {
    startSailing: { command: { kind: 'startSailing' }, allowed: ['start'] },
    startRace: {
      command: { kind: 'startRace', courseId: 'geoje' },
      allowed: ['start', 'sailing', 'countdown', 'racing', 'finished'],
    },
    quitRace: { command: { kind: 'quitRace' }, allowed: ['countdown', 'racing', 'finished'] },
    retryRace: { command: { kind: 'retryRace' }, allowed: ['finished'] },
    moveToStart: {
      command: { kind: 'moveToStart', startId: '1' },
      allowed: ['sailing', 'countdown', 'racing', 'finished'],
    },
    setSound: {
      command: { kind: 'setSound', on: false },
      allowed: ['start', 'sailing', 'countdown', 'racing', 'finished'],
    },
  };

  for (const [kind, { command, allowed }] of Object.entries(TABLE)) {
    it(`${kind}: ${allowed.join(', ')}에서만 실행한다`, () => {
      for (const scene of ALL_SCENES) {
        expect(canRunCommand(command, situation(scene)), `${kind} @ ${scene}`).toBe(allowed.includes(scene));
      }
    });
  }

  it('자료를 불러오는 중에는 어떤 명령도 실행하지 않는다', () => {
    for (const command of VALID_COMMANDS) {
      for (const seaLevelLocked of [false, true]) {
        expect(canRunCommand(command, situation('loading', { seaLevelLocked })), JSON.stringify(command)).toBe(false);
      }
    }
  });

  it('타임어택을 하고 있지 않을 때의 그만두기와 다시 도전은 무시한다', () => {
    for (const scene of ['start', 'sailing'] as const) {
      expect(canRunCommand({ kind: 'quitRace' }, situation(scene)), scene).toBe(false);
      expect(canRunCommand({ kind: 'retryRace' }, situation(scene)), scene).toBe(false);
    }
  });

  it('파도 세기는 잠겨 있지 않을 때만 바꿀 수 있고, 시작 화면에서도 바꿀 수 있다', () => {
    for (const scene of ALL_SCENES.filter((s) => s !== 'loading')) {
      for (const level of [1, 5]) {
        const command: ControllerCommand = { kind: 'setSeaLevel', level };
        expect(canRunCommand(command, situation(scene, { seaLevelLocked: false })), `${scene} 열림`).toBe(true);
        expect(canRunCommand(command, situation(scene, { seaLevelLocked: true })), `${scene} 잠김`).toBe(false);
      }
    }
  });

  it('타임어택 중에는 파도 세기를 바꿀 수 없다', () => {
    for (const scene of ['countdown', 'racing'] as const) {
      expect(canRunCommand({ kind: 'setSeaLevel', level: 2 }, situation(scene)), scene).toBe(false);
    }
  });

  it('목록에 없는 코스를 가리키는 타임어택 시작 명령은 어느 장면에서도 무시한다', () => {
    // '0'은 시작 위치의 id이지만 코스의 id가 아니다. 두 목록을 섞어 찾지 않는지 함께 확인한다.
    for (const courseId of ['nowhere', '0', 'HANSAN', 'hansan ']) {
      for (const scene of ALL_SCENES) {
        expect(canRunCommand({ kind: 'startRace', courseId }, situation(scene)), `${courseId} @ ${scene}`).toBe(false);
      }
    }
    expect(canRunCommand({ kind: 'startRace', courseId: 'hansan' }, situation('sailing', { courses: [] }))).toBe(false);
  });

  it('목록에 없는 시작 위치를 가리키는 옮기기 명령은 어느 장면에서도 무시한다', () => {
    // 시작 위치는 순번이 id이므로, 목록 길이(3)와 같은 순번 '3'은 없는 위치이다. 코스의 id도 시작 위치가 아니다.
    for (const startId of ['3', '-1', '99', 'hansan', '1.0']) {
      for (const scene of ALL_SCENES) {
        expect(canRunCommand({ kind: 'moveToStart', startId }, situation(scene)), `${startId} @ ${scene}`).toBe(false);
      }
    }
    expect(canRunCommand({ kind: 'moveToStart', startId: '0' }, situation('sailing', { starts: [] }))).toBe(false);
  });
});
