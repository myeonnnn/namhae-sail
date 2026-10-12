import * as THREE from 'three';
import { WAVES } from './waves';

const waveUniforms = /* glsl */ `
  uniform float uTime;
  // (진행 방향 x, 진행 방향 z, 파수, 진폭)
  uniform vec4 uWaveShape[WAVE_COUNT];
  // (각진동수, 마루의 뾰족한 정도, 파장, 미사용)
  uniform vec4 uWaveMotion[WAVE_COUNT];
`;

const vertexShader = /* glsl */ `
  ${waveUniforms}

  varying vec2 vBasePosition;
  varying vec3 vWorldPosition;

  void main() {
    vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;
    float gridDistance = length(position.xz);
    vec3 displaced = base;

    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 shape = uWaveShape[i];
      vec4 motion = uWaveMotion[i];
      // 격자가 성긴 먼 곳에서는 파장이 짧은 파도를 형태로 표현할 수 없으므로 높이를 줄인다.
      float amplitude = shape.w * (1.0 - smoothstep(4.0 * motion.z, 7.0 * motion.z, gridDistance));
      float theta = shape.z * dot(shape.xy, base.xz) - motion.x * uTime;
      displaced.xz += motion.y * amplitude * shape.xy * cos(theta);
      displaced.y += amplitude * sin(theta);
    }

    vBasePosition = base.xz;
    vWorldPosition = displaced;
    gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  ${waveUniforms}

  // 픽셀 하나가 차지하는 시야각 (rad)
  uniform float uPixelAngle;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uDeepColor;
  uniform vec3 uScatterColor;
  uniform samplerCube uSky;
  uniform sampler2D uDetailNormals;
  uniform sampler2D uWakeMap;
  uniform vec2 uWakeCenter;
  uniform float uWakeHalfExtent;

  varying vec2 vBasePosition;
  varying vec3 vWorldPosition;

  void main() {
    vec3 toCamera = cameraPosition - vWorldPosition;
    float cameraDistance = length(toCamera);
    vec3 viewDirection = toCamera / cameraDistance;
    // 한 픽셀이 수면에서 덮는 길이 (m). 수면을 비스듬하게 볼수록 시선 방향으로 길게 늘어난다.
    float footprint = cameraDistance * uPixelAngle / max(viewDirection.y, 0.02);

    // 수면의 기울기는 정점이 아니라 픽셀마다 파도의 수식을 미분해서 구한다.
    // 따라서 격자가 성긴 곳에서도 빛의 반사는 세밀하게 표현된다.
    vec2 slope = vec2(0.0);
    float pinch = 0.0;
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 shape = uWaveShape[i];
      vec4 motion = uWaveMotion[i];
      // 한 픽셀이 파장의 절반 이상을 덮으면 그 파도를 구분해서 그릴 수 없고 줄무늬만 생기므로 제외한다.
      float steepness = shape.z * shape.w * (1.0 - smoothstep(0.12 * motion.z, 0.45 * motion.z, footprint));
      float theta = shape.z * dot(shape.xy, vBasePosition) - motion.x * uTime;
      slope += shape.xy * steepness * cos(theta);
      pinch += motion.y * steepness * sin(theta);
    }

    // 파도의 수식으로 표현하지 않는 잔물결은 서로 다른 크기와 속도로 흐르는 노멀 맵 세 장으로 보탠다.
    vec2 rippleLarge = texture2D(uDetailNormals, vBasePosition / 61.0 + uTime * vec2(0.006, 0.004)).xy * 2.0 - 1.0;
    vec2 rippleMedium = texture2D(uDetailNormals, vBasePosition / 23.0 + uTime * vec2(-0.011, 0.008)).xy * 2.0 - 1.0;
    vec2 rippleSmall = texture2D(uDetailNormals, vBasePosition / 7.3 + uTime * vec2(0.017, -0.021)).xy * 2.0 - 1.0;
    float rippleFade = 1.0 - smoothstep(300.0, 4000.0, cameraDistance);
    vec2 ripple = (rippleLarge * 0.22 + rippleMedium * 0.16 + rippleSmall * 0.1) * rippleFade;

    vec3 normal = normalize(vec3(-slope.x - ripple.x, 1.0 - pinch, -slope.y - ripple.y));

    // 프레넬: 수면을 비스듬하게 볼수록 하늘이 많이 반사되고, 수직으로 내려다볼수록 물속의 색이 보인다.
    float facing = max(dot(normal, viewDirection), 0.0);
    float fresnel = 0.02 + 0.73 * pow(1.0 - facing, 5.0);

    vec3 reflected = reflect(-viewDirection, normal);
    reflected.y = max(reflected.y, 0.03);
    vec3 skyReflection = textureCube(uSky, normalize(reflected), 1.5).rgb;

    float sunFacing = max(dot(normal, uSunDirection), 0.0);
    // 마루 부분은 물이 얇아서 빛이 투과하므로 청록색을 더한다.
    float crest = smoothstep(-0.3, 2.2, vWorldPosition.y);
    vec3 body = uDeepColor * (0.55 + 0.9 * sunFacing) + uScatterColor * crest;

    // 항적 지도에서 이 지점의 물거품 세기를 읽는다. 지도의 범위 밖은 0으로 취급한다.
    vec2 wakeUv = (vWorldPosition.xz - uWakeCenter) / (2.0 * uWakeHalfExtent) + 0.5;
    vec2 wakeInside = step(vec2(0.0), wakeUv) * step(wakeUv, vec2(1.0));
    float wake = texture2D(uWakeMap, wakeUv).r * wakeInside.x * wakeInside.y;
    // 공기 방울이 섞인 물은 밝은 청록색으로 보인다.
    body += uScatterColor * wake * 1.6;

    vec3 halfVector = normalize(viewDirection + uSunDirection);
    float sunGlint = pow(max(dot(normal, halfVector), 0.0), 500.0);

    vec3 color = mix(body, skyReflection, fresnel) + uSunColor * sunGlint;

    // 마루가 뾰족하게 접히는 곳에 흰 물거품을 얹는다.
    float foamNoise = rippleMedium.x * rippleSmall.y + 0.5 * rippleLarge.y;
    float foam = smoothstep(0.3, 0.46, pinch + 0.12 * foamNoise) * rippleFade;
    foam *= smoothstep(-0.15, 0.25, rippleSmall.x + rippleMedium.y);

    // 항적의 물거품은 세기가 약해질수록 잔물결의 무늬를 따라 듬성듬성하게 끊어진다.
    float wakeNoise = 0.5 + 0.5 * clamp(rippleMedium.x * 0.7 + rippleSmall.y * 0.7 + rippleLarge.x * 0.4, -1.0, 1.0);
    float wakeFoam = smoothstep(1.0 - wake, 1.35 - wake, wakeNoise) * step(0.01, wake);
    foam = max(foam, wakeFoam);
    color = mix(color, vec3(0.85, 0.9, 0.92) * (0.5 + 0.6 * sunFacing), foam * 0.75);

    // 먼 수면을 그 방향의 수평선 색상으로 수렴시켜서 바다의 끝과 하늘의 경계를 감춘다.
    vec3 horizonColor = textureCube(uSky, normalize(vec3(-viewDirection.x, 0.03, -viewDirection.z)), 1.5).rgb;
    float haze = 1.0 - exp(-pow(cameraDistance / 7000.0, 2.0));
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
  sunDirection: THREE.Vector3;
}

export function createOceanMaterial({
  sky,
  detailNormals,
  sunDirection,
  wake,
}: OceanMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { WAVE_COUNT: WAVES.length },
    uniforms: {
      uTime: { value: 0 },
      uWaveShape: { value: WAVES.map((w) => new THREE.Vector4(w.dirX, w.dirZ, w.k, w.amplitude)) },
      uWaveMotion: { value: WAVES.map((w) => new THREE.Vector4(w.omega, w.q, w.wavelength, 0)) },
      uPixelAngle: { value: 0.0015 },
      uSunDirection: { value: sunDirection },
      uSunColor: { value: new THREE.Color(1.0, 0.86, 0.66).multiplyScalar(30) },
      uDeepColor: { value: new THREE.Color(0.004, 0.034, 0.062) },
      uScatterColor: { value: new THREE.Color(0.0, 0.09, 0.085) },
      uSky: { value: sky },
      uDetailNormals: { value: detailNormals },
      uWakeMap: { value: wake.texture },
      uWakeCenter: { value: wake.center },
      uWakeHalfExtent: { value: wake.halfExtent },
    },
    vertexShader,
    fragmentShader,
  });
}
