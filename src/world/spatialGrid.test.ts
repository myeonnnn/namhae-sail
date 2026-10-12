import { describe, expect, it } from 'vitest';
import { SpatialGrid } from './spatialGrid';

describe('SpatialGrid', () => {
  it('범위가 걸친 모든 칸에서 항목을 찾을 수 있다', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insertBox(-50, 20, 250, 30, 'wall');
    expect(grid.at(-10, 25)).toEqual(['wall']);
    expect(grid.at(150, 25)).toEqual(['wall']);
    expect(grid.at(250, 99)).toEqual(['wall']);
    expect(grid.at(350, 25)).toEqual([]);
    expect(grid.at(150, 150)).toEqual([]);
  });

  it('같은 항목을 겹쳐서 등록해도 한 칸에는 한 번만 들어간다', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insertPoint(10, 10, 'pier', 5);
    grid.insertPoint(20, 20, 'pier', 5);
    expect(grid.at(15, 15)).toEqual(['pier']);
  });

  it('주변의 칸에 있는 항목을 모은다', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insertPoint(50, 50, 'near');
    grid.insertPoint(950, 50, 'far');
    expect(grid.near(120, 60, 100)).toEqual(['near']);
    expect(grid.near(500, 50, 500).sort()).toEqual(['far', 'near']);
  });
});
