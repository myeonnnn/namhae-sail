import * as THREE from 'three';
import { ResolutionGovernor } from './resolutionGovernor';

// 장면을 그리는 해상도의 상한 (CSS 픽셀에 대한 배율). 화면의 배율이 이보다 높아도 이 값까지만 그린다.
const MAX_PIXEL_RATIO = 2;

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * 화면의 아래쪽이 표시 장치에 가려지는 높이(픽셀)를 지정한다.
   * 카메라가 바라보는 중심을 가려지지 않은 영역의 가운데로 옮겨서, 배가 표시 장치에 가려지지 않게 한다.
   */
  setBottomInset(pixels: number): void;
  /**
   * 한 프레임에 걸린 시간(초)을 알려 준다. 프레임이 느린 상태가 이어지면 그리는 해상도를 낮추고, 여유가 생기면 다시 올린다.
   * 자료를 불러오는 동안처럼 프레임 시간이 장면의 부담을 나타내지 않을 때에는 호출하지 않는다.
   */
  adaptResolution(frameTime: number): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  // 다중 표본 안티에일리어싱(MSAA)은 화면의 배율이 낮을 때에만 켠다.
  // 배율이 2인 화면에서는 픽셀이 촘촘해서 계단 현상이 거의 보이지 않는데, 표본을 네 배로 저장하고 합치는 비용은 픽셀의 수만큼 커진다.
  // 1728x1117 크기의 창에서 재 보면 이 비용이 한 프레임에 GPU가 쓰는 시간의 3분의 1을 차지했다.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: pixelRatio < 2 });
  renderer.setPixelRatio(pixelRatio);
  const governor = new ResolutionGovernor(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 20000);

  let bottomInset = 0;
  const resize = () => {
    const { innerWidth: width, innerHeight: height } = window;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    // 전체 화면과 같은 크기의 영역을 아래로 절반만큼 내려서 잘라 내면, 장면 전체가 위로 올라가서 그려진다.
    camera.setViewOffset(width, height, 0, Math.round(bottomInset / 2), width, height);
  };
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    scene,
    camera,
    setBottomInset(pixels) {
      bottomInset = pixels;
      resize();
    },
    adaptResolution(frameTime) {
      const ratio = governor.update(frameTime);
      if (ratio !== undefined) renderer.setPixelRatio(ratio);
    },
  };
}
