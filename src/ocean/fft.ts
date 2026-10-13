/** 복소수의 배열. 실수부와 허수부가 번갈아 들어 있다. */
export type ComplexArray = Float64Array;

/**
 * 푸리에 변환의 한 단계(Stockham 방식)를 수행한다. GPU의 셰이더(detailWaves.ts)가 하는 계산을 그대로 옮긴 것으로,
 * 셰이더의 수식이 맞는지를 테스트로 확인하는 데 사용한다.
 *
 * subSize를 2, 4, 8, ..., 전체 길이의 순서로 바꿔 가며 반복하면 전체의 변환이 완성된다.
 * 흔히 쓰는 방식과 달리 입력의 순서를 미리 뒤섞을 필요가 없어서, 텍스처 두 장을 번갈아 그리는 것만으로 구현할 수 있다.
 */
export function stockhamPass(input: ComplexArray, subSize: number): ComplexArray {
  const size = input.length / 2;
  const output = new Float64Array(input.length);
  for (let index = 0; index < size; index++) {
    const even = Math.floor(index / subSize) * (subSize / 2) + (index % (subSize / 2));
    const odd = even + size / 2;
    const angle = (-2 * Math.PI * index) / subSize;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    output[index * 2] = input[even * 2] + cos * input[odd * 2] - sin * input[odd * 2 + 1];
    output[index * 2 + 1] = input[even * 2 + 1] + cos * input[odd * 2 + 1] + sin * input[odd * 2];
  }
  return output;
}

/** 길이가 2의 거듭제곱인 배열을 변환한다: X[n] = Σ x[k]·e^(-2πi·nk/N) */
export function transform(input: ComplexArray): ComplexArray {
  let data = input;
  for (let subSize = 2; subSize <= input.length / 2; subSize *= 2) data = stockhamPass(data, subSize);
  return data;
}
