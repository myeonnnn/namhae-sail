import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOceanGeometry, OCEAN_CELL_SIZE } from './oceanGeometry';
import { createOceanMaterial } from './oceanMaterial';
import type { Wake } from './wake';
import { WAVES } from './waves';
import { sunlight, type SunPosition } from '../environment/sun';
import type { Wind } from '../environment/wind';
import { createWaterNormals } from './waterNormals';

// 강풍에 날리는 물보라가 보이기 시작하는 풍속과 가장 짙어지는 풍속 (m/s)
const SPINDRIFT_WIND = [13, 30] as const;
const SKY_CUBE_SIZE = 256;
// 이 거리에서 물체의 색상이 약 63%만큼 수평선의 색상으로 바뀐다.
const HAZE_DISTANCE = 9000;
// 수평선 부근 하늘의 색상. 지형과 같은 일반 물체가 먼 곳에서 이 색상으로 흐려지며, 태양의 고도에 따라 섞어서 사용한다.
const HAZE_DAY = new THREE.Color(0xc3d0db);
const HAZE_DUSK = new THREE.Color(0xd8b396);
const HAZE_NIGHT = new THREE.Color(0x141c28);
// 태양이 머리 위에 있을 때의 직사광의 세기
const SUN_INTENSITY = 3.2;
// 수면의 셰이더에서 태양의 반짝임에 곱하는 배율
const GLINT_SCALE = 12;
// 그림자를 계산하는 영역의 절반 크기 (m). 배 한 척을 덮는 크기이다.
const SHADOW_EXTENT = 140;
const SHADOW_DISTANCE = 450;
// 조절 막대를 움직이는 동안 하늘을 매 프레임 다시 굽지 않도록 간격을 둔다.
const SKY_REBAKE_INTERVAL_MS = 120;

/** 수면, 하늘, 태양광을 묶어서 관리한다. 수면과 하늘은 배와 카메라를 따라 이동하므로 끝이 보이지 않는다. */
export class Ocean {
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  private readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly sky = new Sky();
  private readonly sunLight = new THREE.DirectionalLight();
  private readonly fog = new THREE.FogExp2(HAZE_DAY, 1 / HAZE_DISTANCE);
  // 하늘을 굽는 전용 장면. 화면에 보이는 하늘과 머티리얼을 공유하므로 태양의 위치가 항상 일치한다.
  private readonly bakeScene = new THREE.Scene();
  private readonly skyCube = new THREE.WebGLCubeRenderTarget(SKY_CUBE_SIZE, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  private readonly cubeCamera = new THREE.CubeCamera(1, 20000, this.skyCube);
  private readonly pmrem: THREE.PMREMGenerator;
  private environmentTarget?: THREE.WebGLRenderTarget;
  private appliedSunKey = '';
  private lastBakeTime = -Infinity;
  private bakePending = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    wake: Wake,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sky.scale.setScalar(10000);
    const skyUniforms = this.sky.material.uniforms;
    // 맑은 날의 대기에 가까운 값이다. 탁도와 산란을 높이면 하늘이 뿌옇고 채도가 과하게 표현된다.
    skyUniforms['turbidity'].value = 4;
    skyUniforms['rayleigh'].value = 1.2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    // 하늘의 셰이더는 대기의 산란을 픽셀마다 계산해서 장면에서 가장 무겁다.
    // 다른 물체보다 먼저 그리면 수면과 지형에 가려질 픽셀까지 모두 계산하게 되므로, 가장 나중에 그려서 비어 있는 픽셀만 채운다.
    // Sky는 정점의 깊이를 가장 먼 값으로 고정하므로, 이미 그려진 물체가 있는 픽셀은 깊이 검사에서 걸러진다.
    this.sky.renderOrder = 1;
    scene.add(this.sky);

    const bakeSky = new Sky();
    bakeSky.material = this.sky.material;
    bakeSky.scale.setScalar(10000);
    this.bakeScene.add(bakeSky);

    this.surface = new THREE.Mesh(
      createOceanGeometry(),
      createOceanMaterial({
        sky: this.skyCube.texture,
        detailNormals: createWaterNormals(),
        sunDirection: this.sunDirection,
        wake,
        hazeDistance: HAZE_DISTANCE,
      }),
    );
    // 정점을 셰이더에서 이동시키므로 Three.js가 계산한 경계 상자로는 화면 밖 여부를 판정할 수 없다.
    this.surface.frustumCulled = false;
    scene.add(this.surface);

    // FogExp2의 감쇠 수식은 수면의 셰이더가 사용하는 수식과 동일하므로, 밀도를 맞추면 바다와 육지가 같은 거리에서 함께 흐려진다.
    scene.fog = this.fog;

    // 그림자는 태양의 위치에서 장면을 내려다본 깊이 지도로 계산한다.
    // 지도 한 장으로 넓은 범위를 덮으면 해상도가 부족해지므로, 배 주변만 덮고 배를 따라 이동시킨다.
    const { shadow } = this.sunLight;
    this.sunLight.castShadow = true;
    shadow.mapSize.set(2048, 2048);
    shadow.camera.left = -SHADOW_EXTENT;
    shadow.camera.right = SHADOW_EXTENT;
    shadow.camera.top = SHADOW_EXTENT;
    shadow.camera.bottom = -SHADOW_EXTENT;
    shadow.camera.near = 10;
    shadow.camera.far = SHADOW_DISTANCE * 2;
    shadow.bias = -0.0005;
    shadow.normalBias = 0.6;
    scene.add(this.sunLight, this.sunLight.target);
  }

  /**
   * 태양의 위치를 반영한다. 직사광의 방향과 색상, 수면의 반짝임, 먼 곳의 연무 색상을 갱신하고,
   * 수면이 반사할 하늘과 선체가 받는 환경광을 다시 굽는다.
   */
  setSun(position: SunPosition): void {
    const key = `${position.x.toFixed(4)},${position.y.toFixed(4)},${position.z.toFixed(4)}`;
    if (key === this.appliedSunKey) return;
    this.appliedSunKey = key;

    this.sunDirection.set(position.x, position.y, position.z);
    this.sky.material.uniforms['sunPosition'].value.copy(this.sunDirection);

    const { color, strength } = sunlight(position.elevationDeg);
    this.sunLight.color.setRGB(color[0], color[1], color[2]);
    this.sunLight.intensity = SUN_INTENSITY * strength;
    (this.surface.material.uniforms['uSunColor'].value as THREE.Color)
      .setRGB(color[0], color[1], color[2])
      .multiplyScalar(SUN_INTENSITY * strength * GLINT_SCALE);

    // 낮에는 푸른 회색, 해가 낮을 때에는 따뜻한 색, 해가 진 뒤에는 어두운 색으로 연무의 색상을 바꾼다.
    this.fog.color
      .copy(HAZE_DUSK)
      .lerp(HAZE_DAY, THREE.MathUtils.smoothstep(position.elevationDeg, 2, 25))
      .lerp(HAZE_NIGHT, 1 - THREE.MathUtils.smoothstep(position.elevationDeg, -6, 4));

    this.bakePending = true;
  }

  /**
   * 하늘을 두 가지 형태로 굽는다.
   * 큐브 맵은 수면이 반사할 하늘로 사용하고, PMREM은 선체와 지형의 PBR 머티리얼이 받는 환경광으로 사용한다.
   * 태양 원반은 지나치게 밝아서 반사에 얼룩을 만들기 때문에 굽는 동안에는 숨기고, 태양의 반사는 셰이더에서 따로 계산한다.
   */
  private bakeSky(): void {
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['showSunDisc'].value = 0;
    this.cubeCamera.update(this.renderer, this.bakeScene);

    const previous = this.environmentTarget;
    this.environmentTarget = this.pmrem.fromScene(this.bakeScene);
    this.scene.environment = this.environmentTarget.texture;
    previous?.dispose();
    skyUniforms['showSunDisc'].value = 1;
  }

  /** elapsed는 부력 계산과 동일한 시계여야 화면의 파도와 배의 움직임이 일치한다. */
  update(
    elapsed: number,
    focusX: number,
    focusZ: number,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
    wind: Wind,
  ): void {
    const now = performance.now();
    if (this.bakePending && now - this.lastBakeTime >= SKY_REBAKE_INTERVAL_MS) {
      this.bakePending = false;
      this.lastBakeTime = now;
      this.bakeSky();
    }

    // 그림자를 계산하는 영역이 배를 따라 이동하도록, 광원과 그 목표 지점을 함께 옮긴다.
    this.sunLight.target.position.set(focusX, 0, focusZ);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(SHADOW_DISTANCE).add(this.sunLight.target.position);

    const { uniforms } = this.surface.material;
    // 바람에 따라 갱신된 파도의 목록을 셰이더에 전달한다.
    WAVES.forEach((wave, i) => {
      (uniforms['uWaveShape'].value as THREE.Vector4[])[i].set(wave.dirX, wave.dirZ, wave.k, wave.amplitude);
      (uniforms['uWaveMotion'].value as THREE.Vector4[])[i].set(wave.omega, wave.q, wave.wavelength, 0);
    });
    // 바람이 없으면 잔물결이 사라져서 수면이 거울처럼 매끄러워진다.
    uniforms['uRippleStrength'].value = 0.15 + 0.85 * THREE.MathUtils.smoothstep(wind.speed, 0, 9);
    // 풍향은 불어오는 쪽이므로, 물보라는 그 반대쪽으로 날린다. 초속 13m 부근부터 보이기 시작한다.
    const toward = THREE.MathUtils.degToRad(wind.fromDeg + 180);
    (uniforms['uWindDirection'].value as THREE.Vector2).set(Math.sin(toward), -Math.cos(toward));
    uniforms['uSpindrift'].value = THREE.MathUtils.smoothstep(wind.speed, SPINDRIFT_WIND[0], SPINDRIFT_WIND[1]);
    uniforms['uTime'].value = elapsed;
    uniforms['uPixelAngle'].value = THREE.MathUtils.degToRad(camera.fov) / viewportHeight;
    // 파도는 월드 좌표를 기준으로 계산되므로 격자를 옮겨도 파도가 따라 움직이지 않는다.
    // 다만 격자를 연속적으로 옮기면 정점이 파도를 읽는 위치가 매 프레임 달라져서 수면이 일렁이므로, 칸 단위로만 옮긴다.
    this.surface.position.set(
      Math.round(focusX / OCEAN_CELL_SIZE) * OCEAN_CELL_SIZE,
      0,
      Math.round(focusZ / OCEAN_CELL_SIZE) * OCEAN_CELL_SIZE,
    );
    this.sky.position.copy(camera.position);
  }
}
