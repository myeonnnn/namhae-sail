import * as THREE from 'three';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * 화면의 아래쪽이 표시 장치에 가려지는 높이(픽셀)를 지정한다.
   * 카메라가 바라보는 중심을 가려지지 않은 영역의 가운데로 옮겨서, 배가 표시 장치에 가려지지 않게 한다.
   */
  setBottomInset(pixels: number): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  };
}
