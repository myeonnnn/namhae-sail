/**
 * 수평면을 일정한 크기의 칸으로 나누어서 물체를 등록해 두는 색인.
 * 충돌을 판정하거나 주변의 물체를 찾을 때, 구역 전체가 아니라 가까운 칸의 물체만 조사하게 한다.
 */
export class SpatialGrid<T> {
  private readonly cells = new Map<string, T[]>();

  constructor(private readonly cellSize: number) {}

  /** 주어진 범위에 걸쳐 있는 모든 칸에 항목을 등록한다. */
  insertBox(minX: number, minZ: number, maxX: number, maxZ: number, item: T): void {
    const { cellSize } = this;
    for (let cz = Math.floor(minZ / cellSize); cz <= Math.floor(maxZ / cellSize); cz++) {
      for (let cx = Math.floor(minX / cellSize); cx <= Math.floor(maxX / cellSize); cx++) {
        const key = `${cx}/${cz}`;
        const cell = this.cells.get(key);
        if (!cell) this.cells.set(key, [item]);
        // 같은 항목을 여러 번 등록해도 한 칸에는 한 번만 들어가게 한다.
        else if (!cell.includes(item)) cell.push(item);
      }
    }
  }

  /** 한 지점과 그 주변(margin)에 걸친 칸에 항목을 등록한다. */
  insertPoint(x: number, z: number, item: T, margin = 0): void {
    this.insertBox(x - margin, z - margin, x + margin, z + margin, item);
  }

  /** 한 지점이 속한 칸에 등록된 항목 */
  at(x: number, z: number): readonly T[] {
    return this.cells.get(`${Math.floor(x / this.cellSize)}/${Math.floor(z / this.cellSize)}`) ?? EMPTY;
  }

  /** 한 지점에서 radius 이내에 걸친 칸에 등록된 항목. 칸 단위로 고르므로, 정확한 거리는 호출하는 쪽에서 다시 확인해야 한다. */
  near(x: number, z: number, radius: number): T[] {
    const { cellSize } = this;
    const result: T[] = [];
    for (let cz = Math.floor((z - radius) / cellSize); cz <= Math.floor((z + radius) / cellSize); cz++) {
      for (let cx = Math.floor((x - radius) / cellSize); cx <= Math.floor((x + radius) / cellSize); cx++) {
        const cell = this.cells.get(`${cx}/${cz}`);
        if (cell) result.push(...cell);
      }
    }
    return result;
  }
}

const EMPTY: readonly never[] = [];
