import * as THREE from "/vendor/three.module.js";

const objectStyles = [
  { color: 0xf05d43, geometry: () => new THREE.IcosahedronGeometry(0.13, 0) },
  { color: 0xf2c84b, geometry: () => new THREE.TorusGeometry(0.15, 0.045, 10, 28) },
  { color: 0x6b91a3, geometry: () => new THREE.SphereGeometry(0.12, 20, 16) },
  { color: 0x9c83ab, geometry: () => new THREE.ConeGeometry(0.12, 0.24, 7) },
];

export async function enterAR({ overlay, prompt, exitButton, mode = "immersive" }) {
  const usingWebXR = mode === "immersive";
  let sessionRequest;
  let cameraRequest;
  let cameraStream;
  let cameraVideo;
  if (usingWebXR) {
    if (!navigator.xr) {
      throw new Error("This browser does not support immersive AR. You can try the camera preview instead.");
    }
    try {
      sessionRequest = navigator.xr.requestSession("immersive-ar", {
        optionalFeatures: ["hit-test", "dom-overlay"],
        domOverlay: { root: overlay },
      });
    } catch (error) {
      console.error("Could not request an immersive AR session:", error);
      throw new Error("Could not start immersive AR. Check browser support and camera permissions.");
    }
  } else {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires HTTPS and a browser that supports camera video.");
    }
    try {
      cameraRequest = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
    } catch (error) {
      throwCameraError(error);
    }
  }

  if (cameraRequest) {
    try {
      cameraStream = await cameraRequest;
      cameraVideo = document.createElement("video");
      cameraVideo.className = "ar-camera";
      cameraVideo.autoplay = true;
      cameraVideo.muted = true;
      cameraVideo.playsInline = true;
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
    } catch (error) {
      cameraStream?.getTracks().forEach((track) => track.stop());
      console.error("Could not start the camera preview:", error);
      throwCameraError(error);
    }
  }

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  renderer.autoClear = true;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.domElement.className = "ar-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x71634b, 2));

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.095, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
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
      : hitTestSource
        ? "Aim at a surface and tap to place. Tap an object to select and drag."
        : "Tap to place in front of you. Tap an object to select and drag.";
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

  function getScreenRay(clientX, clientY) {
    const bounds = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    raycaster.setFromCamera(pointer, camera);
    return raycaster;
  }

  function handleCameraPointerDown(event) {
    if (event.target !== renderer.domElement) return;
    event.preventDefault();
    renderer.domElement.setPointerCapture(event.pointerId);
    getScreenRay(event.clientX, event.clientY);
    const hits = raycaster.intersectObjects(Array.from(objects), true);
    if (hits.length) {
      setSelection(hits[0].object.userData.arObject);
      dragging = true;
      camera.getWorldDirection(cameraDirection);
      dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, selectedObject.position);
      if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        dragOffset.copy(selectedObject.position).sub(intersection);
      }
      return;
    }
    const position = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 1.4);
    addObject(position, camera.quaternion);
  }

  function handleCameraPointerMove(event) {
    if (!dragging || !selectedObject) return;
    getScreenRay(event.clientX, event.clientY);
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      selectedObject.position.copy(intersection).add(dragOffset);
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
    if (!usingWebXR) {
      camera.getWorldDirection(cameraDirection);
      const position = camera.position.clone().addScaledVector(cameraDirection, 1.4);
      addObject(position, camera.quaternion);
      controlsHint.textContent = "Camera view · tap to place, drag to move, use size buttons.";
      return;
    }
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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };

  overlay.querySelector("#ar-prompt").textContent = prompt;
  overlay.classList.toggle("camera-preview", !usingWebXR);
  if (cameraVideo) document.body.append(cameraVideo);
  overlay.classList.add("is-active");
  overlay.hidden = false;
  document.documentElement.classList.add("immersive-ar-active");
  document.body.append(renderer.domElement);
  addButton.addEventListener("click", handleAdd);
  scaleDownButton.addEventListener("click", handleScaleDown);
  scaleUpButton.addEventListener("click", handleScaleUp);
  controller.addEventListener("selectstart", selectOrPlace);
  controller.addEventListener("selectend", endDrag);
  if (!usingWebXR) {
    renderer.domElement.style.pointerEvents = "auto";
    renderer.domElement.addEventListener("pointerdown", handleCameraPointerDown);
    renderer.domElement.addEventListener("pointermove", handleCameraPointerMove);
    renderer.domElement.addEventListener("pointerup", endDrag);
    renderer.domElement.addEventListener("pointercancel", endDrag);
    controlsHint.textContent = "Camera view · no surface tracking. Tap to place, drag to move.";
  }
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
    renderer.domElement.removeEventListener("pointerdown", handleCameraPointerDown);
    renderer.domElement.removeEventListener("pointermove", handleCameraPointerMove);
    renderer.domElement.removeEventListener("pointerup", endDrag);
    renderer.domElement.removeEventListener("pointercancel", endDrag);
    window.removeEventListener("resize", handleResize);
    hitTestSource?.cancel();
    overlay.classList.remove("is-active");
    overlay.classList.remove("camera-preview");
    overlay.hidden = true;
    document.documentElement.classList.remove("immersive-ar-active");
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    cameraVideo?.remove();
    cameraStream?.getTracks().forEach((track) => track.stop());
    reticle.geometry.dispose();
    reticle.material.dispose();
    for (const object of objects) {
      object.geometry.dispose();
      object.material.dispose();
    }
    objects.clear();
  };

  function endSession() {
    if (session) {
      session.end();
    } else {
      cleanup();
    }
  }

  if (usingWebXR) {
    try {
      session = await sessionRequest;
      if (session.environmentBlendMode === "opaque") {
        throw new Error(
          "This browser did not provide camera passthrough. Try a phone browser that supports immersive AR.",
        );
      }
      exitButton.addEventListener("click", endSession);
      await renderer.xr.setSession(session);
      const viewerSpace = await session.requestReferenceSpace("viewer");
      try {
        hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      } catch (error) {
        console.warn("Surface hit testing is unavailable; using tracked viewer placement:", error);
        controlsHint.textContent = "Surface tracking unavailable. Objects will stay in session space.";
      }
    } catch (error) {
      if (session) await session.end();
      cleanup();
      console.error("Could not start an immersive AR session:", error);
      if (error instanceof Error && error.message.includes("did not provide camera passthrough")) {
        throw error;
      }
      if (error.name === "NotSupportedError") {
        throw new Error(
          "This browser or XR runtime could not start immersive AR. Check its AR support and permissions, or use the untracked camera preview.",
        );
      }
      throw new Error("Could not start AR. Check camera permissions and hit-test support, then try again.");
    }
    session.addEventListener("end", cleanup, { once: true });
  } else {
    exitButton.addEventListener("click", endSession);
  }

  renderer.setAnimationLoop((_time, frame) => {
    if (usingWebXR && frame && hitTestSource) {
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
    } else if (usingWebXR && frame) {
      const viewerPose = frame.getViewerPose(renderer.xr.getReferenceSpace());
      if (viewerPose) {
        const viewerMatrix = new THREE.Matrix4().fromArray(viewerPose.transform.matrix);
        const position = new THREE.Vector3().setFromMatrixPosition(viewerMatrix);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(viewerMatrix);
        position.add(new THREE.Vector3(0, 0, -1.4).applyQuaternion(quaternion));
        reticle.matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
        reticle.visible = true;
      } else {
        reticle.visible = false;
      }
    }
    if (usingWebXR) updateDrag();
    renderer.render(scene, camera);
  });

  return session;
}

function throwCameraError(error) {
  console.error("Could not start the camera preview:", error);
  if (error.name === "NotAllowedError") {
    throw new Error("Allow camera access in your browser settings, then try again.");
  }
  throw new Error("Could not open the camera. Check camera permissions and try again.");
}
