/** 코스의 등급 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

/**
 * 바다의 세기와 위험한 선택의 점수(각각 1~3)로 등급을 정한다.
 * 두 값의 합이 3 이하이면 easy, 4이면 normal, 5 이상이면 hard이다.
 */
export function difficultyOf(seaScore: number, riskScore: number): Difficulty {
  const total = seaScore + riskScore;
  return total <= 3 ? 'easy' : total === 4 ? 'normal' : 'hard';
}
