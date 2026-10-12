import * as THREE from 'three';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 20000);

  const resize = () => {
    const { innerWidth: width, innerHeight: height } = window;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera };
}
