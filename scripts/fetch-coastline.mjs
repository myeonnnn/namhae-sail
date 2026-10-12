// OpenStreetMap의 해안선을 내려받아서 육지의 폴리곤으로 조립하고, 운영 구역(src/geo/region.json)으로 잘라서
// public/data/land.json으로 저장한다.
// 실행: node scripts/fetch-coastline.mjs          (조립해 둔 결과가 .cache에 있으면 내려받지 않고 다시 사용한다)
//       node scripts/fetch-coastline.mjs --fresh  (항상 새로 내려받는다)
// 자료의 라이선스는 ODbL이며, 화면에 "© OpenStreetMap contributors"를 표기해야 한다.
//
// OpenStreetMap의 해안선은 짧은 선분(way)의 모음으로 기록되어 있다.
// 이웃한 선분은 끝점을 공유하므로, 끝점이 같은 선분을 이어 붙이면 섬은 닫힌 고리가 되고 본토는 범위의 바깥에서 끊긴 긴 선이 된다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createGeometry } from './lib/geometry.mjs';
import { queryOverpass } from './lib/overpass.mjs';
import { DATA_BOUNDS, ROOT } from './lib/region.mjs';

const OUT = resolve(ROOT, 'public/data/land.json');
const CACHE = resolve(ROOT, '.cache/coastline-rings.json');
// 해안선을 조립하는 범위 (남, 서, 북, 동). 운영 구역보다 훨씬 넓게 잡는다.
// 좁은 범위만 내려받으면 본토와 큰 섬의 해안선이 범위의 경계에서 여러 조각으로 끊겨서, 올바른 폴리곤으로 닫을 수 없다.
const BOUNDS = [33.0, 125.0, 35.5, 129.5];
// 한 번에 요청하면 응답이 너무 커서 서버가 거절하므로, 범위를 격자로 나누어서 요청한다.
const GRID = { columns: 3, rows: 2 };
// 이 거리(m)보다 작은 굴곡은 지도의 축척에서 구분되지 않으므로 생략한다.
const SIMPLIFY_TOLERANCE = 6;
// 이 면적(m²)보다 작은 암초는 제외한다.
const MIN_AREA = 300;
/** 내려받은 선분을 이어 붙인 고리의 목록을 반환한다. 내려받기는 오래 걸리고 서버에 부담을 주므로 결과를 보관한다. */
async function loadChains() {
  if (existsSync(CACHE) && !process.argv.includes('--fresh')) {
    console.log(`보관해 둔 조립 결과를 사용합니다: ${CACHE}`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }

  // ---- 1. 내려받기 ----
  const ways = new Map();
  const [south, west, north, east] = BOUNDS;
  for (let row = 0; row < GRID.rows; row++) {
    for (let column = 0; column < GRID.columns; column++) {
      const s = south + ((north - south) * row) / GRID.rows;
      const n = south + ((north - south) * (row + 1)) / GRID.rows;
      const w = west + ((east - west) * column) / GRID.columns;
      const e = west + ((east - west) * (column + 1)) / GRID.columns;
      const { elements } = await queryOverpass(
        `[out:json][timeout:180];way["natural"="coastline"](${s},${w},${n},${e});out geom qt;`,
        { purpose: 'coastline preprocessing' },
      );
      // 격자의 경계에 걸친 선분은 양쪽에서 모두 반환되므로 id로 중복을 제거한다.
      for (const way of elements) ways.set(way.id, way);
      console.log(`격자 ${row * GRID.columns + column + 1}/${GRID.rows * GRID.columns}: 선분 ${elements.length}개`);
    }
  }

  // ---- 2. 선분을 이어 붙이기 ----
  const byFirstNode = new Map();
  for (const way of ways.values()) byFirstNode.set(way.nodes[0], way);
  const endNodes = new Set([...ways.values()].map((way) => way.nodes.at(-1)));

  const used = new Set();
  function chainFrom(start) {
    const points = [];
    let way = start;
    let closed = false;
    while (way && !used.has(way.id)) {
      used.add(way.id);
      // 앞 선분의 마지막 점과 겹치는 첫 점은 한 번만 넣는다.
      for (let i = points.length ? 1 : 0; i < way.geometry.length; i++) {
        points.push([way.geometry[i].lon, way.geometry[i].lat]);
      }
      const last = way.nodes.at(-1);
      if (last === start.nodes[0]) closed = true;
      way = byFirstNode.get(last);
    }
    return { points, closed };
  }

  const chains = [];
  // 앞에 이어질 선분이 없는 것부터 시작해야 끊긴 선이 중간에서 나뉘지 않는다.
  for (const way of ways.values()) if (!endNodes.has(way.nodes[0])) chains.push(chainFrom(way));
  for (const way of ways.values()) if (!used.has(way.id)) chains.push(chainFrom(way));

  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(chains));
  return chains;
}

const chains = await loadChains();
const [south, , north] = BOUNDS;

// ---- 3. 단순화 ----
const { simplifyRing, area } = createGeometry((south + north) / 2);

// 운영 구역에 자료의 여유 범위를 더한 직사각형으로 잘라 낸다.
const clip = DATA_BOUNDS;
/**
 * 폴리곤을 직사각형으로 잘라 낸다 (Sutherland–Hodgman).
 * 직사각형의 네 변을 차례로 기준으로 삼아서, 변의 안쪽에 있는 부분만 남기고 변과 만나는 지점에 새 꼭짓점을 넣는다.
 */
function clipRing(ring) {
  const edges = [
    [(p) => p[0] >= clip.west, (a, b) => [clip.west, a[1] + ((b[1] - a[1]) * (clip.west - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= clip.east, (a, b) => [clip.east, a[1] + ((b[1] - a[1]) * (clip.east - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= clip.south, (a, b) => [a[0] + ((b[0] - a[0]) * (clip.south - a[1])) / (b[1] - a[1]), clip.south]],
    [(p) => p[1] <= clip.north, (a, b) => [a[0] + ((b[0] - a[0]) * (clip.north - a[1])) / (b[1] - a[1]), clip.north]],
  ];
  let output = ring;
  for (const [isInside, intersect] of edges) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      if (isInside(current)) {
        if (!isInside(previous)) output.push(intersect(previous, current));
        output.push(current);
      } else if (isInside(previous)) {
        output.push(intersect(previous, current));
      }
    }
    if (output.length < 3) return [];
  }
  return output;
}

const polygons = [];
let openChains = 0;
let rawPoints = 0;
for (const { points: chainPoints, closed } of chains) {
  if (!closed) openChains++;
  // 운영 구역과 전혀 겹치지 않는 섬은 건너뛴다.
  let touches = false;
  for (const [lon, lat] of chainPoints) {
    if (lon >= clip.west && lon <= clip.east && lat >= clip.south && lat <= clip.north) {
      touches = true;
      break;
    }
  }
  if (!touches) continue;
  // 끊긴 선(본토)은 양 끝을 직선으로 이어서 닫은 것으로 취급한다. 끝점이 조립 범위의 바깥에 있으므로, 이 직선은 운영 구역에서 먼 내륙을 지난다.
  const points = clipRing(chainPoints);
  if (points.length < 4) continue;
  rawPoints += points.length;
  // 단순화는 양 끝을 고정하므로, 고리를 둘로 나누어서 처리한다.
  const ring = simplifyRing(points, SIMPLIFY_TOLERANCE);
  if (ring.length < 4 || area(ring) < MIN_AREA) continue;
  const rounded = ring.map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))]);
  const [firstLon, firstLat] = rounded[0];
  const [lastLon, lastLat] = rounded.at(-1);
  if (firstLon !== lastLon || firstLat !== lastLat) rounded.push(rounded[0]);
  polygons.push(rounded);
}

// 큰 폴리곤부터 그려지도록 정렬한다.
polygons.sort((a, b) => b.length - a.length);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons.map((ring) => [ring]) } }),
);

const keptPoints = polygons.reduce((sum, ring) => sum + ring.length, 0);
console.log(
  `조립한 고리 ${chains.length}개 (끊긴 선 ${openChains}개) → 운영 구역의 폴리곤 ${polygons.length}개, 점 ${rawPoints}개 → ${keptPoints}개`,
);
console.log(`→ ${OUT}`);
