import { describe, expect, it } from 'vitest';
import { cleanHeights, TILE_PIXELS } from './terrainTile';

const at = (x: number, y: number) => y * TILE_PIXELS + x;
const sea = () => new Float32Array(TILE_PIXELS * TILE_PIXELS).fill(-5);

describe('cleanHeights', () => {
  it('removes a one-pixel spike but keeps a broad hill', () => {
    const heights = sea();
    // 완만한 언덕: 가운데가 120m이고 한 픽셀마다 4m씩 낮아진다.
    for (let y = 60; y <= 140; y++) {
      for (let x = 60; x <= 140; x++)
        heights[at(x, y)] = Math.max(2, 120 - 4 * Math.max(Math.abs(x - 100), Math.abs(y - 100)));
    }
    heights[at(100, 100)] = 120;
    heights[at(70, 70)] = 900;
    cleanHeights(heights);
    expect(heights[at(70, 70)]).toBeLessThan(20);
    expect(heights[at(100, 100)]).toBe(120);
    expect(heights[at(110, 100)]).toBe(80);
  });

  it('erases small low specks in the sea but keeps a tall rock and a real island', () => {
    const heights = sea();
    heights[at(20, 20)] = 3;
    heights[at(21, 20)] = 4;
    // 작지만 높은 바위섬
    heights[at(50, 50)] = 25;
    heights[at(51, 50)] = 30;
    // 넓고 낮은 섬
    for (let y = 150; y < 160; y++) for (let x = 150; x < 160; x++) heights[at(x, y)] = 3;
    cleanHeights(heights);
    expect(heights[at(20, 20)]).toBeLessThan(0);
    expect(heights[at(21, 20)]).toBeLessThan(0);
    expect(heights[at(51, 50)]).toBe(30);
    expect(heights[at(155, 155)]).toBe(3);
  });

  it('follows the coastline mask where it is available', () => {
    const heights = sea();
    const mask = new Uint8Array(TILE_PIXELS * TILE_PIXELS).fill(255);
    // 표고에는 땅으로 기록되어 있지만 해안선 자료로는 바다인 곳
    heights[at(30, 30)] = 6;
    mask[at(30, 30)] = 0;
    // 표고에는 빠져 있지만 해안선 자료로는 육지인 곳
    mask[at(40, 40)] = 1;
    cleanHeights(heights, mask);
    expect(heights[at(30, 30)]).toBeLessThan(0);
    expect(heights[at(40, 40)]).toBeGreaterThan(1);
  });
});
