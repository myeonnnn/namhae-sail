import { hashString, seededRandom } from '../core/random';
import type { Course } from '../course/course';
import type { RaceResult, RecordStore } from '../course/records';
import { selectSeaLevel } from '../environment/seaState';
import type { Weather } from '../environment/weather';
import { CAPSIZE_PENALTY, COUNTDOWN_SECONDS, Race } from '../sim/race';
import type { SeaEffects } from '../sim/seaEffects';
import type { Ship } from '../ship/ship';
import type { Hud } from '../ui/hud';
import type { RaceHud } from '../ui/raceHud';
import { playCount, playFanfare, playGate, playGo } from '../ui/sound';
import type { CourseGates } from '../world/courseGates';

// 완주한 뒤에 결과를 보여 주기까지의 시간 (ms)
const RESULT_DELAY_MS = 2000;

/** 타임어택이 다루는 것들. main.ts가 만들어서 넘긴다. */
export interface TimeAttackHost {
  ship: Ship;
  weather: Weather;
  hud: Hud;
  raceHud: RaceHud;
  gates: CourseGates;
  seaEffects: SeaEffects;
  records: RecordStore;
  /** 배를 지정한 위치에 정지한 상태로 놓는다. */
  placeShip(x: number, z: number, heading: number): void;
  /** 파도의 시각을 0으로 되돌린다. 출발할 때마다 같은 파도가 같은 순간에 오게 한다. */
  restartSeaClock(): void;
}

/**
 * 타임어택의 진행을 화면과 세계에 연결한다: 코스를 세우고, 날씨를 고정하고, 통과와 완주를 알리고, 기록을 남긴다.
 * 규칙 자체(카운트다운, 관문의 통과, 벌점)는 sim/race.ts에 있다.
 */
export class TimeAttack {
  private race?: Race;
  private random: () => number = Math.random;

  constructor(private readonly host: TimeAttackHost) {}

  /** 도전하고 있으면 true. 완주한 뒤에 결과를 보고 있는 동안도 포함한다. */
  get active(): boolean {
    return this.race !== undefined;
  }

  /** 카운트다운을 세는 동안에는 배를 움직이지 않는다. */
  get frozen(): boolean {
    return this.race?.phase === 'countdown';
  }

  /** 도전하는 동안 날씨의 변화에 사용할 난수. 도전하고 있지 않으면 undefined이다. */
  get weatherRandom(): (() => number) | undefined {
    return this.race ? this.random : undefined;
  }

  /** 코스의 출발 위치에서 카운트다운부터 시작한다. */
  start(course: Course): void {
    const { host } = this;
    const { wind, swell, sea } = host.weather;
    this.race = new Race(course);

    // 같은 코스는 언제 도전해도 같은 바다여야 기록을 비교할 수 있다. 풍향과 파도의 세기, 날씨가 바뀌는 순서를 고정한다.
    wind.fromDeg = course.windFromDeg;
    selectSeaLevel(sea, course.seaLevel, wind, swell);
    this.random = seededRandom(hashString(`${course.id}:${course.version}`));

    host.placeShip(course.start.x, course.start.z, course.start.heading);
    host.restartSeaClock();
    host.gates.show(course);
    host.hud.setCourse(course);
    host.hud.closeSettings();
    host.raceHud.show(course);
    host.seaEffects.capsizeMessage = `전복: R 키로 마지막 관문에서 다시 출발 (+${CAPSIZE_PENALTY}초)`;
    host.seaEffects.onCapsize = () => this.race?.capsize();

    this.race.begin();
    host.raceHud.flash(String(COUNTDOWN_SECONDS));
    playCount();
  }

  /** 도전을 그만두고 자유 항해로 돌아간다. 배는 지금의 자리에 둔다. */
  quit(): void {
    if (!this.race) return;
    this.race = undefined;
    const { host } = this;
    host.gates.hide();
    host.hud.setCourse();
    host.raceHud.hide();
    host.seaEffects.resetCapsizeHandling();
  }

  /** 전복된 뒤에, 마지막으로 지난 관문에서 다시 출발한다. */
  respawn(): void {
    if (!this.race) return;
    const { x, z, heading } = this.race.respawn;
    this.host.placeShip(x, z, heading);
  }

  /**
   * 물리와 같은 간격으로 진행한다.
   * @param from, to 이번 스텝에 선박이 이동하기 전과 후의 위치
   */
  step(dt: number, from: { x: number; z: number }, to: { x: number; z: number }): void {
    const { race, host } = this;
    if (!race) return;
    for (const event of race.step(dt, from, to)) {
      if (event.type === 'count') {
        host.raceHud.flash(String(event.remaining));
        playCount();
      } else if (event.type === 'go') {
        host.raceHud.flash('출발', 'go');
        playGo();
      } else if (event.type === 'gate') {
        host.gates.setNext(race.nextGate);
        host.hud.setNextGate(race.nextGate);
        if (race.phase !== 'finished') playGate();
      } else {
        this.finish(race);
      }
    }
  }

  /** 매 프레임 호출해서 화면의 표시를 갱신한다. */
  render(): void {
    if (this.race) this.host.raceHud.update(this.race, this.host.ship.state);
  }

  private finish(race: Race): void {
    const { host } = this;
    host.raceHud.flash('FINISH', 'finish');
    playFanfare();
    // 완주한 뒤에는 전복되어도 기록에 영향을 주지 않는다.
    host.seaEffects.resetCapsizeHandling();

    const result: RaceResult = {
      courseId: race.course.id,
      courseVersion: race.course.version,
      total: race.total,
      time: race.time,
      capsizes: race.capsizes,
      splits: [...race.splits],
      finishedAt: new Date().toISOString(),
    };
    // 완주를 알리는 큰 글자와 팡파르가 지나간 뒤에 결과를 보여 준다.
    const shown = new Promise((done) => window.setTimeout(done, RESULT_DELAY_MS));
    void Promise.all([host.records.submit(result), shown]).then(([record]) => {
      // 기다리는 사이에 그만두었거나 다시 시작했으면 표시하지 않는다.
      if (this.race !== race) return;
      host.raceHud.showResult(race.course, result, record, {
        retry: () => this.start(race.course),
        exit: () => this.quit(),
      });
    });
  }
}
