import type { Course } from './course';

/** 완주한 기록 한 건 */
export interface RaceResult {
  courseId: string;
  /** 기록을 세운 코스의 판. 코스를 고치면 이전 판의 기록과는 비교하지 않는다. */
  courseVersion: number;
  /** 기록: 흐른 시간에 벌점을 더한 값 (초) */
  total: number;
  /** 벌점을 뺀 주행 시간 (초) */
  time: number;
  capsizes: number;
  /** 각 관문을 지난 시각 (초, 벌점 포함) */
  splits: number[];
  /** 완주한 시각 (ISO 8601) */
  finishedAt: string;
}

/**
 * 기록을 보관하는 곳. 지금은 브라우저에 저장하고, 나중에 서버로 바꿀 수 있도록 인터페이스로 분리한다.
 * 서버의 응답을 기다려야 할 수 있으므로 모든 메서드가 Promise를 반환한다.
 */
export interface RecordStore {
  /** 이 코스의 최고 기록. 없으면 undefined이다. */
  best(course: Course): Promise<RaceResult | undefined>;
  /** 기록을 제출하고, 그 뒤의 최고 기록과 이번에 경신했는지를 반환한다. */
  submit(result: RaceResult): Promise<{ best: RaceResult; improved: boolean }>;
}

const KEY_PREFIX = 'namhae-sail:best:';

/** 코스마다 최고 기록 한 건을 브라우저의 localStorage에 저장한다. */
export class LocalRecordStore implements RecordStore {
  async best(course: Course): Promise<RaceResult | undefined> {
    return this.read(course.id, course.version);
  }

  async submit(result: RaceResult): Promise<{ best: RaceResult; improved: boolean }> {
    const previous = this.read(result.courseId, result.courseVersion);
    if (previous && previous.total <= result.total) return { best: previous, improved: false };
    try {
      localStorage.setItem(KEY_PREFIX + result.courseId, JSON.stringify(result));
    } catch {
      // 저장 공간을 쓸 수 없는 환경(사생활 보호 모드 등)에서는 기록을 남기지 못할 뿐, 진행은 계속한다.
    }
    return { best: result, improved: true };
  }

  private read(courseId: string, version: number): RaceResult | undefined {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY_PREFIX + courseId) ?? 'null') as RaceResult | null;
      // 코스가 바뀌기 전의 기록은 조건이 달라서 비교할 수 없다.
      return stored && stored.courseVersion === version && Number.isFinite(stored.total) ? stored : undefined;
    } catch {
      return undefined;
    }
  }
}
