import { describe, expect, it } from 'vitest';
import { seededRandom } from '../core/random';
import { transform } from './fft';

/** 정의를 그대로 계산하는 느린 변환. 비교의 기준으로 사용한다. */
function slowTransform(input: Float64Array): Float64Array {
  const size = input.length / 2;
  const output = new Float64Array(input.length);
  for (let n = 0; n < size; n++) {
    for (let k = 0; k < size; k++) {
      const angle = (-2 * Math.PI * n * k) / size;
      output[n * 2] += input[k * 2] * Math.cos(angle) - input[k * 2 + 1] * Math.sin(angle);
      output[n * 2 + 1] += input[k * 2] * Math.sin(angle) + input[k * 2 + 1] * Math.cos(angle);
    }
  }
  return output;
}

describe('푸리에 변환', () => {
  it.each([2, 8, 64])('길이 %i에서 정의대로 계산한 결과와 같다', (size) => {
    const random = seededRandom(size);
    const input = Float64Array.from({ length: size * 2 }, () => random() * 2 - 1);
    const expected = slowTransform(input);
    transform(input).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
  });

  it('주파수 하나만 있는 입력은 그 주파수의 파도 하나가 된다', () => {
    // k = 1과 k = -1(= 7)에 절반씩 넣으면 cos(2πn/8)이 된다.
    const input = new Float64Array(16);
    input[1 * 2] = 0.5;
    input[7 * 2] = 0.5;
    const output = transform(input);
    for (let n = 0; n < 8; n++) {
      expect(output[n * 2]).toBeCloseTo(Math.cos((2 * Math.PI * n) / 8), 9);
      expect(output[n * 2 + 1]).toBeCloseTo(0, 9);
    }
  });
});
