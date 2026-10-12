// OpenStreetMap에서 운영 구역(src/geo/region.json)의 지명, 방파제와 부두, 다리, 시가지를 내려받아서
// public/data/chart.json으로 저장한다. 해도와 3D 화면에 육지의 지물을 표시하는 데 사용한다.
// 바다를 건너는 다리를 가려내는 데 public/data/land.json이 필요하므로, fetch-coastline.mjs를 먼저 실행해야 한다.
// 실행: node scripts/fetch-chart.mjs          (내려받은 원본이 .cache에 있으면 다시 사용한다)
//       node scripts/fetch-chart.mjs --fresh  (항상 새로 내려받는다)
// 자료의 라이선스는 ODbL이며, 화면에 "© OpenStreetMap contributors"를 표기해야 한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/chart.json');
const CACHE = resolve(ROOT, '.cache/chart-raw.json');
const LAND = resolve(ROOT, 'public/data/land.json');
// 물 위에 놓인 구간이 이 길이(m)보다 짧은 다리는 하천이나 도로를 건너는 육상의 다리로 보고 제외한다.
const MIN_WATER_SPAN = 60;
// 다리 밑의 높이는 자료에 없어서 추정한다. 사장교와 현수교는 대형 선박의 항로를 건너기 위한 형식이므로 높게 잡는다.
const DEFAULT_CLEARANCE = 20;
const TALL_BRIDGE_CLEARANCE = 50;
// 보행자용 다리는 대부분 해안의 물 위에 낮게 놓인 산책로이다.
const FOOTBRIDGE_CLEARANCE = 5;
const TALL_STRUCTURES = ['cable-stayed', 'suspension'];
const FOOTWAYS = ['footway', 'path', 'pedestrian', 'cycleway', 'steps'];
const { bounds: REGION, dataMargin: MARGIN } = JSON.parse(readFileSync(resolve(ROOT, 'src/geo/region.json'), 'utf8'));
const BBOX = [REGION.south - MARGIN, REGION.west - MARGIN, REGION.north + MARGIN, REGION.east + MARGIN].join(',');
// 이 거리(m)보다 작은 굴곡은 생략한다.
const SIMPLIFY_TOLERANCE = 8;
// 방파제와 부두는 폭이 몇 미터에 불과해서, 같은 기준을 적용하면 윤곽이 한 줄의 선으로 뭉개진다.
const STRUCTURE_TOLERANCE = 1;
// 이 면적(m²)보다 작은 시가지는 지도의 축척에서 점으로 보이므로 제외한다.
const MIN_URBAN_AREA = 40000;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const QUERY = `
[out:json][timeout:120];
(
  node["place"~"^(city|town|village|island|islet)$"]["name"](${BBOX});
  way["place"~"^(island|islet)$"]["name"](${BBOX});
  relation["place"~"^(island|islet)$"]["name"](${BBOX});
  node["natural"="peak"]["name"]["ele"](${BBOX});
  way["man_made"~"^(breakwater|pier|groyne)$"](${BBOX});
  way["bridge"]["highway"](${BBOX});
  way["landuse"~"^(residential|commercial|industrial|retail|port|harbour)$"](${BBOX});
);
out geom;`;

async function request() {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'namhae-sail (chart preprocessing)',
          },
          body: `data=${encodeURIComponent(QUERY)}`,
        });
        if (response.ok) return await response.json();
        console.warn(`${endpoint}: HTTP ${response.status}`);
      } catch (error) {
        console.warn(`${endpoint}: ${error.message}`);
      }
    }
    await new Promise((done) => setTimeout(done, 15000));
  }
  throw new Error('모든 Overpass 서버에서 요청이 실패했습니다. 잠시 후에 다시 실행하세요.');
}

const METERS_PER_DEG = 111320;
const cosLat = Math.cos((((REGION.south + REGION.north) / 2) * Math.PI) / 180);
const toMeters = ([lon, lat]) => [lon * METERS_PER_DEG * cosLat, lat * METERS_PER_DEG];
const round = (value) => Number(value.toFixed(5));

/** Douglas–Peucker: 양 끝을 잇는 직선에서 가장 먼 점이 허용 오차 안에 있으면 중간의 점을 모두 버린다. */
function simplify(points, tolerance = SIMPLIFY_TOLERANCE) {
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
function simplifyRing(points, tolerance = SIMPLIFY_TOLERANCE) {
  const half = Math.floor(points.length / 2);
  return [...simplify(points.slice(0, half + 1), tolerance).slice(0, -1), ...simplify(points.slice(half), tolerance)];
}

function area(points) {
  const meters = points.map(toMeters);
  let sum = 0;
  for (let i = 0; i < meters.length - 1; i++) sum += meters[i][0] * meters[i + 1][1] - meters[i + 1][0] * meters[i][1];
  return Math.abs(sum) / 2;
}

async function loadElements() {
  if (existsSync(CACHE) && !process.argv.includes('--fresh')) {
    console.log(`보관해 둔 원본을 사용합니다: ${CACHE}`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  const { elements } = await request();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(elements));
  return elements;
}

const elements = await loadElements();

const places = [];
const structures = [];
const bridgeWays = [];
const urban = [];

for (const element of elements) {
  const tags = element.tags ?? {};
  const line = element.geometry?.map(({ lon, lat }) => [lon, lat]);
  const closed = line && line.length > 3 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1];

  if (tags.place || tags.natural === 'peak') {
    // 면으로 등록된 섬은 좌표가 없으므로, 섬을 둘러싸는 범위의 가운데를 이름표의 위치로 삼는다.
    const { bounds } = element;
    const lat = element.lat ?? (bounds ? (bounds.minlat + bounds.maxlat) / 2 : undefined);
    const lon = element.lon ?? (bounds ? (bounds.minlon + bounds.maxlon) / 2 : undefined);
    if (lat === undefined) continue;
    places.push({
      kind: tags.natural === 'peak' ? 'peak' : tags.place,
      name: tags.name,
      lat: round(lat),
      lon: round(lon),
      ...(tags.ele ? { ele: Math.round(Number(tags.ele)) } : {}),
    });
  } else if (tags.man_made && line) {
    // 방파제와 부두는 선으로 그린 것과 면으로 그린 것이 섞여 있다.
    const points = closed ? simplifyRing(line, STRUCTURE_TOLERANCE) : simplify(line, STRUCTURE_TOLERANCE);
    structures.push({ kind: tags.man_made, closed, points: points.map(([lon, lat]) => [round(lon), round(lat)]) });
  } else if (tags.bridge && line) {
    bridgeWays.push({ nodes: element.nodes, line, tags });
  } else if (tags.landuse && closed) {
    if (area(line) < MIN_URBAN_AREA) continue;
    urban.push(simplifyRing(line).map(([lon, lat]) => [round(lon), round(lat)]));
  }
}

// ---- 다리: 조각을 이어 붙이고, 바다를 건너는 것만 남긴다 ----
// OpenStreetMap에서 다리 하나는 속성이 바뀌는 지점마다 여러 조각으로 나뉘어 있다. 끝점을 공유하는 조각을 이어서 하나로 만든다.
const landRings = JSON.parse(readFileSync(LAND, 'utf8')).geometry.coordinates.map(([ring]) => {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return { ring, minLon, maxLon, minLat, maxLat };
});

function isLand(lon, lat) {
  for (const { ring, minLon, maxLon, minLat, maxLat } of landRings) {
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

const distance = (a, b) => {
  const [ax, ay] = toMeters(a);
  const [bx, by] = toMeters(b);
  return Math.hypot(bx - ax, by - ay);
};

const unused = new Set(bridgeWays);
const bridges = [];
while (unused.size) {
  const first = unused.values().next().value;
  unused.delete(first);
  let nodes = [...first.nodes];
  let line = [...first.line];
  const tagList = [first.tags];
  // 앞쪽과 뒤쪽으로 번갈아 가면서, 끝점이 같은 조각이 없을 때까지 잇는다. 방향이 반대인 조각은 뒤집어서 붙인다.
  let extended = true;
  while (extended) {
    extended = false;
    for (const way of unused) {
      const start = way.nodes[0];
      const end = way.nodes.at(-1);
      if (start === nodes.at(-1)) {
        nodes = nodes.concat(way.nodes.slice(1));
        line = line.concat(way.line.slice(1));
      } else if (end === nodes.at(-1)) {
        nodes = nodes.concat([...way.nodes].reverse().slice(1));
        line = line.concat([...way.line].reverse().slice(1));
      } else if (end === nodes[0]) {
        nodes = way.nodes.slice(0, -1).concat(nodes);
        line = way.line.slice(0, -1).concat(line);
      } else if (start === nodes[0]) {
        nodes = [...way.nodes].reverse().slice(0, -1).concat(nodes);
        line = [...way.line].reverse().slice(0, -1).concat(line);
      } else {
        continue;
      }
      unused.delete(way);
      tagList.push(way.tags);
      extended = true;
    }
  }

  // 15m 간격으로 점을 찍어서, 물 위에 놓인 구간의 길이를 잰다.
  let length = 0;
  let waterSpan = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segment = distance(line[i], line[i + 1]);
    length += segment;
    const steps = Math.max(1, Math.round(segment / 15));
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps;
      const lon = line[i][0] + (line[i + 1][0] - line[i][0]) * t;
      const lat = line[i][1] + (line[i + 1][1] - line[i][1]) * t;
      if (!isLand(lon, lat)) waterSpan += segment / steps;
    }
  }
  if (waterSpan < MIN_WATER_SPAN) continue;

  const tag = (key) => tagList.map((tags) => tags[key]).find((value) => value !== undefined);
  const lanes = Math.max(...tagList.map((tags) => Number(tags.lanes) || 0));
  bridges.push({
    name: tag('bridge:name') ?? tag('name'),
    structure: tag('bridge:structure'),
    // 보행자용 다리는 3m로, 차도는 차로 하나를 3.5m로 잡고 양쪽의 갓길을 더한다. 차로의 수가 없으면 왕복 2차로로 본다.
    width: FOOTWAYS.includes(tag('highway')) ? 3 : (lanes || 2) * 3.5 + 3,
    clearance: TALL_STRUCTURES.includes(tag('bridge:structure'))
      ? TALL_BRIDGE_CLEARANCE
      : FOOTWAYS.includes(tag('highway'))
        ? FOOTBRIDGE_CLEARANCE
        : DEFAULT_CLEARANCE,
    length: Math.round(length),
    waterSpan: Math.round(waterSpan),
    points: simplify(line, STRUCTURE_TOLERANCE).map(([lon, lat]) => [round(lon), round(lat)]),
  });
}
bridges.sort((a, b) => b.length - a.length);

// 같은 섬이 점과 면으로 두 번 등록된 경우가 있으므로, 이름과 종류가 같으면 하나만 남긴다.
const seen = new Set();
const uniquePlaces = places.filter((place) => {
  const key = `${place.kind}/${place.name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ places: uniquePlaces, structures, bridges, urban }));

const kinds = uniquePlaces.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + 1 }), {});
console.log(`지명 ${uniquePlaces.length}개`, kinds);
console.log(`방파제와 부두 ${structures.length}개, 시가지 ${urban.length}개`);
console.log(`다리의 조각 ${bridgeWays.length}개 → 바다를 건너는 다리 ${bridges.length}개 → ${OUT}`);
for (const { name, length, waterSpan, structure, width } of bridges) {
  console.log(`  ${name ?? '(이름 없음)'}: 길이 ${length}m, 물 위 ${waterSpan}m, 폭 ${width}m${structure ? `, ${structure}` : ''}`);
}
