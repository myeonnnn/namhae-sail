// OpenStreetMap에서 운영 구역(src/geo/region.json)의 등대, 등표, 부표를 내려받아서 public/data/seamarks.json으로 저장한다.
// 실행: node scripts/fetch-seamarks.mjs
// 자료의 라이선스는 ODbL이며, 화면에 "© OpenStreetMap contributors"를 표기해야 한다.
// Overpass API는 공용 서버이므로 실행 중에 요청하지 않고, 이 스크립트로 한 번만 받아서 정적 파일로 사용한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { queryOverpass } from './lib/overpass.mjs';
import { DATA_BBOX, ROOT } from './lib/region.mjs';

const OUT = resolve(ROOT, 'public/data/seamarks.json');

// 구역의 경계 바로 바깥에 있는 표지도 화면에 보이므로, 자료의 여유 범위까지 받는다.
const QUERY = `
[out:json][timeout:120];
(
  node["seamark:type"~"^(light_major|light_minor|beacon_.*|buoy_.*)$"](${DATA_BBOX});
  node["man_made"="lighthouse"](${DATA_BBOX});
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

const { elements } = await queryOverpass(QUERY, { purpose: 'seamark preprocessing' });

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
