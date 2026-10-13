import * as THREE from 'three';
import { OCEAN_CELL_SIZE } from './oceanGeometry';
import { GRID_SIZE } from './seaSpectrum';
import type { SeaCascade } from './seaSurface';
import { BREAKING_STEEPNESS } from './waves';

const waveUniforms = /* glsl */ `
  uniform float uTime;
  // 푸리에 변환으로 만든 수면의 세 층 (seaSurface.ts): 배가 타는 큰 파도, 그보다 짧은 물결, 잔물결.
  // 앞의 두 층은 정점을 실제로 옮기고, 잔물결은 빛의 반사에만 쓴다.
  uniform sampler2D uSeaDisplacement;
  uniform sampler2D uDetailDisplacement;
  uniform sampler2D uSeaGradient;
  uniform sampler2D uDetailGradientLarge;
  uniform sampler2D uDetailGradientSmall;
  // 세 층의 무늬 한 장이 덮는 길이 (m)
  uniform vec3 uSeaTile;

  // 월드의 (x, z)를 한 층의 텍스처 좌표로 바꾼다. 텍스처의 i번째 칸에는 x = i × (무늬의 길이 / 칸 수) 지점의 값이 들어 있으므로,
  // 그 지점이 칸의 가운데에 오도록 반 칸을 더한다. 이 반 칸을 빠뜨리면 화면의 수면이 배가 타는 수면과 어긋난다.
  vec2 seaUv(vec2 position, float tileSize) {
    return position / tileSize + 0.5 / DETAIL_TEXELS;
  }
`;

const vertexShader = /* glsl */ `
  ${waveUniforms}

  varying vec2 vBasePosition;
  varying vec3 vWorldPosition;

  void main() {
    vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;
    float gridDistance = length(position.xz);

    // 격자는 중심에서 멀어질수록 성겨진다. 정점의 간격이 무늬의 한 칸보다 넓은 곳에서는 그만큼 축소한 단계를 읽어야,
    // 정점 사이에 담지 못하는 짧은 파도 때문에 수면이 자글거리지 않는다. 아주 먼 곳은 자연히 평평해진다.
    float spacing = DETAIL_CELL_SIZE * (1.0 + gridDistance / 30.0);
    float seaLevel = log2(max(spacing * DETAIL_TEXELS / uSeaTile.x, 1.0));
    vec3 displaced = base + textureLod(uSeaDisplacement, seaUv(base.xz, uSeaTile.x), seaLevel).xyz;

    // 잔물결은 정점이 촘촘한 배 주변에서만 형태로 표현하고, 그 바깥에서는 빛의 반사로만 표현한다.
    float detailFade = 1.0 - smoothstep(DETAIL_DISPLACE_RANGE * 0.4, DETAIL_DISPLACE_RANGE, gridDistance);
    if (detailFade > 0.0) {
      float level = log2(max(spacing * DETAIL_TEXELS / uSeaTile.y, 1.0));
      displaced += textureLod(uDetailDisplacement, seaUv(base.xz, uSeaTile.y), level).xyz * detailFade;
    }

    vBasePosition = base.xz;
    vWorldPosition = displaced;
    gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  ${waveUniforms}

  uniform float uHazeDistance;
  uniform float uRippleStrength;
  // 마루가 부서지기 시작하는 가파름. 선체를 넘어뜨리는 힘의 계산과 같은 값이다.
  uniform float uBreakingSteepness;
  // 바람이 불어 가는 방향 (월드의 x, z)과, 강풍에 날리는 물보라의 세기 (0~1)
  uniform vec2 uWindDirection;
  uniform float uSpindrift;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  // 수면에 닿는 직사광의 색과 세기. 해가 지면 0이 된다.
  uniform vec3 uSunLight;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uScatterColor;
  // 해안이 얼마나 가까운지를 기록한 지도와, 그 지도가 덮는 범위 (북서쪽 모서리의 x와 z, 가로와 세로의 길이)
  uniform sampler2D uShoreMap;
  uniform vec4 uShoreBounds;
  uniform samplerCube uSky;
  uniform sampler2D uDetailNormals;
  uniform sampler2D uWakeMap;
  uniform vec2 uWakeCenter;
  uniform float uWakeHalfExtent;

  varying vec2 vBasePosition;
  varying vec3 vWorldPosition;

  // 잔물결의 무늬를 읽는 좌표를 층마다 다른 각도로 돌린다.
  // 세 층이 같은 방향으로 놓이면 무늬의 결이 겹쳐서 수면에 격자 모양의 줄이 보인다.
  vec2 turn(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  void main() {
    vec3 toCamera = cameraPosition - vWorldPosition;
    float cameraDistance = length(toCamera);
    vec3 viewDirection = toCamera / cameraDistance;

    // 수면의 기울기와 접힌 정도는 정점이 아니라 픽셀마다 텍스처에서 읽는다.
    // 따라서 격자가 성긴 곳에서도 빛의 반사는 세밀하게 표현되고, 먼 곳에서는 축소한 단계를 읽어서 자글거리지 않는다.
    vec4 sea = texture2D(uSeaGradient, seaUv(vBasePosition, uSeaTile.x));
    vec3 detailLarge = texture2D(uDetailGradientLarge, seaUv(vBasePosition, uSeaTile.y)).xyz;
    vec3 detailSmall = texture2D(uDetailGradientSmall, seaUv(vBasePosition, uSeaTile.z)).xyz;
    vec2 slope = sea.xy + detailLarge.xy + detailSmall.xy;
    // 큰 파도가 수면을 접는 정도(마루에서 양수)와, 선체를 넘어뜨리는 힘을 판정하는 것과 같은 마루의 가파름
    float pinch = 1.0 - sea.z;
    float breaker = sea.w;

    // 서로 다른 크기와 속도로 흐르는 무늬 세 장. 물거품과 물보라가 끊어지는 자리를 정하는 데 쓴다.
    vec2 rippleLarge = texture2D(uDetailNormals, turn(vBasePosition, 0.35) / 61.0 + uTime * vec2(0.006, 0.004)).xy * 2.0 - 1.0;
    vec2 rippleMedium = texture2D(uDetailNormals, turn(vBasePosition, 1.9) / 23.0 + uTime * vec2(-0.011, 0.008)).xy * 2.0 - 1.0;
    vec2 rippleSmall = texture2D(uDetailNormals, turn(vBasePosition, 4.1) / 7.3 + uTime * vec2(0.017, -0.021)).xy * 2.0 - 1.0;
    float rippleFade = 1.0 - smoothstep(300.0, 4000.0, cameraDistance);
    // 반사에는 가장 작은 무늬만 약하게 보태서, 텍스처의 한 칸보다 작은 주름을 채운다.
    vec2 ripple = rippleSmall * 0.02 * rippleFade * uRippleStrength;

    vec3 normal = normalize(vec3(-slope.x - ripple.x, 1.0, -slope.y - ripple.y));

    // 프레넬: 수면을 비스듬하게 볼수록 하늘이 많이 반사되고, 수직으로 내려다볼수록 물속의 색이 보인다.
    float facing = max(dot(normal, viewDirection), 0.0);
    float fresnel = 0.02 + 0.73 * pow(1.0 - facing, 5.0);

    vec3 reflected = reflect(-viewDirection, normal);
    // 카메라 반대쪽으로 기울어진 면은 반사 방향이 수평선 아래를 향한다. 실제로는 그 빛이 앞쪽의 파도에 한 번 더 반사되어
    // 하늘로 올라가므로, 방향을 위로 뒤집는다. 수평선에 고정하면 밝은 연무의 색이 수면에 흰 얼룩으로 나타난다.
    reflected.y = abs(reflected.y) + 0.04;
    vec3 skyReflection = textureCube(uSky, normalize(reflected), 1.5).rgb;

    float sunFacing = max(dot(normal, uSunDirection), 0.0);

    // 해안에 가까운 곳은 바닥이 얕아서 빛이 덜 흡수되므로 밝은 청록색으로 보인다.
    // 수심 자료가 없으므로 해안까지의 거리로 대신한다. 지도의 범위 밖은 깊은 바다로 본다.
    vec2 shoreUv = (vWorldPosition.xz - uShoreBounds.xy) / uShoreBounds.zw;
    float shallow = texture2D(uShoreMap, shoreUv).r;
    shallow *= shallow;
    vec3 waterColor = mix(uDeepColor, uShallowColor, shallow);

    // 물속에서 되돌아 나오는 빛: 하늘 전체에서 오는 빛과 직사광이 물의 색으로 물들어서 나온다.
    // 하늘의 큐브 맵을 가장 흐린 단계로 읽으면 하늘 전체의 평균에 가까운 색이 되고, 시각에 따라 저절로 바뀐다.
    vec3 skyLight = textureCube(uSky, vec3(0.0, 1.0, 0.0), 7.0).rgb;
    vec3 body = waterColor * (skyLight * 0.55 + uSunLight * (0.1 + 0.22 * sunFacing));

    // 파도의 벽을 통과한 빛(표면하 산란): 해를 마주 보는 쪽에서, 높이 솟아서 카메라 쪽으로 기울어진 수면이 청록색으로 빛난다.
    float towardSun = pow(max(dot(viewDirection, -uSunDirection) * 0.5 + 0.5, 0.0), 3.0);
    float lifted = smoothstep(-0.2, 2.4, vWorldPosition.y);
    float leaning = max(dot(normalize(vec3(normal.x, 0.0, normal.z) + 1e-5), viewDirection), 0.0) * (1.0 - normal.y * normal.y);
    body += uScatterColor * uSunLight * (lifted * (0.35 + 1.6 * towardSun) + leaning * towardSun * 6.0);

    // 항적 지도에서 이 지점의 물거품 세기를 읽는다. 지도의 범위 밖은 0으로 취급한다.
    vec2 wakeUv = (vWorldPosition.xz - uWakeCenter) / (2.0 * uWakeHalfExtent) + 0.5;
    vec2 wakeInside = step(vec2(0.0), wakeUv) * step(wakeUv, vec2(1.0));
    float wake = texture2D(uWakeMap, wakeUv).r * wakeInside.x * wakeInside.y;
    // 공기 방울이 섞인 물은 밝은 청록색으로 보인다.
    body += uScatterColor * (skyLight + uSunLight) * wake * 0.9;

    vec3 halfVector = normalize(viewDirection + uSunDirection);
    // 지수가 클수록 반짝임이 작고 날카로워진다. 잔물결의 기울기가 세밀해서, 너무 날카로우면 수면 전체가 자글거리는 것처럼 보인다.
    float sunGlint = 0.45 * pow(max(dot(normal, halfVector), 0.0), 220.0);
    // 반짝임은 해가 수면에 비치는 길 위에 모인다. 짧은 물결을 뺀 큰 파도의 면이 해를 거울처럼 비추는 방향에서 얼마나 벗어났는지로
    // 그 길을 정하고, 길의 바깥에서는 반짝임을 크게 줄인다. 그러지 않으면 잔물결의 넓은 면이 화면 전체에서 희게 번쩍인다.
    vec3 swellNormal = normalize(vec3(-sea.x, 1.0, -sea.y));
    float sunPath = pow(max(dot(reflect(-viewDirection, swellNormal), uSunDirection), 0.0), 10.0);
    sunGlint *= 0.04 + 0.96 * sunPath;

    vec3 color = mix(body, skyReflection, fresnel) + uSunColor * sunGlint;

    // 마루가 뾰족하게 접히는 곳에 흰 물거품을 얹는다.
    // 잔물결이 수면을 접는 정도를 보태므로, 큰 파도의 마루 가운데에서도 잔물결의 마루가 겹친 자리에만 물거품이 생긴다.
    float fold = max(1.0 - detailLarge.z, 0.0) + 0.5 * max(1.0 - detailSmall.z, 0.0);
    float foam = smoothstep(0.3, 0.46, pinch + 0.5 * (fold - 0.2)) * rippleFade;
    // 가장자리는 무늬를 따라 끊어서, 매끈한 얼룩으로 보이지 않게 한다.
    foam *= smoothstep(-0.15, 0.25, rippleSmall.x + rippleMedium.y);

    // 선체를 넘어뜨릴 만큼 가파른 마루에는 넓게 부서지는 물거품을 얹는다.
    // 물리 계산과 같은 기준을 사용하므로, 화면에서 희게 부서지는 마루가 곧 피해야 할 마루이다.
    // 가장자리로 갈수록 잔물결의 무늬를 따라 끊어지게 해서, 매끈한 덩어리로 보이지 않게 한다.
    float breakingAmount = smoothstep(uBreakingSteepness - 0.03, uBreakingSteepness + 0.09, breaker);
    float breakingNoise = 0.5 + 0.5 * clamp(rippleSmall.x * 0.9 + rippleMedium.y * 0.7 + rippleLarge.x * 0.5, -1.0, 1.0);
    float breaking = smoothstep(1.0 - breakingAmount, 1.25 - breakingAmount, breakingNoise) * step(0.001, breakingAmount) * rippleFade;

    // 강풍은 마루의 물거품을 날려서, 수면에 바람이 불어 가는 방향으로 길게 늘어진 흰 줄을 만든다.
    // 바람과 나란한 방향으로는 길게, 가로지르는 방향으로는 촘촘하게 무늬를 읽고, 바람을 따라 흘려보낸다.
    // 바람이 약해서 보이지 않을 때에는 무늬를 읽지 않는다.
    float spindrift = 0.0;
    if (uSpindrift > 0.001) {
      vec2 windSide = vec2(-uWindDirection.y, uWindDirection.x);
      vec2 streakUv = vec2(dot(vBasePosition, uWindDirection) / 210.0 - uTime * 0.07, dot(vBasePosition, windSide) / 46.0);
      float streakPattern = texture2D(uDetailNormals, streakUv).x * 0.6 + texture2D(uDetailNormals, streakUv * vec2(0.53, 1.9) + 0.37).y * 0.4;
      float streakFade = 1.0 - smoothstep(120.0, 1500.0, cameraDistance);
      // 줄이 끝없이 이어지지 않도록, 잔물결의 무늬로 군데군데 끊는다.
      float streakBreak = smoothstep(-0.25, 0.35, rippleLarge.x + rippleMedium.y);
      // 경계를 넓게 풀어서 또렷한 줄이 아니라 옅은 얼룩으로 보이게 하고, 잔물결이 솟은 자리에서만 짙어지게 한다.
      // 줄의 모양이 수면의 굴곡과 따로 놀면 수면 위에 그려 넣은 것처럼 보인다.
      float lifted = smoothstep(0.0, 0.35, fold);
      spindrift = smoothstep(0.5, 0.9, streakPattern) * streakBreak * (0.35 + 0.65 * lifted) * uSpindrift * streakFade;
    }

    // 항적의 물거품은 세기가 약해질수록 잔물결의 무늬를 따라 듬성듬성하게 끊어진다.
    float wakeNoise = 0.5 + 0.5 * clamp(rippleMedium.x * 0.7 + rippleSmall.y * 0.7 + rippleLarge.x * 0.4, -1.0, 1.0);
    float wakeFoam = smoothstep(1.0 - wake, 1.35 - wake, wakeNoise) * step(0.01, wake);
    foam = max(foam, wakeFoam);
    // 물거품은 스스로 빛나지 않으므로, 수면에 닿는 빛이 줄어드는 해 질 무렵과 밤에는 함께 어두워진다.
    float daylight = clamp(dot(skyLight + uSunLight, vec3(0.33)), 0.03, 1.0);
    color = mix(color, vec3(0.85, 0.9, 0.92) * (0.5 + 0.6 * sunFacing) * daylight, foam * 0.75);
    // 부서지는 마루는 두꺼운 물거품이어서 햇빛의 방향과 관계없이 밝고, 날리는 물보라는 수면을 옅게 덮는다.
    color = mix(color, vec3(1.25, 1.3, 1.33) * (0.75 + 0.35 * sunFacing) * daylight, max(breaking * 0.92, spindrift * 0.2));

    // 먼 수면을 그 방향의 수평선 색상으로 수렴시켜서 바다의 끝과 하늘의 경계를 감춘다.
    vec3 horizonColor = textureCube(uSky, normalize(vec3(-viewDirection.x, 0.03, -viewDirection.z)), 1.5).rgb;
    float haze = 1.0 - exp(-pow(cameraDistance / uHazeDistance, 2.0));
    color = mix(color, horizonColor, haze);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface OceanMaterialOptions {
  sky: THREE.CubeTexture;
  detailNormals: THREE.Texture;
  wake: { texture: THREE.Texture; center: THREE.Vector2; halfExtent: number };
  hazeDistance: number;
  sunDirection: THREE.Vector3;
  /** 푸리에 변환으로 만든 수면의 층. 파장이 긴 층이 앞에 온다. */
  cascades: readonly [SeaCascade, SeaCascade, SeaCascade];
  /** 잔물결이 정점을 실제로 옮기는 범위 (m). 정점의 간격이 잔물결을 표현할 수 있을 만큼 촘촘한 곳까지이다. */
  detailDisplaceRange: number;
}

/** 해안의 지도가 준비되기 전에 사용하는 빈 지도. 모든 수면을 깊은 바다로 취급한다. */
function createEmptyShoreMap(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
  texture.needsUpdate = true;
  return texture;
}

export function createOceanMaterial({
  sky,
  detailNormals,
  sunDirection,
  wake,
  hazeDistance,
  cascades,
  detailDisplaceRange,
}: OceanMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: {
      DETAIL_DISPLACE_RANGE: detailDisplaceRange.toFixed(1),
      DETAIL_CELL_SIZE: OCEAN_CELL_SIZE.toFixed(3),
      DETAIL_TEXELS: GRID_SIZE.toFixed(1),
    },
    uniforms: {
      uTime: { value: 0 },
      uHazeDistance: { value: hazeDistance },
      uRippleStrength: { value: 1 },
      uBreakingSteepness: { value: BREAKING_STEEPNESS },
      uWindDirection: { value: new THREE.Vector2(0, -1) },
      uSpindrift: { value: 0 },
      uSunDirection: { value: sunDirection },
      uSunColor: { value: new THREE.Color(1.0, 0.86, 0.66).multiplyScalar(30) },
      uSunLight: { value: new THREE.Color(1, 1, 1) },
      uDeepColor: { value: new THREE.Color(0.012, 0.085, 0.16) },
      uShallowColor: { value: new THREE.Color(0.03, 0.34, 0.33) },
      uScatterColor: { value: new THREE.Color(0.0, 0.055, 0.05) },
      uShoreMap: { value: createEmptyShoreMap() },
      uShoreBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      uSky: { value: sky },
      uDetailNormals: { value: detailNormals },
      uSeaDisplacement: { value: cascades[0].displacement },
      uDetailDisplacement: { value: cascades[1].displacement },
      uSeaGradient: { value: cascades[0].gradient },
      uDetailGradientLarge: { value: cascades[1].gradient },
      uDetailGradientSmall: { value: cascades[2].gradient },
      uSeaTile: { value: new THREE.Vector3(cascades[0].tileSize, cascades[1].tileSize, cascades[2].tileSize) },
      uWakeMap: { value: wake.texture },
      uWakeCenter: { value: wake.center },
      uWakeHalfExtent: { value: wake.halfExtent },
    },
    vertexShader,
    fragmentShader,
  });
}
