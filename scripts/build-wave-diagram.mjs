// README에 넣는 파도 설명 그림(docs/wave-vertices.svg)을 생성한다.
// 수면을 옆에서 본 단면에서, 한 줄로 놓인 정점이 파도의 수식에 따라 움직이는 모습을 보여 준다.
// 실행: node scripts/build-wave-diagram.mjs
// GitHub의 README는 스크립트를 실행하지 않으므로, 움직임을 SVG의 애니메이션(SMIL)으로 미리 적어 넣는다.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/wave-vertices.svg');

const WIDTH = 720;
const LEFT = 40;
const RIGHT = 680;
const VERTEX_COUNT = 33;
const WAVELENGTH = (RIGHT - LEFT) / 3;
const AMPLITUDE = 22;
// 마루를 뾰족하게 만드는 수평 이동의 비율. 앱의 셰이더에서 uWaveMotion의 y 성분에 해당한다.
const STEEPNESS = 1;
// 한 주기를 나누는 장면의 수와 주기의 길이(초). 마지막 장면이 첫 장면과 같아서 끊김 없이 반복된다.
const FRAMES = 36;
const PERIOD = 3.6;
// 궤적을 따라가며 보여 줄 정점
const TRACKED = 14;

const ROWS = [
  { y: 100, horizontal: 0, title: '위아래로만 움직일 때', note: 'y += 진폭 × sin(위상)' },
  {
    y: 270,
    horizontal: STEEPNESS,
    title: '좌우로도 움직일 때 (Gerstner 파도)',
    note: 'x += 뾰족한 정도 × 진폭 × cos(위상)',
  },
];

const k = (Math.PI * 2) / WAVELENGTH;
const baseX = (i) => LEFT + ((RIGHT - LEFT) * i) / (VERTEX_COUNT - 1);
const round = (value) => value.toFixed(1);

/** 장면 f에서 정점 i가 옮겨진 위치 */
function displaced(row, i, f) {
  const theta = k * baseX(i) - (Math.PI * 2 * f) / FRAMES;
  return [baseX(i) + row.horizontal * AMPLITUDE * Math.cos(theta), row.y - AMPLITUDE * Math.sin(theta)];
}

const frames = Array.from({ length: FRAMES + 1 }, (_, f) => f);
const animate = (attribute, values) =>
  `<animate attributeName="${attribute}" dur="${PERIOD}s" repeatCount="indefinite" values="${values.join(';')}"/>`;

const parts = [];
for (const row of ROWS) {
  parts.push(`<text class="title" x="${LEFT}" y="${row.y - 52}">${row.title}</text>`);
  parts.push(`<text class="note" x="${RIGHT}" y="${row.y - 52}" text-anchor="end">${row.note}</text>`);
  parts.push(`<line class="rest" x1="${LEFT - 20}" y1="${row.y}" x2="${RIGHT + 20}" y2="${row.y}"/>`);

  // 정점을 잇는 선: 수면의 형태
  const outlines = frames.map(
    (f) => 'M' + Array.from({ length: VERTEX_COUNT }, (_, i) => displaced(row, i, f).map(round).join(',')).join(' L'),
  );
  parts.push(`<path class="surface" d="${outlines[0]}">${animate('d', outlines)}</path>`);

  // 추적하는 정점이 그리는 궤적: 위아래로만 움직이면 선분, 좌우로도 움직이면 원이 된다.
  const tx = baseX(TRACKED);
  parts.push(
    row.horizontal
      ? `<ellipse class="orbit" cx="${round(tx)}" cy="${row.y}" rx="${row.horizontal * AMPLITUDE}" ry="${AMPLITUDE}"/>`
      : `<line class="orbit" x1="${round(tx)}" y1="${row.y - AMPLITUDE}" x2="${round(tx)}" y2="${row.y + AMPLITUDE}"/>`,
  );

  for (let i = 0; i < VERTEX_COUNT; i++) {
    const path = frames.map((f) => displaced(row, i, f));
    const kind = i === TRACKED ? 'tracked' : 'moved';
    parts.push(`<circle class="base" cx="${round(baseX(i))}" cy="${row.y}" r="2.2"/>`);
    parts.push(
      `<circle class="${kind}" cx="${round(path[0][0])}" cy="${round(path[0][1])}" r="${i === TRACKED ? 5 : 3}">` +
        animate(
          'cx',
          path.map(([x]) => round(x)),
        ) +
        animate(
          'cy',
          path.map(([, y]) => round(y)),
        ) +
        '</circle>',
    );
  }
}

const legendY = 345;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} 365" width="${WIDTH}" role="img" aria-labelledby="t d">
<title id="t">파도의 수식에 따라 움직이는 수면의 정점</title>
<desc id="d">수면을 옆에서 본 단면이다. 위쪽은 정점이 위아래로만 움직여서 둥근 사인파가 되고, 아래쪽은 좌우로도 움직여서 마루가 뾰족하고 골이 넓은 Gerstner 파도가 된다. 정점 하나의 궤적은 위쪽에서는 선분, 아래쪽에서는 원이다.</desc>
<style>
  text { font-family: system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; fill: #3d3d3a; }
  .title { font-size: 14px; font-weight: 600; }
  .note { font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: #73726c; }
  .legend { font-size: 12px; fill: #73726c; }
  .rest { stroke: #b4b2a9; stroke-width: 0.75; stroke-dasharray: 3 4; }
  .surface { fill: none; stroke: #378add; stroke-width: 1.5; stroke-linejoin: round; }
  .orbit { fill: none; stroke: #d85a30; stroke-width: 1; stroke-dasharray: 2 3; }
  .base { fill: none; stroke: #b4b2a9; stroke-width: 1; }
  .moved { fill: #378add; }
  .tracked { fill: #d85a30; }
  @media (prefers-color-scheme: dark) {
    text { fill: #e6e4dc; }
    .note, .legend { fill: #a3a199; }
    .rest, .base { stroke: #6b6a65; }
  }
</style>
${parts.join('\n')}
<circle class="base" cx="${LEFT + 4}" cy="${legendY - 4}" r="3.5"/><text class="legend" x="${LEFT + 14}" y="${legendY}">격자의 원래 위치</text>
<circle class="moved" cx="${LEFT + 134}" cy="${legendY - 4}" r="3.5"/><text class="legend" x="${LEFT + 144}" y="${legendY}">셰이더가 옮긴 위치</text>
<circle class="tracked" cx="${LEFT + 278}" cy="${legendY - 4}" r="4"/><text class="legend" x="${LEFT + 289}" y="${legendY}">정점 하나와 그 궤적</text>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`${OUT} (${(svg.length / 1024).toFixed(1)} KB)`);
