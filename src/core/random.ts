/**
 * 씨앗 값이 같으면 항상 같은 순서의 난수(0 이상 1 미만)를 내는 함수를 만든다 (mulberry32).
 * 타임어택처럼 매번 같은 조건을 재현해야 하는 곳에서 Math.random 대신 사용한다.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 문자열을 씨앗 값으로 쓸 정수로 바꾼다. */
export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}
