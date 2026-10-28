import * as THREE from "/vendor/three.module.js";
import { createPrimitive, primitives } from "/primitives.js";

export async function renderShowcase(canvas, contributions, playerList) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf5f2e9);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f2e9);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 100);
  camera.position.set(0, 3.2, 8);
  const target = new THREE.Vector3();
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
      item.textContent = "No shapes were placed this round.";
      playerList.append(item);
    }
    for (const contribution of contributions) {
      const item = document.createElement("li");
      item.textContent = `${contribution.playerName}: ${contribution.objects.length} ${contribution.objects.length === 1 ? "object" : "objects"}`;
      playerList.append(item);
    }
  }

  for (let playerIndex = 0; playerIndex < contributions.length; playerIndex += 1) {
    const contribution = contributions[playerIndex];
    const playerGroup = new THREE.Group();
    contribution.objects.forEach((entry, objectIndex) => {
      if (!Number.isInteger(entry.modelIndex) || !primitives[entry.modelIndex]) {
        throw new Error("A saved object uses an unknown primitive.");
      }
      const object = createPrimitive(entry.modelIndex);
      object.scale.setScalar(entry.scale);
      if (Array.isArray(entry.position) && Array.isArray(entry.quaternion)) {
        object.position.fromArray(entry.position);
        object.quaternion.fromArray(entry.quaternion).normalize();
      } else {
        object.position.set(objectIndex * 1.25, 0, 0);
      }
      playerGroup.add(object);
    });
    playerGroup.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(playerGroup);
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3());
      const usesPlayerOrigin = contribution.placementSpace === "player-origin";
      playerGroup.position.set(
        usesPlayerOrigin ? 0 : -center.x,
        -bounds.min.y,
        usesPlayerOrigin ? 0 : -center.z,
      );
    }
    group.add(playerGroup);
  }
  group.updateMatrixWorld(true);
  const sceneBounds = new THREE.Box3().setFromObject(group);
  if (!sceneBounds.isEmpty()) {
    target.copy(sceneBounds.getCenter(new THREE.Vector3()));
    const size = sceneBounds.getSize(new THREE.Vector3());
    const distance = Math.max(5, size.x * 0.9, size.y * 1.5, size.z * 1.1);
    camera.position.set(target.x + distance * 0.2, target.y + distance * 0.45, target.z + distance);
    camera.lookAt(target);
    floor.position.set(target.x, sceneBounds.min.y - 0.02, target.z);
  }

  const zoomInButton = canvas.parentElement.querySelector("[data-zoom-in]");
  const zoomOutButton = canvas.parentElement.querySelector("[data-zoom-out]");
  const zoomBy = (factor) => {
    const offset = camera.position.clone().sub(target).multiplyScalar(factor);
    const distance = THREE.MathUtils.clamp(offset.length(), 0.8, 80);
    camera.position.copy(target).add(offset.setLength(distance));
    camera.lookAt(target);
  };
  const onZoomIn = () => zoomBy(0.8);
  const onZoomOut = () => zoomBy(1.25);
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
        zoomBy(pinchDistance / distance);
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
    zoomBy(Math.exp(event.deltaY * 0.001));
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  zoomInButton.addEventListener("click", onZoomIn);
  zoomOutButton.addEventListener("click", onZoomOut);
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
    zoomInButton.removeEventListener("click", onZoomIn);
    zoomOutButton.removeEventListener("click", onZoomOut);
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
