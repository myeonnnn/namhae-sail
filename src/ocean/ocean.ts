import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { createWaterNormals } from './waterNormals';

const WATER_SIZE = 40000;
const SUN_ELEVATION_DEG = 20;
const SUN_AZIMUTH_DEG = 60;
const WATER_PATTERN_SCALE = 3.0;

/** 수면, 하늘, 태양광을 묶어서 관리한다. 수면과 하늘은 카메라를 따라 이동하므로 끝이 보이지 않는다. */
export class Ocean {
  readonly sunDirection = new THREE.Vector3();
  private readonly water: Water;
  private readonly sky = new Sky();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.sunDirection.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG),
      THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG),
    );

    this.water = new Water(new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE), {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: createWaterNormals(),
      sunDirection: this.sunDirection,
      sunColor: 0xffffff,
      waterColor: 0x0b2b3c,
      distortionScale: 3.7,
    });
    this.water.material.uniforms['size'].value = WATER_PATTERN_SCALE;
    this.water.rotation.x = -Math.PI / 2;
    scene.add(this.water);

    this.sky.scale.setScalar(10000);
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    skyUniforms['sunPosition'].value.copy(this.sunDirection);
    scene.add(this.sky);

    // 하늘을 환경 맵으로 변환해서 선체의 PBR 머티리얼이 하늘빛을 반사하도록 한다.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentScene = new THREE.Scene();
    const environmentSky = this.sky.clone();
    environmentScene.add(environmentSky);
    scene.environment = pmrem.fromScene(environmentScene).texture;
    pmrem.dispose();

    const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.5);
    sunLight.position.copy(this.sunDirection).multiplyScalar(100);
    scene.add(sunLight);
  }

  update(frameTime: number, camera: THREE.Camera): void {
    this.water.material.uniforms['time'].value += frameTime * 0.6;
    // 물결 무늬는 월드 좌표를 기준으로 샘플링되므로 평면을 옮겨도 무늬가 따라 움직이지 않는다.
    this.water.position.set(camera.position.x, 0, camera.position.z);
    this.sky.position.copy(camera.position);
  }
}
