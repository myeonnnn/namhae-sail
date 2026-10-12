// 경위도([경도, 위도])로 적힌 선과 윤곽을 다루는 계산.

const METERS_PER_DEG = 111320;

/**
 * 거리와 면적을 미터로 계산하려면 경도의 간격을 위도에 맞게 줄여야 한다.
 * @param {number} latitude 계산의 기준으로 삼을 위도 (도). 다루는 범위의 가운데를 넣는다.
 */
export function createGeometry(latitude) {
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const toMeters = ([lon, lat]) => [lon * METERS_PER_DEG * cosLat, lat * METERS_PER_DEG];

  /** Douglas–Peucker: 양 끝을 잇는 직선에서 가장 먼 점이 허용 오차(m) 안에 있으면 중간의 점을 모두 버린다. */
  function simplify(points, tolerance) {
    if (points.length < 3) return points;
    const meters = points.map(toMeters);
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      const [ax, ay] = meters[first];
      const [bx, by] = meters[last];
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.hypot(dx, dy) || 1;
      let worst = 0;
      let index = -1;
      for (let i = first + 1; i < last; i++) {
        const distance = Math.abs((meters[i][0] - ax) * dy - (meters[i][1] - ay) * dx) / length;
        if (distance > worst) {
          worst = distance;
          index = i;
        }
      }
      if (worst > tolerance) {
        keep[index] = 1;
        stack.push([first, index], [index, last]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  /**
   * 닫힌 윤곽을 단순화한다.
   * 닫힌 윤곽은 첫 점과 끝 점이 같아서, 그대로 단순화하면 양 끝을 잇는 직선의 길이가 0이 되어 모든 점이 버려진다.
   * 그래서 윤곽을 둘로 나누어서 각각 단순화한 다음에 다시 잇는다.
   */
  function simplifyRing(points, tolerance) {
    const half = Math.floor(points.length / 2);
    return [...simplify(points.slice(0, half + 1), tolerance).slice(0, -1), ...simplify(points.slice(half), tolerance)];
  }

  /** 윤곽의 면적 (m²). 첫 점이 끝에 반복되어 있어도, 반복되어 있지 않아도 같은 값이 나온다. */
  function area(points) {
    const meters = points.map(toMeters);
    let sum = 0;
    for (let i = 0; i < meters.length; i++) {
      const [x1, y1] = meters[i];
      const [x2, y2] = meters[(i + 1) % meters.length];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  }

  return { toMeters, simplify, simplifyRing, area };
}
