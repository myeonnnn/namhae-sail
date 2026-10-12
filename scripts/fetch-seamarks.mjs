// OpenStreetMap에서 남해 범위의 등대, 등표, 부표를 내려받아서 public/data/seamarks.json으로 저장한다.
// 실행: node scripts/fetch-seamarks.mjs
// 자료의 라이선스는 ODbL이며, 화면에 "© OpenStreetMap contributors"를 표기해야 한다.
// Overpass API는 공용 서버이므로 실행 중에 요청하지 않고, 이 스크립트로 한 번만 받아서 정적 파일로 사용한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/seamarks.json');
// 남, 서, 북, 동의 순서
const BOUNDS = [33.0, 125.0, 35.5, 129.5];
// 공용 서버는 혼잡할 때 요청을 거절하므로, 순서대로 시도한다.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const QUERY = `
[out:json][timeout:120];
(
  node["seamark:type"~"^(light_major|light_minor|beacon_.*|buoy_.*)$"](${BOUNDS.join(',')});
  node["man_made"="lighthouse"](${BOUNDS.join(',')});
);
out body;`;

/** seamark:type을 화면에 표시하는 세 가지 종류로 묶는다. */
function kindOf(tags) {
  const type = tags['seamark:type'] ?? '';
  if (type.startsWith('buoy_')) return 'buoy';
  if (type.startsWith('beacon_')) return 'beacon';
  if (type === 'light_major' || type === 'light_minor' || tags['man_made'] === 'lighthouse') return 'light';
  return null;
}

/** 여러 색상이 "black;yellow"처럼 나열된 경우에는 검은색이 아닌 첫 번째 색상을 대표로 삼는다. */
function primaryColour(value) {
  if (!value) return undefined;
  const colours = value.split(';').map((c) => c.trim().toLowerCase());
  return colours.find((c) => c !== 'black') ?? colours[0];
}

function tagWithPrefix(tags, suffix) {
  const key = Object.keys(tags).find((k) => k.startsWith('seamark:') && k.endsWith(suffix));
  return key ? tags[key] : undefined;
}

async function request() {
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'namhae-sail (seamark preprocessing)',
        },
        body: `data=${encodeURIComponent(QUERY)}`,
      });
      if (response.ok) return await response.json();
      console.warn(`${endpoint}: HTTP ${response.status}`);
    } catch (error) {
      console.warn(`${endpoint}: ${error.message}`);
    }
  }
  throw new Error('모든 Overpass 서버에서 요청이 실패했습니다. 잠시 후에 다시 실행하세요.');
}

const { elements } = await request();

const marks = [];
for (const { lat, lon, tags = {} } of elements) {
  const kind = kindOf(tags);
  if (!kind) continue;
  const type = tags['seamark:type'];
  const mark = {
    kind,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    colour: primaryColour(type ? tags[`seamark:${type}:colour`] : undefined),
    // 등화의 색상과 주기. 섹터등은 "seamark:light:1:colour"처럼 번호가 붙으므로 접미사로 찾는다.
    light: primaryColour(tags['seamark:light:colour'] ?? tagWithPrefix(tags, ':colour:light') ?? tags['seamark:light:1:colour']),
    period: Number(tags['seamark:light:period'] ?? tags['seamark:light:1:period']) || undefined,
    height: Number(tags['seamark:light:height'] ?? tags['height']) || undefined,
    name: tags['seamark:name'] ?? tags['name'],
  };
  marks.push(JSON.parse(JSON.stringify(mark)));
}

marks.sort((a, b) => a.lon - b.lon || a.lat - b.lat);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(marks));

const counts = marks.reduce((acc, m) => ({ ...acc, [m.kind]: (acc[m.kind] ?? 0) + 1 }), {});
console.log(`${marks.length}개의 해상 표지를 저장했습니다:`, counts, `→ ${OUT}`);
