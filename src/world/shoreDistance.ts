const DIAGONAL = Math.SQRT2;

/**
 * 격자의 칸마다 가장 가까운 육지까지의 거리(칸 단위)를 구한다. 육지인 칸은 0이다.
 *
 * 왼쪽 위에서 오른쪽 아래로 한 번, 반대 방향으로 한 번 훑으면서 이웃 칸의 값에 한 칸의 거리를 더해 나간다.
 * 칸마다 모든 육지를 찾아보는 방법보다 훨씬 빠르고, 오차는 몇 %에 그친다.
 */
export function distanceToLand(land: Uint8Array, columns: number, rows: number): Float32Array {
  const distance = new Float32Array(columns * rows);
  for (let i = 0; i < distance.length; i++) distance[i] = land[i] === 1 ? 0 : Infinity;

  const relax = (index: number, column: number, row: number, dc: number, dr: number, step: number) => {
    const c = column + dc;
    const r = row + dr;
    if (c < 0 || r < 0 || c >= columns || r >= rows) return;
    const candidate = distance[r * columns + c] + step;
    if (candidate < distance[index]) distance[index] = candidate;
  };

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      relax(index, column, row, -1, 0, 1);
      relax(index, column, row, 0, -1, 1);
      relax(index, column, row, -1, -1, DIAGONAL);
      relax(index, column, row, 1, -1, DIAGONAL);
    }
  }
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      const index = row * columns + column;
      relax(index, column, row, 1, 0, 1);
      relax(index, column, row, 0, 1, 1);
      relax(index, column, row, 1, 1, DIAGONAL);
      relax(index, column, row, -1, 1, DIAGONAL);
    }
  }
  return distance;
}
