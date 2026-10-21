import * as THREE from "/vendor/three.module.js";

const objectStyles = [
  { color: 0xf05d43, geometry: () => new THREE.IcosahedronGeometry(0.13, 0) },
  { color: 0xf2c84b, geometry: () => new THREE.TorusGeometry(0.15, 0.045, 10, 28) },
  { color: 0x6b91a3, geometry: () => new THREE.SphereGeometry(0.12, 20, 16) },
  { color: 0x9c83ab, geometry: () => new THREE.ConeGeometry(0.12, 0.24, 7) },
];

export async function enterAR({ overlay, prompt, exitButton }) {
  const supportsAR = await navigator.xr?.isSessionSupported("immersive-ar").catch(() => false);
  if (!supportsAR) {
    throw new Error("AR isn't available here. Try a WebXR-compatible phone browser over HTTPS.");
  }

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.domElement.className = "ar-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x71634b, 2));

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.095, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  reticle.rotation.x = -Math.PI / 2;
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  const raycaster = new THREE.Raycaster();
  scene.add(controller);

  const objects = new Set();
  let selectedObject;
  let dragging = false;
  let dragOffset = new THREE.Vector3();
  let hitTestSource;
  let session;
  let closed = false;
  let nextStyle = 0;
  const dragPlane = new THREE.Plane();
  const cameraDirection = new THREE.Vector3();
  const intersection = new THREE.Vector3();

  function setSelection(object) {
    if (selectedObject) selectedObject.traverse((part) => {
      if (part.isMesh) part.material.emissive?.setHex(0x000000);
    });
    selectedObject = object;
    if (selectedObject) selectedObject.traverse((part) => {
      if (part.isMesh) part.material.emissive?.setHex(0x282828);
    });
    controlsHint.textContent = selectedObject
      ? "Selected. Drag to move, or use the size buttons."
      : "Aim at a surface and tap to place. Tap an object to select and drag.";
  }

  function addObject(position, quaternion) {
    const style = objectStyles[nextStyle % objectStyles.length];
    nextStyle += 1;
    const material = new THREE.MeshStandardMaterial({
      color: style.color,
      roughness: 0.45,
      metalness: 0.05,
    });
    const object = new THREE.Mesh(style.geometry(), material);
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    object.userData.arObject = object;
    object.castShadow = false;
    scene.add(object);
    objects.add(object);
    setSelection(object);
    return object;
  }

  function raycastFromController() {
    raycaster.setFromXRController(controller);
    return raycaster;
  }

  function selectOrPlace() {
    const intersections = raycastFromController().intersectObjects(Array.from(objects), true);
    if (intersections.length) {
      setSelection(intersections[0].object.userData.arObject);
      dragging = true;
      camera.getWorldDirection(cameraDirection);
      dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, selectedObject.position);
      if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        dragOffset.copy(selectedObject.position).sub(intersection);
      }
      return;
    }

    if (reticle.visible) {
      const pose = new THREE.Matrix4().copy(reticle.matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(pose);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(pose);
      addObject(position, quaternion);
    }
  }

  function updateDrag() {
    if (!dragging || !selectedObject) return;
    raycastFromController();
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      selectedObject.position.copy(intersection).add(dragOffset);
    }
  }

  function endDrag() {
    dragging = false;
  }

  function scaleSelected(factor) {
    if (!selectedObject) {
      controlsHint.textContent = "Tap an object to select it before changing its size.";
      return;
    }
    selectedObject.scale.multiplyScalar(factor);
    const scale = THREE.MathUtils.clamp(selectedObject.scale.x, 0.35, 3);
    selectedObject.scale.setScalar(scale);
  }

  function addAtReticle() {
    if (!reticle.visible) {
      controlsHint.textContent = "Aim at a surface until the marker appears.";
      return;
    }
    selectOrPlace();
  }

  const addButton = overlay.querySelector("#add-ar-object");
  const scaleDownButton = overlay.querySelector("#scale-ar-object-down");
  const scaleUpButton = overlay.querySelector("#scale-ar-object-up");
  const controlsHint = overlay.querySelector("#ar-controls-hint");

  const handleAdd = () => addAtReticle();
  const handleScaleDown = () => scaleSelected(0.85);
  const handleScaleUp = () => scaleSelected(1.18);
  const handleResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  overlay.querySelector("#ar-prompt").textContent = prompt;
  overlay.classList.add("is-active");
  overlay.hidden = false;
  document.body.append(renderer.domElement);
  addButton.addEventListener("click", handleAdd);
  scaleDownButton.addEventListener("click", handleScaleDown);
  scaleUpButton.addEventListener("click", handleScaleUp);
  controller.addEventListener("selectstart", selectOrPlace);
  controller.addEventListener("selectend", endDrag);
  window.addEventListener("resize", handleResize);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    exitButton.removeEventListener("click", endSession);
    addButton.removeEventListener("click", handleAdd);
    scaleDownButton.removeEventListener("click", handleScaleDown);
    scaleUpButton.removeEventListener("click", handleScaleUp);
    controller.removeEventListener("selectstart", selectOrPlace);
    controller.removeEventListener("selectend", endDrag);
    window.removeEventListener("resize", handleResize);
    hitTestSource?.cancel();
    overlay.classList.remove("is-active");
    overlay.hidden = true;
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    reticle.geometry.dispose();
    reticle.material.dispose();
    for (const object of objects) {
      object.geometry.dispose();
      object.material.dispose();
    }
    objects.clear();
  };

  function endSession() {
    if (session) session.end();
  }

  try {
    session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["local", "hit-test"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: overlay },
    });
    session.addEventListener("end", cleanup, { once: true });
    exitButton.addEventListener("click", endSession);
    await renderer.xr.setSession(session);
    const viewerSpace = await session.requestReferenceSpace("viewer");
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  } catch (error) {
    if (session) await session.end();
    cleanup();
    console.error("Could not start an immersive AR session:", error);
    throw new Error("Could not start AR. Check camera permissions and hit-test support, then try again.");
  }

  renderer.setAnimationLoop((_time, frame) => {
    if (frame && hitTestSource) {
      const hit = frame.getHitTestResults(hitTestSource)[0];
      if (hit) {
        const pose = hit.getPose(renderer.xr.getReferenceSpace());
        if (pose) {
          reticle.matrix.fromArray(pose.transform.matrix);
          reticle.visible = true;
        }
      } else {
        reticle.visible = false;
      }
    }
    updateDrag();
    renderer.render(scene, camera);
  });

  return session;
}
