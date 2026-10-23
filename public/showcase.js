import * as THREE from "/vendor/three.module.js";
import { GLTFLoader } from "/vendor/three-examples/loaders/GLTFLoader.js";

const modelScales = [0.01, 0.01, 0.005, 0.01, 0.01, 0.01];

export async function renderShowcase(canvas, contributions, playerList) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf5f2e9);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f2e9);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  camera.position.set(0, 3.2, 8);
  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9d988d, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(4, 8, 5);
  scene.add(keyLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0xe8e3d8, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  if (playerList) {
    playerList.replaceChildren();
    if (!contributions.length) {
      const item = document.createElement("li");
      item.textContent = "No furniture was placed this round.";
      playerList.append(item);
    }
    for (const contribution of contributions) {
      const item = document.createElement("li");
      item.textContent = `${contribution.playerName}: ${contribution.objects.length} ${contribution.objects.length === 1 ? "object" : "objects"}`;
      playerList.append(item);
    }
  }

  const loader = new GLTFLoader();
  const loadingModels = new Map();
  const loadModel = (index) => {
    if (!loadingModels.has(index)) {
      loadingModels.set(index, loader.loadAsync(
        `/ar-assets/glbs/${encodeURIComponent(modelFiles[index])}`,
      ));
    }
    return loadingModels.get(index);
  };
  for (let playerIndex = 0; playerIndex < contributions.length; playerIndex += 1) {
    const contribution = contributions[playerIndex];
    const playerGroup = new THREE.Group();
    await Promise.all(contribution.objects.map(async (entry, objectIndex) => {
      if (!Number.isInteger(entry.modelIndex) || !modelScales[entry.modelIndex]) {
        throw new Error("A saved object uses an unknown furniture model.");
      }
      const gltf = await loadModel(entry.modelIndex);
      const object = gltf.scene.clone(true);
      object.scale.setScalar(modelScales[entry.modelIndex] * entry.scale);
      if (Array.isArray(entry.position) && Array.isArray(entry.quaternion)) {
        object.position.fromArray(entry.position);
        object.quaternion.fromArray(entry.quaternion).normalize();
      } else {
        object.position.set(objectIndex * 1.25, 0, 0);
      }
      playerGroup.add(object);
    }));
    playerGroup.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(playerGroup);
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3());
      playerGroup.position.set(-center.x, -bounds.min.y, -center.z);
    }
    group.add(playerGroup);
  }
  group.updateMatrixWorld(true);
  const sceneBounds = new THREE.Box3().setFromObject(group);
  if (!sceneBounds.isEmpty()) {
    const center = sceneBounds.getCenter(new THREE.Vector3());
    const size = sceneBounds.getSize(new THREE.Vector3());
    const distance = Math.max(5, size.x * 0.9, size.y * 1.5, size.z * 1.1);
    camera.position.set(center.x + distance * 0.2, center.y + distance * 0.45, center.z + distance);
    camera.lookAt(center);
    floor.position.set(center.x, sceneBounds.min.y - 0.02, center.z);
  }

  let width = 0;
  let height = 0;
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height || (width === bounds.width && height === bounds.height)) return;
    width = bounds.width;
    height = bounds.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const activePointers = new Map();
  let pointerX = null;
  let pinchDistance = null;
  const onPointerDown = (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
    if (activePointers.size === 2) {
      const [first, second] = activePointers.values();
      pinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
    }
  };
  const onPointerMove = (event) => {
    if (pointerX === null) return;
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (activePointers.size === 2) {
      const [first, second] = activePointers.values();
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (pinchDistance !== null) {
        camera.position.z = THREE.MathUtils.clamp(camera.position.z + (pinchDistance - distance) * 0.025, 3, 18);
        camera.lookAt(0, 0.6, 0);
      }
      pinchDistance = distance;
      return;
    }
    group.rotation.y += (event.clientX - pointerX) * 0.008;
    pointerX = event.clientX;
  };
  const onPointerUp = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinchDistance = null;
    pointerX = activePointers.size === 1
      ? activePointers.values().next().value.x
      : null;
  };
  const onWheel = (event) => {
    event.preventDefault();
    camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.008, 3, 18);
    camera.lookAt(0, 0.6, 0);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frameId;
  const render = () => {
    resize();
    renderer.render(scene, camera);
    frameId = window.requestAnimationFrame(render);
  };
  render();

  return () => {
    window.cancelAnimationFrame(frameId);
    observer.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    renderer.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    const geometries = new Set();
    const materials = new Set();
    group.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  };
}

const modelFiles = [
  "dylan_armchair_yolk_yellow.glb",
  "ivan_armchair_mineral_blue.glb",
  "marble_coffee_table.glb",
  "flippa_functional_coffee_table_w._storagewalnut.glb",
  "frame_armchairpetrol_velvet_with_gold_frame.glb",
  "elnaz_nesting_side_tables_brass__green_marble.glb",
];
