// 스포츠 크루저 요트(약 15m)의 GLB 모델을 절차적으로 생성한다.
// 실행: node scripts/build-yacht.mjs
// 규약: 단위는 m, 원점은 선체 바닥의 중앙, 선수는 -Z, 우현은 +X이다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/models/yacht/sport-yacht.glb');

// ---- GLTFExporter가 사용하는 브라우저 API를 Node에서 대신 제공한다 ----
function encodePng(width, height, rgba) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    // 세로 방향으로 비슷한 무늬가 이어지므로 Up 필터(2)를 사용해서 압축률을 높인다.
    raw[y * stride] = 2;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const above = y > 0 ? rgba[((y - 1) * width + x) * 4 + c] : 0;
        raw[y * stride + 1 + x * 3 + c] = (rgba[(y * width + x) * 4 + c] - above) & 0xff;
      }
    }
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};
globalThis.ImageData = class {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
};
globalThis.OffscreenCanvas = class {
  getContext() {
    return {
      translate() {},
      scale() {},
      putImageData: (image) => (this.image = image),
    };
  }
  async convertToBlob({ type }) {
    return new Blob([encodePng(this.image.width, this.image.height, this.image.data)], { type });
  }
};

// ---- 수학 보조 함수 ----
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const along = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 티크 갑판 텍스처: 판재, 코킹 선, 나뭇결을 절차적으로 그린다 ----
const TEAK_TILE_WIDTH = 0.48; // 텍스처 한 장이 덮는 폭 (m). 판재 8장에 해당한다.
const TEAK_TILE_LENGTH = 1.6;

function createTeakTexture() {
  const SIZE = 512;
  const PLANK = 64;
  const CAULK = 4;
  const random = mulberry32(11);
  const planks = Array.from({ length: SIZE / PLANK }, () => ({
    tone: 0.9 + random() * 0.18,
    joint: Math.floor(random() * SIZE),
    phase: random() * 6.28,
  }));
  const fibre = Array.from({ length: SIZE }, () => random() - 0.5);
  const data = new Uint8Array(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    const wave = (2 * Math.PI * y) / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const plank = planks[Math.floor(x / PLANK)];
      const inPlank = x % PLANK;
      const jointDistance = Math.min(Math.abs(y - plank.joint), SIZE - Math.abs(y - plank.joint));
      let rgb = [30, 26, 23];
      if (inPlank >= CAULK && jointDistance >= 2) {
        const grain =
          0.05 * Math.sin(x * 1.9 + 2.2 * Math.sin(wave + plank.phase)) +
          0.035 * Math.sin(x * 0.71 + plank.phase * 3 + 1.6 * Math.sin(2 * wave + plank.phase)) +
          0.05 * fibre[x];
        const edge = inPlank < CAULK + 2 || inPlank > PLANK - 3 ? 0.92 : 1;
        const shade = plank.tone * (1 + grain) * edge;
        rgb = [186 * shade, 142 * shade, 96 * shade];
      }
      const index = (y * SIZE + x) * 4;
      data[index] = Math.min(255, rgb[0]);
      data[index + 1] = Math.min(255, rgb[1]);
      data[index + 2] = Math.min(255, rgb[2]);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.name = 'teak-deck';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// ---- 재질 ----
// 겔코트와 선체 도장은 클리어코트로 광택을 표현하고, 금속과 유리는 환경 맵이 없는 장면에서도 지나치게 어둡지 않도록 조정했다.
const gelcoat = (name, color, roughness = 0.3) =>
  new THREE.MeshPhysicalMaterial({ name, color, roughness, clearcoat: 1, clearcoatRoughness: 0.06 });

const MATERIALS = {
  white: gelcoat('gelcoat-white', 0xf4f4f1),
  black: new THREE.MeshPhysicalMaterial({ name: 'hull-navy', color: 0x070b14, roughness: 0.1, ior: 2.0, clearcoat: 1, clearcoatRoughness: 0.03 }),
  antifoul: new THREE.MeshStandardMaterial({ name: 'antifoul', color: 0x121c2e, roughness: 0.85 }),
  deck: new THREE.MeshStandardMaterial({ name: 'deck-nonskid', color: 0xdcddd8, roughness: 0.95 }),
  glass: new THREE.MeshPhysicalMaterial({ name: 'glass-tinted', color: 0x05080b, roughness: 0.03, ior: 2.0 }),
  teak: new THREE.MeshStandardMaterial({ name: 'teak', color: 0xffffff, roughness: 0.8, map: createTeakTexture() }),
  cream: new THREE.MeshStandardMaterial({ name: 'upholstery', color: 0xd8cbb2, roughness: 0.92 }),
  steel: new THREE.MeshStandardMaterial({ name: 'stainless', color: 0xb4bac0, roughness: 0.22, metalness: 0.92 }),
  rubber: new THREE.MeshStandardMaterial({ name: 'rubber', color: 0x0d0d0e, roughness: 0.9 }),
  plastic: new THREE.MeshStandardMaterial({ name: 'plastic-white', color: 0xeeeeec, roughness: 0.5 }),
  lampWhite: new THREE.MeshStandardMaterial({ name: 'lamp-white', color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.6 }),
  lampRed: new THREE.MeshStandardMaterial({ name: 'lamp-port', color: 0xd01818, emissive: 0xff1a10, emissiveIntensity: 0.8 }),
  lampGreen: new THREE.MeshStandardMaterial({ name: 'lamp-starboard', color: 0x12a548, emissive: 0x10ff60, emissiveIntensity: 0.8 }),
};

// ---- 재질별로 삼각형을 모으는 버킷 ----
const buckets = {};
const bucket = (key) => (buckets[key] ??= { pos: [], nor: [] });

function pushTriangle(key, points, normals, mirror) {
  const face = cross(sub(points[1], points[0]), sub(points[2], points[0]));
  const area = Math.hypot(face[0], face[1], face[2]);
  if (!(area > 1e-10)) return;
  const fallback = [face[0] / area, face[1] / area, face[2] / area];
  const b = bucket(key);
  const used = normals.map((n) => (Math.hypot(n[0], n[1], n[2]) > 0.5 ? n : fallback));
  for (let k = 0; k < 3; k++) {
    b.pos.push(...points[k]);
    b.nor.push(...used[k]);
  }
  if (!mirror) return;
  for (const k of [0, 2, 1]) {
    b.pos.push(-points[k][0], points[k][1], points[k][2]);
    b.nor.push(-used[k][0], used[k][1], used[k][2]);
  }
}

/** 볼록 다각형을 높이 y의 수평면으로 잘라서 아래쪽 또는 위쪽 부분만 남긴다. */
function clipPolygon(polygon, y, keepBelow) {
  const inside = (vertex) => (keepBelow ? vertex.p[1] <= y : vertex.p[1] >= y);
  const result = [];
  polygon.forEach((a, k) => {
    const b = polygon[(k + 1) % polygon.length];
    if (inside(a)) result.push(a);
    if (inside(a) !== inside(b)) {
      const f = (y - a.p[1]) / (b.p[1] - a.p[1]);
      result.push({
        p: a.p.map((value, axis) => lerp(value, b.p[axis], f)),
        n: unit(a.n.map((value, axis) => lerp(value, b.n[axis], f))),
      });
    }
  });
  return result;
}

/**
 * 삼각형 하나를 버킷에 기록한다. spec이 문자열이면 그 재질을 그대로 사용하고,
 * { bands: [[높이 상한, 재질], ...] }이면 높이에 따라서 삼각형을 잘라 도장 경계선을 만든다.
 */
function emit(spec, points, normals, mirror) {
  if (typeof spec === 'string') return pushTriangle(spec, points, normals, mirror);
  let rest = points.map((p, k) => ({ p, n: normals[k] }));
  for (const [limit, key] of spec.bands) {
    const part = Number.isFinite(limit) ? clipPolygon(rest, limit, true) : rest;
    for (let k = 1; k < part.length - 1; k++) {
      const tri = [part[0], part[k], part[k + 1]];
      pushTriangle(key, tri.map((v) => v.p), tri.map((v) => v.n), mirror);
    }
    if (!Number.isFinite(limit)) return;
    rest = clipPolygon(rest, limit, false);
    if (rest.length < 3) return;
  }
}

/**
 * 단면(row)을 길이 방향(station)으로 이어서 곡면을 만든다. 우현 쪽 절반만 정의하면 좌현은 대칭으로 생성한다.
 * outward는 면의 바깥 방향을 추정하는 함수이고, 면의 방향이 반대로 계산되었으면 뒤집는 데에 사용한다.
 * normal을 제공하면 계산된 법선을 대신해서 그 값을 정점 법선으로 사용한다.
 */
function loft({ stations, rows, point, mat, outward, normal, flat = false, mirror = true }) {
  const grid = [];
  for (let i = 0; i < stations; i++) for (let j = 0; j < rows; j++) grid.push(point(i, j));

  const indices = [];
  const cells = [];
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b = (i + 1) * rows + j;
      const c = (i + 1) * rows + j + 1;
      const d = i * rows + j + 1;
      indices.push(a, b, c, a, c, d);
      cells.push(mat(i, j));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(grid.flat(), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const attribute = geometry.getAttribute('normal');
  const computed = grid.map((_, n) => [attribute.getX(n), attribute.getY(n), attribute.getZ(n)]);

  let facing = 0;
  let normals = computed;
  if (normal) {
    normals = [];
    for (let i = 0; i < stations; i++) for (let j = 0; j < rows; j++) normals.push(normal(i, j));
    grid.forEach((_, n) => (facing += dot(computed[n], normals[n])));
  } else {
    grid.forEach((p, n) => (facing += dot(computed[n], outward(p, Math.floor(n / rows), n % rows))));
  }
  const flip = facing < 0;
  if (!normal && flip) normals = computed.map((n) => [-n[0], -n[1], -n[2]]);

  // 중심선 위의 법선은 좌우 대칭이 되도록 X 성분을 제거한다.
  normals = normals.map((n, index) => (mirror && Math.abs(grid[index][0]) < 1e-4 ? unit([0, n[1], n[2]]) : n));

  for (let f = 0; f < indices.length; f += 3) {
    const tri = flip
      ? [indices[f], indices[f + 2], indices[f + 1]]
      : [indices[f], indices[f + 1], indices[f + 2]];
    const points = tri.map((n) => grid[n]);
    let triNormals = tri.map((n) => normals[n]);
    if (flat) {
      const face = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
      triNormals = [face, face, face];
    }
    emit(cells[Math.floor(f / 6)], points, triNormals, mirror);
  }
}

/** 한 평면 위에 놓인 절반 단면을 중심점에서 부채꼴로 채운다. */
function capFan(spec, center, halfSection, normal) {
  for (let j = 0; j < halfSection.length - 1; j++) {
    emit(spec, [center, halfSection[j], halfSection[j + 1]], [normal, normal, normal], true);
  }
}

/** 사각형 하나를 facing 방향을 향하도록 추가한다. */
function addQuad(key, a, b, c, d, facing, mirror = false) {
  let n = unit(cross(sub(b, a), sub(c, a)));
  let order = [a, b, c, d];
  if (dot(n, facing) < 0) {
    n = [-n[0], -n[1], -n[2]];
    order = [a, d, c, b];
  }
  pushTriangle(key, [order[0], order[1], order[2]], [n, n, n], mirror);
  pushTriangle(key, [order[0], order[2], order[3]], [n, n, n], mirror);
}

/** Three.js의 도형을 변환해서 버킷에 추가한다. */
function addShape(key, geometry, matrix, { mirror = false } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (matrix) g.applyMatrix4(matrix);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  for (let f = 0; f < pos.count; f += 3) {
    const read = (attribute) => [0, 1, 2].map((k) => [attribute.getX(f + k), attribute.getY(f + k), attribute.getZ(f + k)]);
    pushTriangle(key, read(pos), read(nor), mirror);
  }
}

const place = (x, y, z, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );

const box = (key, w, h, d, x, y, z, options) => addShape(key, new THREE.BoxGeometry(w, h, d), place(x, y, z, options), options);
const roundBox = (key, w, h, d, radius, x, y, z, options) =>
  addShape(key, new RoundedBoxGeometry(w, h, d, 3, radius), place(x, y, z, options), options);

/** 두 점을 잇는 원기둥 막대를 추가한다. */
function addRod(key, from, to, radiusFrom, radiusTo = radiusFrom, options) {
  const a = vec(from);
  const b = vec(to);
  const direction = b.clone().sub(a);
  const length = direction.length();
  const matrix = new THREE.Matrix4().compose(
    a.clone().add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  addShape(key, new THREE.CylinderGeometry(radiusTo, radiusFrom, length, 10), matrix, options);
}

/** 여러 점을 부드럽게 지나는 관을 추가한다. */
function addTube(key, points, radius, { mirror = false, segments = points.length * 4 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(vec), false, 'centripetal');
  addShape(key, new THREE.TubeGeometry(curve, segments, radius, 8), undefined, { mirror });
}

/** 곡면 함수의 법선을 수치 미분으로 구한다. ref는 바깥쪽을 가리키는 대략적인 방향이다. */
function surfaceNormal(surface, ref, t, v) {
  const e = 1e-3;
  const dt = sub(surface(t + e, v), surface(t - e, v));
  const dv = sub(surface(t, Math.min(1, v + e)), surface(t, Math.max(0, v - e)));
  const n = unit(cross(dt, dv));
  return dot(n, ref(surface(t, v))) < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/**
 * 곡면 위에 밀착된 얇은 조각(창유리, 프레임 등)을 만든다.
 * t의 범위와 그 안에서의 v 하한/상한 함수로 조각의 윤곽을 정의하고, 곡면에서 offset만큼 띄워서 배치한다.
 */
function patch({ key, surface, ref, t0, t1, lo, hi, offset, nt = 20, nv = 6, mirror = true }) {
  const tAt = (i) => lerp(t0, t1, 0.5 - 0.5 * Math.cos((Math.PI * i) / nt));
  const vAt = (i, j) => lerp(lo(tAt(i)), hi(tAt(i)), j / nv);
  loft({
    stations: nt + 1,
    rows: nv + 1,
    point: (i, j) => along(surface(tAt(i), vAt(i, j)), surfaceNormal(surface, ref, tAt(i), vAt(i, j)), offset),
    normal: (i, j) => surfaceNormal(surface, ref, tAt(i), vAt(i, j)),
    mat: () => key,
    mirror,
  });
}

/** 모서리가 둥근 사각형 윤곽 (t-v 평면)의 하한/상한 함수를 만든다. */
function roundedBand(t0, t1, v0, v1, rt, rv, { roundLo = true, roundHi = true } = {}) {
  const inset = (t) => {
    const s = clamp01(Math.min(t - t0, t1 - t) / rt);
    return rv * (1 - Math.sqrt(1 - (1 - s) ** 2));
  };
  return { t0, t1, lo: (t) => v0 + (roundLo ? inset(t) : 0), hi: (t) => v1 - (roundHi ? inset(t) : 0) };
}

/** 타원 윤곽 (t-v 평면)의 하한/상한 함수를 만든다. */
function ellipseBand(tc, vc, at, av) {
  const half = (t) => av * Math.sqrt(Math.max(0, 1 - ((t - tc) / at) ** 2));
  return { t0: tc - at, t1: tc + at, lo: (t) => vc - half(t), hi: (t) => vc + half(t) };
}

// =====================================================================
// 선체. t는 선미(0)에서 선수(1)까지의 위치이다.
// =====================================================================
const L = 14.2; // 선체 길이 (수영 플랫폼 제외)
const HALF_BEAM = 2.14;
const DRAFT = 0.75;
const PAINT_LINE = DRAFT + 0.06; // 방오 도료의 상단

const zAt = (t) => L / 2 - t * L;
const sheerY = (t) => 2.0 + 0.62 * Math.pow(clamp01(t), 1.7);
const sheerX = (t) => {
  const tc = clamp01(t);
  const taper = clamp01((tc - 0.32) / 0.68);
  const stern = 1 - 0.07 * Math.pow(1 - clamp01(tc / 0.3), 2);
  return Math.max(0.015, HALF_BEAM * stern * (1 - taper * taper));
};
const keelY = (t) => (sheerY(1) - 0.03) * Math.pow(clamp01((t - 0.55) / 0.45), 2.5);
const chineX = (t) => sheerX(t) * lerp(0.9, 0.6, smooth(clamp01((t - 0.4) / 0.6)));
const chineY = (t) => lerp(keelY(t), sheerY(t), 0.3);
const bottomPoint = (t, u) => [chineX(t) * u, lerp(keelY(t), chineY(t), u), zAt(t)];
// 선수 쪽으로 갈수록 현측이 바깥으로 벌어지는 플레어를 준다.
const topsidePoint = (t, u) => {
  const flare = lerp(0.75, 1.45, smooth(clamp01((t - 0.45) / 0.5)));
  return [lerp(chineX(t), sheerX(t), Math.pow(clamp01(u), flare)), lerp(chineY(t), sheerY(t), u), zAt(t)];
};
const hullRef = () => [1, 0, 0];

const HULL_STATIONS = 81;
const tHull = (i) => i / (HULL_STATIONS - 1);
const painted = (above) => ({ bands: [[PAINT_LINE, 'antifoul'], [Infinity, above]] });

loft({
  stations: HULL_STATIONS,
  rows: 6,
  point: (i, j) => bottomPoint(tHull(i), j / 5),
  mat: () => painted('white'),
  outward: () => [0.3, -1, 0],
});

// 현측은 아래에서부터 흰색 띠, 검은색 띠, 흰색 띠의 순서로 나눈다.
const TOPSIDE_ROWS = [0, 0.06, 0.12, 0.18, 0.25, 0.33, 0.41, 0.49, 0.57, 0.65, 0.73, 0.79, 0.84, 0.89, 0.95, 1];
const BLACK_BAND = [0.25, 0.84];
loft({
  stations: HULL_STATIONS,
  rows: TOPSIDE_ROWS.length,
  point: (i, j) => topsidePoint(tHull(i), TOPSIDE_ROWS[j]),
  mat: (_, j) => {
    const u = (TOPSIDE_ROWS[j] + TOPSIDE_ROWS[j + 1]) / 2;
    return u > BLACK_BAND[0] && u < BLACK_BAND[1] ? 'black' : painted('white');
  },
  outward: (p) => [p[0], p[1] - 1.2, 0],
});

const transomSection = [
  ...[0, 0.25, 0.5, 0.75].map((u) => bottomPoint(0, u)),
  ...TOPSIDE_ROWS.map((u) => topsidePoint(0, u)),
  [0, sheerY(0), zAt(0)],
];
const transomBand = BLACK_BAND.map((u) => topsidePoint(0, u)[1]);
capFan(
  { bands: [[PAINT_LINE, 'antifoul'], [transomBand[0], 'white'], [transomBand[1], 'black'], [Infinity, 'white']] },
  [0, 1.0, zAt(0)],
  transomSection,
  [0, 0, 1],
);

// 선저의 스프레이 레일
for (const u of [0.42, 0.74]) {
  const points = [];
  for (let k = 0; k <= 24; k++) points.push(along(bottomPoint(lerp(0.03, 0.72, k / 24), u), [0, -1, 0], 0.005));
  addTube('antifoul', points, 0.03, { mirror: true });
}

// 선체의 현창: 유리와 스테인리스 테두리를 현측 곡면 위에 얹는다.
function hullWindow(tc, halfLength, halfHeight) {
  const height = sheerY(tc) - chineY(tc);
  const at = halfLength / L;
  const av = halfHeight / height;
  const uc = 0.53;
  const common = { surface: topsidePoint, ref: hullRef, nt: 24, nv: 8 };
  patch({ key: 'steel', ...common, ...ellipseBand(tc, uc, at + 0.028 / L, av + 0.028 / height), offset: 0.006 });
  patch({ key: 'glass', ...common, ...ellipseBand(tc, uc, at, av), offset: 0.012 });
}
for (const tc of [0.385, 0.455, 0.525, 0.595]) hullWindow(tc, 0.27, 0.105);
hullWindow(0.69, 0.42, 0.095);

// =====================================================================
// 갑판, 토 레일, 러브 레일
// =====================================================================
const deckEdgeX = (t) => Math.max(sheerX(t) - 0.07, 0.001);
const deckY = (t, x) => sheerY(t) - 0.07 + 0.04 * (1 - clamp01(x / deckEdgeX(t)) ** 2);

const COCKPIT_AFT = 0.085; // 콕핏이 시작되는 위치 (t)
const CABIN_AFT = 0.22; // 선실의 뒤쪽 격벽 위치 (t)
const HOUSE_WIDTH = 1.62; // 상부 구조물의 최대 반폭
const WELL_HALF_WIDTH = HOUSE_WIDTH - 0.24; // 콕핏 바닥의 반폭
const FLOOR_Y = 1.45; // 콕핏 바닥의 높이

function deckPiece(tFrom, tTo, stations, innerX) {
  loft({
    stations,
    rows: 6,
    point: (i, j) => {
      const t = lerp(tFrom, tTo, i / (stations - 1));
      const x = lerp(Math.min(innerX, deckEdgeX(t)), deckEdgeX(t), j / 5);
      return [x, deckY(t, x), zAt(t)];
    },
    mat: () => 'deck',
    outward: () => [0, 1, 0],
  });
}
deckPiece(0, COCKPIT_AFT, 6, 0);
deckPiece(COCKPIT_AFT, CABIN_AFT, 10, HOUSE_WIDTH - 0.06);
deckPiece(CABIN_AFT, 1, 64, 0);

// 갑판 가장자리의 토 레일
loft({
  stations: HULL_STATIONS,
  rows: 4,
  point: (i, j) => {
    const t = tHull(i);
    const b = sheerX(t);
    const section = [
      [b, sheerY(t)],
      [b - 0.012, sheerY(t) + 0.035],
      [b - 0.058, sheerY(t) + 0.035],
      [b - 0.072, sheerY(t) - 0.075],
    ][j];
    return [Math.max(section[0], 0), section[1], zAt(t)];
  },
  mat: () => 'white',
  outward: () => [0.2, 1, 0],
});
roundBox('white', sheerX(0) * 2 - 0.04, 0.11, 0.07, 0.02, 0, sheerY(0) - 0.02, zAt(0) - 0.036);

// 현측 상단을 따라서 두르는 스테인리스 러브 레일
{
  const points = [];
  for (let k = 0; k <= 60; k++) {
    const t = lerp(0, 0.997, k / 60);
    points.push([sheerX(t) + 0.012, sheerY(t) - 0.06, zAt(t)]);
  }
  addTube('steel', points, 0.022, { mirror: true });
}

// =====================================================================
// 상부 구조물 (선실, 하드톱)
// =====================================================================
// 지붕의 높이 (갑판 기준). 뒤쪽부터 하드톱, 전면 유리, 선수 쪽의 낮은 트렁크의 순서이다.
const ROOF_KEYS = [
  [0.1, 1.18],
  [0.14, 1.22],
  [0.22, 1.32],
  [0.3, 1.36],
  [0.42, 1.33],
  [0.455, 1.24],
  [0.59, 0.46],
  [0.72, 0.34],
  [0.8, 0.22],
  [0.85, 0.12],
  [0.9, 0.12],
];
const roofLinear = (t) => {
  const tc = Math.min(Math.max(t, ROOF_KEYS[0][0]), ROOF_KEYS.at(-1)[0]);
  const k = Math.max(1, ROOF_KEYS.findIndex(([key]) => key >= tc));
  const [t0, r0] = ROOF_KEYS[k - 1];
  const [t1, r1] = ROOF_KEYS[k];
  return lerp(r0, r1, (tc - t0) / (t1 - t0));
};
// 꺾이는 부분이 날카롭지 않도록 주변의 값을 평균해서 둥글린다.
const roofHeight = (t) => {
  let sum = 0;
  for (let k = -3; k <= 3; k++) sum += roofLinear(t + k * 0.004);
  return sum / 7;
};

const houseBaseY = (t) => sheerY(t) - 0.09;
const houseHalfWidth = (t) => {
  const nose = clamp01((t - 0.6) / 0.25);
  return Math.max(0.001, Math.min(sheerX(t) - 0.42, HOUSE_WIDTH) * Math.sqrt(Math.max(0, 1 - Math.pow(nose, 2.4))));
};

/**
 * 상부 구조물의 곡면. 단면은 초타원이고, v가 0.5 이하이면 옆벽을 높이 비율로, 0.5 이상이면 지붕을 폭 비율로 지난다.
 * 따라서 v가 일정한 선은 옆벽에서는 수평선이 되고, 지붕에서는 앞뒤로 이어지는 선이 된다.
 */
function housePoint(t, v) {
  const n = lerp(4.2, 2.6, smooth(clamp01((t - 0.56) / 0.16)));
  const corner = Math.pow(0.5, 1 / n);
  let xx;
  let yy;
  if (v <= 0.5) {
    yy = corner * 2 * Math.max(v, 0);
    xx = Math.pow(1 - Math.pow(yy, n), 1 / n);
  } else {
    xx = corner * 2 * (1 - Math.min(v, 1));
    yy = Math.pow(1 - Math.pow(xx, n), 1 / n);
  }
  const roof = roofHeight(t);
  const lean = 0.12 * clamp01(roof / 1.2);
  return [houseHalfWidth(t) * xx * (1 - lean * yy), houseBaseY(t) + (roof + 0.04) * yy, zAt(t)];
}
const houseRef = (p) => [p[0], p[1] - 0.5, 0];
const houseNormal = (t, v) => surfaceNormal(housePoint, houseRef, t, v);
const onHouse = (t, v, offset = 0) => along(housePoint(t, v), houseNormal(t, v), offset);

// 선실 본체
const cabinT = [];
for (let t = CABIN_AFT; t < 0.7999; t += 0.0058) cabinT.push(t);
for (let k = 8; k >= 0; k--) cabinT.push(0.6 + 0.25 * (1 - 0.2 * (k / 8) ** 2));
const CABIN_ROWS = 41;
loft({
  stations: cabinT.length,
  rows: CABIN_ROWS,
  point: (i, j) => housePoint(cabinT[i], j / (CABIN_ROWS - 1)),
  mat: () => 'white',
  outward: (p) => [p[0], p[1] - 2.0, 0],
});

// 선실의 뒤쪽 격벽과 유리문
const zBulkhead = zAt(CABIN_AFT);
{
  const section = Array.from({ length: CABIN_ROWS }, (_, j) => housePoint(CABIN_AFT, j / (CABIN_ROWS - 1)));
  capFan('white', [0, houseBaseY(CABIN_AFT) + 0.8, zBulkhead], section, [0, 0, 1]);
  const top = houseBaseY(CABIN_AFT) + 0.02;
  addQuad('white', [-WELL_HALF_WIDTH, FLOOR_Y, zBulkhead], [WELL_HALF_WIDTH, FLOOR_Y, zBulkhead], [WELL_HALF_WIDTH, top, zBulkhead], [-WELL_HALF_WIDTH, top, zBulkhead], [0, 0, 1]);

  const doorHeight = 1.66;
  const doorY = FLOOR_Y + 0.05 + doorHeight / 2;
  box('glass', 2.0, doorHeight, 0.03, 0, doorY, zBulkhead + 0.025);
  for (const x of [-1.0, -0.34, 0.34, 1.0]) box('steel', 0.035, doorHeight + 0.03, 0.05, x, doorY, zBulkhead + 0.03);
  for (const dy of [-doorHeight / 2, doorHeight / 2]) box('steel', 2.03, 0.035, 0.05, 0, doorY + dy, zBulkhead + 0.03);
  box('steel', 0.02, 0.22, 0.03, 0.29, doorY, zBulkhead + 0.06);
}

// 하드톱의 뒤쪽 연장부와 그것을 받치는 기둥. 두께가 있는 껍질로 만든다.
{
  const T0 = 0.14;
  const STATIONS = 21;
  const NV = 26;
  const THICKNESS = 0.07;
  const tAt = (i) => lerp(T0, CABIN_AFT + 0.004, i / (STATIONS - 1));
  // 옆벽이 잘려 올라가는 높이. 격벽에서는 갑판까지 내려오고, 뒤로 갈수록 지붕 쪽으로 올라간다.
  const lowerEdge = (t) => 0.56 * smooth(clamp01((CABIN_AFT - t) / (CABIN_AFT - T0)));
  const shellPoint = (i, j) => {
    const t = tAt(i);
    if (j <= NV) return housePoint(t, lerp(lowerEdge(t), 1, j / NV));
    if (j <= 2 * NV + 1) return onHouse(t, lerp(1, lowerEdge(t), (j - NV - 1) / NV), -THICKNESS);
    return housePoint(t, lowerEdge(t));
  };
  loft({
    stations: STATIONS,
    rows: 2 * NV + 3,
    point: shellPoint,
    mat: () => 'white',
    outward: (p, _, j) => (j <= NV ? [p[0], p[1] - 1.5, 0] : [0, 0, 0]),
  });
  for (let j = 0; j < NV; j++) {
    addQuad('white', shellPoint(0, j), shellPoint(0, j + 1), shellPoint(0, 2 * NV - j), shellPoint(0, 2 * NV + 1 - j), [0, 0, 1], true);
  }
}

// 창유리. 선실 곡면 위에 살짝 띄워서 붙인다.
const GLASS_OFFSET = 0.012;
const houseSurface = { surface: housePoint, ref: houseRef };
const BELT = 0.27; // 창의 아래쪽 경계 (옆벽의 높이 비율)
const glazing = [
  // 전면 유리: 가운데 창과 옆으로 감아 도는 좌우 창
  { ...roundedBand(0.463, 0.584, 0.815, 1, 0.012, 0.03, { roundHi: false }), nt: 20, nv: 8 },
  { ...roundedBand(0.463, 0.584, BELT, 0.797, 0.014, 0.05), nt: 24, nv: 22 },
  // 측면 창
  { ...roundedBand(0.352, 0.449, BELT, 0.47, 0.014, 0.05), nt: 22, nv: 8 },
  {
    t0: 0.238,
    t1: 0.341,
    lo: (t) => lerp(0.455, BELT, smooth(clamp01((t - 0.238) / 0.075))) + roundedBand(0.238, 0.341, 0, 1, 0.012, 0.04).lo(t) * (t > 0.3 ? 1 : 0),
    hi: (t) => 0.47 - roundedBand(0.238, 0.341, 0, 1, 0.012, 0.04).lo(t) * (t > 0.3 ? 1 : 0),
    nt: 26,
    nv: 8,
  },
  // 선루프 2장
  { ...roundedBand(0.272, 0.336, 0.75, 1, 0.01, 0.04, { roundHi: false }), nt: 16, nv: 8 },
  { ...roundedBand(0.344, 0.408, 0.75, 1, 0.01, 0.04, { roundHi: false }), nt: 16, nv: 8 },
];
for (const pane of glazing) patch({ key: 'glass', ...houseSurface, ...pane, offset: GLASS_OFFSET });

// 선수 트렁크 위의 해치: 스테인리스 테두리와 유리
for (const [t0, t1, v0] of [
  [0.652, 0.69, 0.86],
  [0.735, 0.768, 0.8],
]) {
  patch({ key: 'steel', ...houseSurface, ...roundedBand(t0 - 0.004, t1 + 0.004, v0 - 0.02, 1, 0.008, 0.03, { roundHi: false }), offset: 0.008, nt: 16, nv: 6 });
  patch({ key: 'glass', ...houseSurface, ...roundedBand(t0, t1, v0, 1, 0.006, 0.025, { roundHi: false }), offset: 0.016, nt: 16, nv: 6 });
}

// 와이퍼
addRod('rubber', onHouse(0.582, 1, 0.03), [0.16, onHouse(0.515, 0.97, 0.03)[1], onHouse(0.515, 0.97, 0.03)[2]], 0.009);
addRod('rubber', onHouse(0.582, 0.72, 0.03), onHouse(0.512, 0.63, 0.03), 0.009, 0.009, { mirror: true });

// 선수 트렁크의 손잡이 레일
{
  const points = [];
  for (let k = 0; k <= 16; k++) {
    const lift = 0.11 * Math.pow(Math.sin((Math.PI * k) / 16), 0.35);
    points.push(onHouse(lerp(0.615, 0.775, k / 16), 0.52, lift - 0.01));
  }
  addTube('steel', points, 0.014, { mirror: true });
  for (const t of [0.668, 0.722]) addRod('steel', onHouse(t, 0.52, 0), onHouse(t, 0.52, 0.1), 0.01, 0.01, { mirror: true });
}

// 항해등 (우현은 녹색, 좌현은 적색)
{
  const p = onHouse(0.5, 0.19, 0.02);
  for (const [side, lamp] of [
    [1, 'lampGreen'],
    [-1, 'lampRed'],
  ]) {
    box('rubber', 0.05, 0.075, 0.13, p[0] * side, p[1], p[2]);
    box(lamp, 0.03, 0.05, 0.09, (p[0] + 0.02) * side, p[1], p[2] - 0.01);
  }
}

// 지붕 앞쪽의 탐조등
{
  const p = housePoint(0.425, 1);
  addShape('steel', new THREE.CylinderGeometry(0.02, 0.025, 0.1, 10), place(0, p[1] + 0.04, p[2]));
  addShape('steel', new THREE.CylinderGeometry(0.07, 0.06, 0.13, 16), place(0, p[1] + 0.13, p[2], { rx: Math.PI / 2 }));
  addShape('lampWhite', new THREE.CylinderGeometry(0.058, 0.058, 0.01, 16), place(0, p[1] + 0.13, p[2] - 0.066, { rx: Math.PI / 2 }));
}

// 레이더 아치
{
  const t = 0.185;
  const z = zAt(t);
  const roofY = housePoint(t, 1)[1];
  const legShape = new THREE.Shape([
    new THREE.Vector2(-0.24, -0.06),
    new THREE.Vector2(0.18, -0.06),
    new THREE.Vector2(0.52, 0.42),
    new THREE.Vector2(0.2, 0.42),
  ]);
  const leg = new THREE.ExtrudeGeometry(legShape, { depth: 0.07, bevelEnabled: false });
  // 단면의 x축을 선체의 z축(뒤쪽)으로, 돌출 방향을 선체의 x축으로 돌린다.
  addShape('white', leg, place(0.8, roofY - 0.05, z, { ry: -Math.PI / 2 }), { mirror: true });
  const wingY = roofY + 0.39;
  const wingZ = z + 0.36;
  roundBox('white', 1.74, 0.06, 0.36, 0.025, 0, wingY, wingZ);

  // 레이더 돔
  const radome = new THREE.LatheGeometry(
    [
      [0.27, 0],
      [0.3, 0.03],
      [0.3, 0.1],
      [0.26, 0.17],
      [0.16, 0.21],
      [0.0, 0.22],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    28,
  );
  box('white', 0.5, 0.03, 0.4, 0, wingY + 0.04, wingZ);
  addShape('plastic', radome, place(0, wingY + 0.055, wingZ));
  // 위성 안테나 돔과 정박등
  addShape('plastic', new THREE.CylinderGeometry(0.1, 0.12, 0.08, 16), place(0.58, wingY + 0.07, wingZ));
  addShape('plastic', new THREE.SphereGeometry(0.17, 20, 14), place(0.58, wingY + 0.2, wingZ, { sy: 1.1 }));
  addRod('steel', [-0.58, wingY, wingZ], [-0.58, wingY + 0.42, wingZ], 0.012);
  addShape('lampWhite', new THREE.SphereGeometry(0.035, 12, 8), place(-0.58, wingY + 0.45, wingZ));
  // VHF 안테나
  for (const side of [1, -1]) {
    const base = [0.83 * side, wingY + 0.02, wingZ + 0.05];
    addRod('plastic', base, [base[0], base[1] + 2.2 * Math.cos(0.3), base[2] + 2.2 * Math.sin(0.3)], 0.011, 0.004);
  }
}

// =====================================================================
// 콕핏
// =====================================================================
const zWellAft = zAt(COCKPIT_AFT);
{
  // 양쪽의 코밍과 티크 바닥
  const STATIONS = 21;
  const tAt = (i) => lerp(COCKPIT_AFT, CABIN_AFT, i / (STATIONS - 1));
  const coaming = (t) => lerp(0.2, 0.55, smooth(clamp01((t - 0.14) / 0.08)));
  loft({
    stations: STATIONS,
    rows: 5,
    point: (i, j) => {
      const t = tAt(i);
      const top = houseBaseY(t) + coaming(t);
      const section = [
        [HOUSE_WIDTH - 0.02, houseBaseY(t)],
        [HOUSE_WIDTH - 0.02, top],
        [WELL_HALF_WIDTH, top],
        [WELL_HALF_WIDTH, FLOOR_Y],
        [0, FLOOR_Y],
      ][j];
      return [section[0], section[1], zAt(t)];
    },
    mat: (_, j) => (j === 3 ? 'teak' : 'white'),
    outward: () => [0, 1, 0],
    flat: true,
  });

  const deckLevel = houseBaseY(COCKPIT_AFT) + 0.02;
  const w = WELL_HALF_WIDTH;
  const coamingTop = houseBaseY(COCKPIT_AFT) + coaming(COCKPIT_AFT);
  addQuad('white', [w, deckLevel - 0.05, zWellAft], [HOUSE_WIDTH - 0.02, deckLevel - 0.05, zWellAft], [HOUSE_WIDTH - 0.02, coamingTop, zWellAft], [w, coamingTop, zWellAft], [0, 0, 1], true);
  addQuad('white', [-w, FLOOR_Y, zWellAft], [w, FLOOR_Y, zWellAft], [w, deckLevel, zWellAft], [-w, deckLevel, zWellAft], [0, 0, -1]);

  // 뒤쪽 벤치: 받침, 방석, 등받이
  const benchLeft = -w;
  const benchRight = 0.5;
  const benchWidth = benchRight - benchLeft;
  const benchX = (benchLeft + benchRight) / 2;
  box('white', benchWidth, 0.3, 0.55, benchX, FLOOR_Y + 0.15, zWellAft - 0.275);
  box('white', benchWidth, 0.5, 0.17, benchX, deckLevel + 0.23, zWellAft + 0.085);
  const cushionWidth = (benchWidth - 0.04) / 3;
  for (let k = 0; k < 3; k++) {
    const x = benchLeft + 0.02 + cushionWidth * (k + 0.5);
    roundBox('cream', cushionWidth - 0.015, 0.13, 0.53, 0.045, x, FLOOR_Y + 0.365, zWellAft - 0.28);
    roundBox('cream', cushionWidth - 0.015, 0.36, 0.12, 0.045, x, FLOOR_Y + 0.63, zWellAft - 0.06, { rx: 0.14 });
  }
  // 좌현 쪽으로 꺾이는 좌석
  const returnZ = zWellAft - 0.55 - 0.4;
  box('white', 0.55, 0.3, 0.8, -w + 0.275, FLOOR_Y + 0.15, returnZ);
  roundBox('cream', 0.53, 0.13, 0.78, 0.045, -w + 0.275, FLOOR_Y + 0.365, returnZ);
  roundBox('cream', 0.11, 0.3, 0.78, 0.045, -w + 0.065, FLOOR_Y + 0.6, returnZ, { rz: -0.1 });

  // 테이블
  const tableX = -0.32;
  const tableZ = zWellAft - 1.08;
  roundBox('teak', 1.0, 0.035, 0.62, 0.015, tableX, FLOOR_Y + 0.68, tableZ);
  addShape('steel', new THREE.CylinderGeometry(0.035, 0.035, 0.66, 14), place(tableX, FLOOR_Y + 0.33, tableZ));
  addShape('steel', new THREE.CylinderGeometry(0.16, 0.17, 0.02, 20), place(tableX, FLOOR_Y + 0.01, tableZ));

  // 우현 앞쪽의 웨트 바
  roundBox('white', 0.55, 0.88, 0.92, 0.03, w - 0.275, FLOOR_Y + 0.44, zBulkhead + 0.5);
  box('black', 0.57, 0.025, 0.94, w - 0.275, FLOOR_Y + 0.89, zBulkhead + 0.5);
  addShape('steel', new THREE.CylinderGeometry(0.11, 0.11, 0.012, 18), place(w - 0.28, FLOOR_Y + 0.905, zBulkhead + 0.32));

  // 우현 뒤쪽의 계단
  box('white', w - 0.56, 0.19, 0.27, (w + 0.56) / 2, FLOOR_Y + 0.095, zWellAft - 0.135);
  box('teak', w - 0.6, 0.012, 0.23, (w + 0.56) / 2, FLOOR_Y + 0.196, zWellAft - 0.135);

  // 선미 갑판의 선패드
  const padZ = (zWellAft + 0.2 + zAt(0) - 0.12) / 2;
  const padLength = zAt(0) - 0.12 - (zWellAft + 0.2);
  box('white', benchWidth, 0.07, padLength + 0.04, benchX, deckLevel + 0.03, padZ);
  for (const side of [-1, 1]) {
    roundBox('cream', benchWidth / 2 - 0.02, 0.12, padLength, 0.05, benchX + (side * benchWidth) / 4, deckLevel + 0.12, padZ);
  }
}

// 선미 양쪽의 난간
{
  const x = sheerX(0.03) - 0.11;
  const y = sheerY(0.03) - 0.07;
  addTube(
    'steel',
    [
      [x, y, zAt(0.075)],
      [x - 0.01, y + 0.42, zAt(0.07)],
      [x - 0.02, y + 0.55, zAt(0.055)],
      [x - 0.04, y + 0.55, zAt(0.02)],
      [x - 0.05, y + 0.42, zAt(0.008)],
      [x - 0.05, y, zAt(0.006)],
    ],
    0.016,
    { mirror: true, segments: 40 },
  );
}

// =====================================================================
// 수영 플랫폼과 선미
// =====================================================================
{
  const outline = (inset) => {
    const half = 1.76 - inset;
    const length = 0.86 - inset;
    const radius = 0.34;
    const shape = new THREE.Shape();
    shape.moveTo(-half, inset);
    shape.lineTo(half, inset);
    shape.lineTo(half, length - radius);
    shape.quadraticCurveTo(half, length, half - radius, length);
    shape.lineTo(-half + radius, length);
    shape.quadraticCurveTo(-half, length, -half, length - radius);
    shape.closePath();
    return shape;
  };
  const top = DRAFT + 0.24;
  const zBase = zAt(0) - 0.05;
  // 도형의 y축을 선체의 z축으로, 돌출 방향을 아래쪽으로 돌린다.
  addShape('white', new THREE.ExtrudeGeometry(outline(0), { depth: 0.11, bevelEnabled: false, curveSegments: 10 }), place(0, top, zBase, { rx: Math.PI / 2 }));
  addShape('teak', new THREE.ExtrudeGeometry(outline(0.07), { depth: 0.012, bevelEnabled: false, curveSegments: 10 }), place(0, top + 0.012, zBase, { rx: Math.PI / 2 }));

  // 트림 탭과 선미등
  const deadrise = Math.atan2(chineY(0), chineX(0));
  box('steel', 0.55, 0.012, 0.28, 1.15, lerp(0, chineY(0), 1.15 / chineX(0)), zAt(0) + 0.14, { rz: deadrise });
  box('steel', 0.55, 0.012, 0.28, -1.15, lerp(0, chineY(0), 1.15 / chineX(0)), zAt(0) + 0.14, { rz: -deadrise });
  addTube(
    'steel',
    [
      [-0.9, sheerY(0) - 0.32, zAt(0)],
      [-0.86, sheerY(0) - 0.3, zAt(0) + 0.07],
      [0.86, sheerY(0) - 0.3, zAt(0) + 0.07],
      [0.9, sheerY(0) - 0.32, zAt(0)],
    ],
    0.014,
    { segments: 30 },
  );
  box('rubber', 0.09, 0.05, 0.03, 0, sheerY(0) - 0.14, zAt(0) + 0.015);
  box('lampWhite', 0.06, 0.03, 0.02, 0, sheerY(0) - 0.14, zAt(0) + 0.03);
}

// =====================================================================
// 선수 난간과 갑판 의장
// =====================================================================
{
  const T0 = 0.34;
  const T1 = 0.992;
  const railX = (t) => Math.max(sheerX(t) - 0.1, 0.09);
  const railPoint = (t, side, fraction) => {
    const rise = smooth(clamp01((t - T0) / 0.06));
    const height = rise * lerp(0.64, 0.74, (t - T0) / (T1 - T0));
    return [side * (railX(t) - 0.04 * fraction), sheerY(t) - 0.07 + fraction * height + (fraction > 0 ? 0.02 : 0), zAt(t)];
  };
  const loop = (tFrom, fraction, samples) => {
    const points = [];
    for (let k = 0; k <= samples; k++) points.push(railPoint(lerp(tFrom, T1, k / samples), 1, fraction));
    const tip = railPoint(T1, 1, fraction);
    points.push([0, tip[1], tip[2] - 0.13]);
    for (let k = samples; k >= 0; k--) points.push(railPoint(lerp(tFrom, T1, k / samples), -1, fraction));
    return points;
  };
  addTube('steel', loop(T0, 1, 44), 0.016, { segments: 360 });
  addTube('steel', loop(0.415, 0.5, 36), 0.011, { segments: 300 });
  for (const t of [0.415, 0.49, 0.565, 0.64, 0.715, 0.79, 0.865, 0.935, 0.985]) {
    addRod('steel', railPoint(t, 1, 0), railPoint(t, 1, 1), 0.013, 0.013, { mirror: true });
    addShape('steel', new THREE.CylinderGeometry(0.028, 0.032, 0.015, 10), place(...railPoint(t, 1, 0)), { mirror: true });
  }

  // 클리트
  const cleat = (t, inset) => {
    const x = sheerX(t) - inset;
    const y = deckY(t, x);
    const z = zAt(t);
    addShape('steel', new THREE.CapsuleGeometry(0.014, 0.2, 4, 10), place(x, y + 0.055, z, { rx: Math.PI / 2 }), { mirror: true });
    for (const dz of [-0.045, 0.045]) {
      addShape('steel', new THREE.CylinderGeometry(0.012, 0.016, 0.05, 8), place(x, y + 0.028, z + dz), { mirror: true });
    }
  };
  cleat(0.9, 0.19);
  cleat(0.5, 0.2);
  cleat(0.025, 0.22);

  // 체인 로커 덮개, 윈드라스, 앵커
  const hatchT = 0.895;
  roundBox('white', 0.42, 0.024, 0.4, 0.01, 0, deckY(hatchT, 0) + 0.008, zAt(hatchT));
  const windlassT = 0.94;
  const windlassY = deckY(windlassT, 0);
  addShape('steel', new THREE.CylinderGeometry(0.075, 0.09, 0.12, 18), place(0, windlassY + 0.06, zAt(windlassT)));
  addShape('steel', new THREE.SphereGeometry(0.075, 16, 10), place(0, windlassY + 0.12, zAt(windlassT), { sy: 0.4 }));
  addShape('steel', new THREE.CylinderGeometry(0.055, 0.055, 0.07, 14), place(0.11, windlassY + 0.07, zAt(windlassT), { rz: Math.PI / 2 }));

  const bowY = sheerY(1);
  const zBow = zAt(1);
  roundBox('steel', 0.13, 0.045, 0.5, 0.015, 0, bowY + 0.035, zBow + 0.14);
  box('steel', 0.028, 0.045, 0.5, 0, bowY + 0.07, zBow + 0.08, { rx: -0.06 });
  addShape('steel', new THREE.ConeGeometry(0.12, 0.3, 3), place(0, bowY - 0.06, zBow - 0.14, { rx: -2.2, sz: 0.4 }));
}

// =====================================================================
// 내보내기
// =====================================================================
const yacht = new THREE.Group();
yacht.name = 'sport-yacht';
let triangles = 0;
for (const [key, { pos, nor }] of Object.entries(buckets)) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (MATERIALS[key].map) {
    // 티크 면은 대부분 수평이므로 위에서 내려다본 좌표를 그대로 UV로 사용한다.
    const uv = [];
    for (let k = 0; k < pos.length; k += 3) uv.push(pos[k] / TEAK_TILE_WIDTH, pos[k + 2] / TEAK_TILE_LENGTH);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  const mesh = new THREE.Mesh(mergeVertices(geometry), MATERIALS[key]);
  mesh.name = key;
  yacht.add(mesh);
  triangles += pos.length / 9;
}

const scene = new THREE.Scene();
scene.add(yacht);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(glb));

const bounds = new THREE.Box3().setFromObject(yacht);
const size = bounds.getSize(new THREE.Vector3());
console.log(OUT);
console.log(`size  ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m (beam x height x length)`);
console.log(`z     ${bounds.min.z.toFixed(2)} (bow) .. ${bounds.max.z.toFixed(2)} (stern), y ${bounds.min.y.toFixed(2)} .. ${bounds.max.y.toFixed(2)}, draft ${DRAFT} m`);
console.log(`tris  ${triangles}, ${(glb.byteLength / 1024).toFixed(0)} KB`);
