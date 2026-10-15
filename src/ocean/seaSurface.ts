import * as THREE from 'three';
import {
  AMPLITUDE_GLSL,
  GRID_SIZE,
  PRIMARY_CHOPPINESS,
  PRIMARY_MAX_WAVENUMBER,
  PRIMARY_TILE,
  SEA_NOISE,
  SEA_SHAPE,
} from './seaSpectrum';

const SIZE = GRID_SIZE;
const PASSES_PER_AXIS = Math.log2(SIZE);

interface CascadeSpec {
  /** 무늬 한 장이 덮는 수면의 한 변 (m). 이 간격으로 같은 무늬가 되풀이된다. */
  tileSize: number;
  /** 이 층이 맡는 파수의 범위 (rad/m). 층끼리 겹치지 않게 나눠야 같은 파도를 두 번 더하지 않는다. */
  wavenumbers: readonly [number, number];
  /** 마루를 뾰족하게 만드는 수평 변위의 비율 */
  choppiness: number;
  /** 이 층의 에너지에 곱하는 배율. 1이면 스펙트럼이 정한 그대로이다. */
  gain: number;
  /** 너울을 포함하는지. 너울은 파장이 길어서 가장 큰 층에만 들어 있다. */
  swell: boolean;
}

const SMALL_WAVENUMBER = (Math.PI * 2) / 2.6;

/**
 * 파장의 범위를 나눠서 맡는 세 층. 한 장으로 넓은 범위를 덮으면 잔물결을 표현할 해상도가 모자라고,
 * 좁은 범위만 덮으면 같은 무늬가 되풀이되는 것이 눈에 띈다. 크기가 서로 배수가 아닌 여러 장을 겹치면 되풀이가 가려진다.
 *
 * 첫 번째 층이 배가 타는 큰 파도이다. CPU가 같은 파도를 직접 더해서 선체 아래의 수면을 구하므로 (seaSpectrum.ts),
 * 무늬의 크기와 파수의 범위, 뾰족한 정도가 그쪽의 값과 같아야 한다.
 * 나머지 두 층은 화면에만 보이는 물결이다. 가장 작은 층은 스펙트럼이 정한 그대로 두면 수면 전체가 잘게 떨리는 것처럼 보여서 약하게 둔다.
 */
const CASCADES: readonly CascadeSpec[] = [
  {
    tileSize: PRIMARY_TILE,
    wavenumbers: [0, PRIMARY_MAX_WAVENUMBER],
    choppiness: PRIMARY_CHOPPINESS,
    gain: 1,
    swell: true,
  },
  { tileSize: 97, wavenumbers: [PRIMARY_MAX_WAVENUMBER, SMALL_WAVENUMBER], choppiness: 1.0, gain: 1, swell: false },
  { tileSize: 23, wavenumbers: [SMALL_WAVENUMBER, (Math.PI * 2) / 0.5], choppiness: 0.6, gain: 0.3, swell: false },
];

const passVertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * 지금 시각의 스펙트럼을 만든다. 텍스처의 한 칸이 방향과 파장이 정해진 파도 하나에 해당한다.
 * 파도마다 진폭은 스펙트럼으로 정하고(seaSpectrum.ts), 위상은 분산 관계 ω = √(g·k)에 따라 시간이 흐르는 만큼 돌린다.
 * 출력은 복소수 두 개이다: (높이 + i·x 방향의 수평 변위)와 (z 방향의 수평 변위).
 */
const spectrumShader = /* glsl */ `
  ${AMPLITUDE_GLSL}

  uniform sampler2D uNoise;
  uniform float uTime;
  uniform float uTileSize;
  // 이 층이 맡는 파수의 범위 (작은 쪽, 큰 쪽)
  uniform vec2 uBand;
  uniform float uGain;

  const float SIZE = ${SIZE.toFixed(1)};
  const float TWO_PI = 6.283185307;
  const float GRAVITY = 9.81;

  void main() {
    vec2 index = floor(gl_FragCoord.xy);
    // 칸의 절반을 넘어가면 음의 파수이다.
    vec2 k = TWO_PI / uTileSize * (index - SIZE * step(SIZE * 0.5, index));
    float kLength = length(k);
    if (kLength <= uBand.x || kLength > uBand.y) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // 난수 텍스처에는 이 파도(k)와 반대 방향의 파도(-k)에 쓸 난수가 함께 들어 있다.
    vec4 noise = texture2D(uNoise, gl_FragCoord.xy / SIZE);
    vec2 forward = noise.xy * amplitude(k, kLength, uTileSize) * uGain;
    vec2 backward = noise.zw * amplitude(-k, kLength, uTileSize) * uGain;

    // h(k, t) = h0(k)·e^(iωt) + conj(h0(-k))·e^(-iωt). 이렇게 짝을 지어야 변환한 결과가 실수가 된다.
    float phase = sqrt(GRAVITY * kLength) * uTime;
    vec2 turn = vec2(cos(phase), sin(phase));
    vec2 height = vec2(forward.x * turn.x - forward.y * turn.y, forward.x * turn.y + forward.y * turn.x)
                + vec2(backward.x * turn.x - backward.y * turn.y, -backward.x * turn.y - backward.y * turn.x);

    // 수평 변위의 스펙트럼은 -i·(k/|k|)·h이다. 마루 쪽으로 수면을 끌어당겨서 마루는 뾰족하고 골은 완만하게 만든다.
    // x 방향의 변위는 i를 곱해서 높이의 허수부에 실어 보내면, 변환 한 번으로 높이와 변위를 함께 얻는다.
    vec2 unit = k / kLength;
    gl_FragColor = vec4(height * (1.0 + unit.x), unit.y * vec2(height.y, -height.x));
  }
`;

/**
 * 푸리에 변환의 한 단계. fft.ts의 stockhamPass와 같은 계산을 텍스처의 가로줄 또는 세로줄 전체에 대해 수행한다.
 * 한 축에 log2(SIZE)번, 두 축을 합쳐서 그 두 배만큼 반복하면 스펙트럼이 수면의 형태로 바뀐다.
 */
const transformShader = /* glsl */ `
  uniform sampler2D uInput;
  uniform float uSubSize;
  uniform bool uHorizontal;

  const float SIZE = ${SIZE.toFixed(1)};
  const float TWO_PI = 6.283185307;

  vec2 multiply(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
  }

  void main() {
    vec2 cell = floor(gl_FragCoord.xy);
    float index = uHorizontal ? cell.x : cell.y;
    float even = floor(index / uSubSize) * (uSubSize * 0.5) + mod(index, uSubSize * 0.5);
    float odd = even + SIZE * 0.5;
    vec2 evenCell = uHorizontal ? vec2(even, cell.y) : vec2(cell.x, even);
    vec2 oddCell = uHorizontal ? vec2(odd, cell.y) : vec2(cell.x, odd);
    vec4 a = texture2D(uInput, (evenCell + 0.5) / SIZE);
    vec4 b = texture2D(uInput, (oddCell + 0.5) / SIZE);
    float angle = -TWO_PI * index / uSubSize;
    vec2 twiddle = vec2(cos(angle), sin(angle));
    gl_FragColor = vec4(a.xy + multiply(twiddle, b.xy), a.zw + multiply(twiddle, b.zw));
  }
`;

/** 변환의 결과를 수면의 변위 (x, 높이, z)로 정리해서, 부드럽게 읽을 수 있는 텍스처에 옮긴다. */
const displacementShader = /* glsl */ `
  uniform sampler2D uInput;
  uniform float uChoppiness;

  const float SIZE = ${SIZE.toFixed(1)};

  void main() {
    vec4 value = texture2D(uInput, gl_FragCoord.xy / SIZE);
    gl_FragColor = vec4(value.y * uChoppiness, value.x, value.z * uChoppiness, 1.0);
  }
`;

/**
 * 변위의 차이로 수면의 기울기와 "접힌 정도"를 구한다.
 * 접힌 정도(야코비안)는 수평 변위가 수면을 얼마나 모으는지를 나타내며, 1이면 그대로이고 0에 가까우면 마루가 접혀서 부서지는 곳이다.
 */
const gradientShader = /* glsl */ `
  uniform sampler2D uDisplacement;
  uniform float uTileSize;
  uniform float uChoppiness;

  const float SIZE = ${SIZE.toFixed(1)};

  void main() {
    vec2 uv = gl_FragCoord.xy / SIZE;
    float texel = 1.0 / SIZE;
    vec3 right = texture2D(uDisplacement, uv + vec2(texel, 0.0)).xyz;
    vec3 left = texture2D(uDisplacement, uv - vec2(texel, 0.0)).xyz;
    vec3 above = texture2D(uDisplacement, uv + vec2(0.0, texel)).xyz;
    vec3 below = texture2D(uDisplacement, uv - vec2(0.0, texel)).xyz;
    float span = 2.0 * uTileSize / SIZE;
    vec3 alongX = (right - left) / span;
    vec3 alongZ = (above - below) / span;

    float jacobian = (1.0 + alongX.x) * (1.0 + alongZ.z) - alongX.z * alongZ.x;
    // 수평 변위가 수면을 모은 곳에서는 같은 높이의 차이가 더 짧은 거리에 놓이므로 기울기가 커진다.
    vec2 slope = vec2(alongX.y / max(1.0 + alongX.x, 0.3), alongZ.y / max(1.0 + alongZ.z, 0.3));
    // 마루의 가파름: 수평 변위가 수면을 모으는 정도. 선체가 부서지는 파도에 맞는지를 판정하는 값과 같은 양이다.
    float steepness = -(alongX.x + alongZ.z) / uChoppiness;
    gl_FragColor = vec4(slope, jacobian, steepness);
  }
`;

/** 수면의 셰이더가 읽는 한 층의 결과 */
export interface SeaCascade {
  tileSize: number;
  /** (x 방향의 변위, 높이, z 방향의 변위) (m) */
  displacement: THREE.Texture;
  /** (x 방향의 기울기, z 방향의 기울기, 접힌 정도, 마루의 가파름) */
  gradient: THREE.Texture;
  /** 위의 두 텍스처를 담은 렌더 타깃. 테스트에서 GPU가 계산한 값을 읽어 오는 데 쓴다. */
  displacementTarget: THREE.WebGLRenderTarget;
  gradientTarget: THREE.WebGLRenderTarget;
}

interface Cascade extends SeaCascade {
  spec: CascadeSpec;
}

/**
 * 수면의 형태를 푸리에 변환으로 만든다. 방향과 파장이 조금씩 다른 파도 수만 개를 한꺼번에 더하므로,
 * 마루가 생겼다가 사라지고 서로 합쳐지는 불규칙한 움직임이 나온다.
 * 결과는 층마다 텍스처 두 장(변위, 기울기)이고, 수면의 셰이더가 이를 읽어서 정점을 옮기고 빛의 반사를 계산한다.
 */
export class SeaSurface {
  readonly cascades: readonly SeaCascade[];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly spectrum = createPass(spectrumShader, {
    uNoise: { value: createNoise() },
    uTime: { value: 0 },
    uTileSize: { value: 1 },
    uBand: { value: new THREE.Vector2() },
    uGain: { value: 1 },
    uWindEnergy: { value: 0 },
    uPeak: { value: 1 },
    uWindDirection: { value: new THREE.Vector2(0, -1) },
    uSwellEnergy: { value: 0 },
    uSwellCenter: { value: new THREE.Vector2() },
    uSwellSpread: { value: 1 },
  });
  private readonly transform = createPass(transformShader, {
    uInput: { value: null },
    uSubSize: { value: 2 },
    uHorizontal: { value: true },
  });
  private readonly displace = createPass(displacementShader, { uInput: { value: null }, uChoppiness: { value: 1 } });
  private readonly gradient = createPass(gradientShader, {
    uDisplacement: { value: null },
    uTileSize: { value: 1 },
    uChoppiness: { value: 1 },
  });
  // 변환의 중간 결과를 번갈아 담는 두 장. 한 장을 읽어서 다른 장에 쓰는 것을 되풀이한다.
  private readonly ping: THREE.WebGLRenderTarget;
  private readonly pong: THREE.WebGLRenderTarget;
  private readonly ownCascades: Cascade[];

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.spectrum);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // 변환의 중간값은 정밀도가 필요하므로 32비트 실수로 계산한다. 지원하지 않는 기기에서는 16비트로 낮춘다.
    const precise = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    const working = () =>
      new THREE.WebGLRenderTarget(SIZE, SIZE, {
        type: precise,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
      });
    this.ping = working();
    this.pong = working();

    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.ownCascades = CASCADES.map((spec) => {
      const displacementTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, {
        type: THREE.HalfFloatType,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        // 정점이 성긴 곳에서는 축소한 단계를 읽어서, 정점의 간격보다 짧은 물결을 미리 걸러 낸다.
        minFilter: THREE.LinearMipmapLinearFilter,
        generateMipmaps: true,
        depthBuffer: false,
      });
      // 기울기는 먼 수면에서도 읽으므로, 축소한 단계를 함께 만들어서 자글거리지 않게 한다.
      const gradientTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, {
        type: THREE.HalfFloatType,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        minFilter: THREE.LinearMipmapLinearFilter,
        generateMipmaps: true,
        anisotropy,
        depthBuffer: false,
      });
      return {
        spec,
        tileSize: spec.tileSize,
        displacementTarget,
        gradientTarget,
        displacement: displacementTarget.texture,
        gradient: gradientTarget.texture,
      };
    });
    this.cascades = this.ownCascades;
  }

  /** elapsed는 배가 타는 수면을 읽을 때와 같은 시계여야 화면의 파도와 배의 움직임이 일치한다. */
  update(elapsed: number): void {
    const { renderer } = this;
    const previousTarget = renderer.getRenderTarget();

    const spectrum = this.spectrum.uniforms;
    spectrum['uWindEnergy'].value = SEA_SHAPE.windEnergy;
    spectrum['uPeak'].value = SEA_SHAPE.peak;
    (spectrum['uWindDirection'].value as THREE.Vector2).set(SEA_SHAPE.windX, SEA_SHAPE.windZ);
    (spectrum['uSwellCenter'].value as THREE.Vector2).set(SEA_SHAPE.swellX, SEA_SHAPE.swellZ);
    spectrum['uSwellSpread'].value = SEA_SHAPE.swellSpread;
    spectrum['uTime'].value = elapsed;

    for (const cascade of this.ownCascades) {
      const { spec } = cascade;
      spectrum['uTileSize'].value = spec.tileSize;
      spectrum['uGain'].value = spec.gain;
      spectrum['uSwellEnergy'].value = spec.swell ? SEA_SHAPE.swellEnergy : 0;
      (spectrum['uBand'].value as THREE.Vector2).set(spec.wavenumbers[0], spec.wavenumbers[1]);
      this.draw(this.spectrum, this.ping);

      let source = this.ping;
      let destination = this.pong;
      for (let pass = 0; pass < PASSES_PER_AXIS * 2; pass++) {
        this.transform.uniforms['uInput'].value = source.texture;
        this.transform.uniforms['uHorizontal'].value = pass < PASSES_PER_AXIS;
        this.transform.uniforms['uSubSize'].value = 2 ** ((pass % PASSES_PER_AXIS) + 1);
        this.draw(this.transform, destination);
        [source, destination] = [destination, source];
      }

      this.displace.uniforms['uInput'].value = source.texture;
      this.displace.uniforms['uChoppiness'].value = spec.choppiness;
      this.draw(this.displace, cascade.displacementTarget);

      this.gradient.uniforms['uDisplacement'].value = cascade.displacement;
      this.gradient.uniforms['uTileSize'].value = spec.tileSize;
      this.gradient.uniforms['uChoppiness'].value = spec.choppiness;
      this.draw(this.gradient, cascade.gradientTarget);
    }

    renderer.setRenderTarget(previousTarget);
  }

  private draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }
}

function createPass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: passVertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * 파도마다 진폭과 위상을 정하는 난수(seaSpectrum.ts)를 텍스처에 담는다.
 * 한 칸에는 그 칸의 파도(k)에 쓸 난수와, 반대 방향의 파도(-k)에 쓸 난수가 함께 들어 있다.
 */
function createNoise(): THREE.DataTexture {
  const gaussian = SEA_NOISE;
  const data = new Float32Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const own = (y * SIZE + x) * 2;
      const opposite = (((SIZE - y) % SIZE) * SIZE + ((SIZE - x) % SIZE)) * 2;
      const index = (y * SIZE + x) * 4;
      data[index] = gaussian[own];
      data[index + 1] = gaussian[own + 1];
      data[index + 2] = gaussian[opposite];
      data[index + 3] = gaussian[opposite + 1];
    }
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}
