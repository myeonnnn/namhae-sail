import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOceanGeometry, OCEAN_CELL_SIZE } from './oceanGeometry';
import { createOceanMaterial } from './oceanMaterial';
import type { Wake } from './wake';
import { createWaterNormals } from './waterNormals';

const SUN_ELEVATION_DEG = 20;
const SUN_AZIMUTH_DEG = 60;
const SKY_CUBE_SIZE = 256;
// 이 거리에서 물체의 색상이 약 63%만큼 수평선의 색상으로 바뀐다.
const HAZE_DISTANCE = 9000;
// 수평선 부근 하늘의 평균적인 색상. 지형과 같은 일반 물체가 먼 곳에서 이 색상으로 흐려진다.
const HAZE_COLOR = 0xc3d0db;

/** 수면, 하늘, 태양광을 묶어서 관리한다. 수면과 하늘은 배와 카메라를 따라 이동하므로 끝이 보이지 않는다. */
export class Ocean {
  readonly sunDirection = new THREE.Vector3();
  private readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly sky = new Sky();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, wake: Wake) {
    this.sunDirection.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG),
      THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG),
    );

    this.sky.scale.setScalar(10000);
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    skyUniforms['sunPosition'].value.copy(this.sunDirection);

    // 하늘을 두 가지 형태로 미리 구워 둔다.
    // 큐브 맵은 수면이 반사할 하늘로 사용하고, PMREM은 선체의 PBR 머티리얼이 받는 환경광으로 사용한다.
    // 태양 원반은 지나치게 밝아서 반사에 얼룩을 만들기 때문에 굽는 동안에는 숨기고, 태양의 반사는 셰이더에서 따로 계산한다.
    const environmentScene = new THREE.Scene();
    environmentScene.add(this.sky);
    skyUniforms['showSunDisc'].value = 0;

    const skyCube = new THREE.WebGLCubeRenderTarget(SKY_CUBE_SIZE, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    new THREE.CubeCamera(1, 20000, skyCube).update(renderer, environmentScene);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(environmentScene).texture;
    pmrem.dispose();

    skyUniforms['showSunDisc'].value = 1;
    scene.add(this.sky);

    this.surface = new THREE.Mesh(
      createOceanGeometry(),
      createOceanMaterial({
        sky: skyCube.texture,
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
    scene.fog = new THREE.FogExp2(HAZE_COLOR, 1 / HAZE_DISTANCE);

    const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.5);
    sunLight.position.copy(this.sunDirection).multiplyScalar(100);
    scene.add(sunLight);
  }

  /** elapsed는 부력 계산과 동일한 시계여야 화면의 파도와 배의 움직임이 일치한다. */
  update(elapsed: number, focusX: number, focusZ: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    const { uniforms } = this.surface.material;
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
