import * as THREE from "/vendor/three.module.js";
import { createPrimitive, primitives } from "/primitives.js";

export async function enterAR({
  overlay,
  prompt,
  exitButton,
  mode = "immersive",
  contributions = null,
  primitiveIndex = 0,
  onObjectsChange = () => {},
  onExit = () => {},
}) {
  const usingWebXR = mode === "immersive";
  const isShowcaseMode = Array.isArray(contributions);
  if (!Number.isInteger(primitiveIndex) || !primitives[primitiveIndex]) {
    throw new Error("Your assigned primitive is unavailable. Rejoin the room and try again.");
  }
  let sessionRequest;
  let cameraStream;
  let cameraVideo;

  if (usingWebXR) {
    if (!navigator.xr) {
      const browserHint = /Android/i.test(navigator.userAgent)
        ? " On Android, immersive WebXR generally requires Chrome."
        : "";
      throw new Error(`This browser does not expose WebXR immersive AR. Open the game in a compatible immersive browser, then allow camera and motion access.${browserHint}`);
    }
    try {
      sessionRequest = navigator.xr.requestSession("immersive-ar", {
        optionalFeatures: ["hit-test", "dom-overlay", "light-estimation"],
        domOverlay: { root: overlay },
      });
    } catch (error) {
      console.error("Could not request an immersive AR session:", error);
      throw immersiveSessionError(error);
    }
  } else {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires HTTPS and a browser that supports camera video.");
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      cameraVideo = document.createElement("video");
      cameraVideo.className = "ar-camera";
      cameraVideo.autoplay = true;
      cameraVideo.muted = true;
      cameraVideo.playsInline = true;
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
    } catch (error) {
      cameraStream?.getTracks().forEach((track) => track.stop());
      throwCameraError(error);
    }
  }
  if (isShowcaseMode && !usingWebXR) {
    showcaseGroup = await createShowcaseGroup();
    showcaseGroup.position.set(0, -0.25, -1.5);
    scene.add(showcaseGroup);
    controlsHint.textContent = "Camera preview of the combined scene. Exit to return to results.";
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
  renderer.xr.enabled = usingWebXR;
  renderer.xr.setReferenceSpaceType("local");
  renderer.domElement.className = "ar-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20,
  );
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  scene.add(controller);

  const placedObjects = new Set();
  const addButton = overlay.querySelector("#add-ar-object");
  const scaleDownButton = overlay.querySelector("#scale-ar-object-down");
  const scaleUpButton = overlay.querySelector("#scale-ar-object-up");
  const controlsHint = overlay.querySelector("#ar-controls-hint");
  const promptElement = overlay.querySelector("#ar-prompt");
  const raycaster = new THREE.Raycaster();
  const dragPlane = new THREE.Plane();
  const dragOffset = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const intersection = new THREE.Vector3();
  let showcaseGroup = null;
  let saveTimer = null;
  const selectedModelIndex = primitiveIndex;
  let selectedObject = null;
  let hitTestSource = null;
  let session = null;
  let xrReferenceSpace = null;
  const xrViewerTransform = new THREE.Matrix4();
  let placementOrigin = null;
  let dragging = false;
  let closed = false;
  let isActive = false;
  let exitNotified = false;

  function setSelectedObject(object) {
    selectedObject = object;
    controlsHint.textContent = selectedObject
      ? "Object selected. Drag to move it or use the size controls."
      : "Aim at a surface and tap to place the selected item.";
  }

  function notifyExit() {
    if (!isActive || exitNotified) return;
    exitNotified = true;
    onExit();
  }

  function placeSelected(transform) {
    const matrix = transform.clone();
    const index = selectedModelIndex;
    try {
      if (closed || (usingWebXR && session?.ended)) return;
      const object = createPrimitive(index);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const hitScale = new THREE.Vector3();
      matrix.decompose(position, quaternion, hitScale);
      if (!placementOrigin) {
        placementOrigin = {
          position: position.clone(),
          quaternion: quaternion.clone(),
        };
      }
      object.position.copy(position);
      object.quaternion.copy(quaternion);
      object.userData.arScale = 1;
      object.userData.arBaseScale = 1;
      object.userData.arModelIndex = index;
      object.traverse((part) => {
        if (part.isMesh) part.userData.arObject = object;
      });
      scene.add(object);
      placedObjects.add(object);
      setSelectedObject(object);
      scheduleObjectSave();
    } catch (error) {
      console.error(`Could not place ${primitives[index].name}:`, error);
      controlsHint.textContent = `Could not place your ${primitives[index].name.toLowerCase()}. Try again.`;
    }
  }

  function getXRRay() {
    raycaster.setFromXRController(controller);
    return raycaster;
  }

  function startXRDrag() {
    if (isShowcaseMode) return;
    const hits = getXRRay().intersectObjects(Array.from(placedObjects), true);
    if (!hits.length) {
      dragging = false;
      return;
    }
    setSelectedObject(hits[0].object.userData.arObject);
    dragging = true;
    dragPlane.setFromNormalAndCoplanarPoint(raycaster.ray.direction, selectedObject.position);
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      dragOffset.copy(selectedObject.position).sub(intersection);
    }
  }

  function handleXRSelect() {
    if (dragging) return;
    if (isShowcaseMode) return;
    if (reticle.visible) {
      placeSelected(reticle.matrix);
    } else if (!hitTestSource) {
      placeInFrontOfViewer();
    }
  }

  function getScreenRay(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    raycaster.setFromCamera(pointer, camera);
    return raycaster;
  }

  function handlePreviewPointerDown(event) {
    if (event.target !== renderer.domElement) return;
    event.preventDefault();
    renderer.domElement.setPointerCapture(event.pointerId);
    const ray = getScreenRay(event);
    const hits = ray.intersectObjects(Array.from(placedObjects), true);
    if (hits.length) {
      setSelectedObject(hits[0].object.userData.arObject);
      dragging = true;
      dragPlane.setFromNormalAndCoplanarPoint(ray.ray.direction, selectedObject.position);
      if (ray.ray.intersectPlane(dragPlane, intersection)) {
        dragOffset.copy(selectedObject.position).sub(intersection);
      }
      return;
    }
    const placement = camera.matrixWorld.clone();
    placement.setPosition(ray.ray.origin.clone().addScaledVector(ray.ray.direction, 1.4));
    placeSelected(placement);
  }

  function updateDrag() {
    if (!dragging || !selectedObject) return;
    getXRRay();
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      selectedObject.position.copy(intersection).add(dragOffset);
    }
  }

  function updatePreviewDrag(event) {
    if (!dragging || !selectedObject) return;
    const ray = getScreenRay(event);
    if (ray.ray.intersectPlane(dragPlane, intersection)) {
      selectedObject.position.copy(intersection).add(dragOffset);
    }
  }

  function scaleSelected(factor) {
    if (isShowcaseMode) return;
    if (!selectedObject) {
      controlsHint.textContent = "Place an item first, then select it to resize.";
      return;
    }
    selectedObject.userData.arScale = THREE.MathUtils.clamp(
      selectedObject.userData.arScale * factor,
      selectedObject.userData.arBaseScale * 0.35,
      selectedObject.userData.arBaseScale * 3,
    );
    selectedObject.scale.setScalar(selectedObject.userData.arScale);
    scheduleObjectSave();
  }

  function serializePlacedObjects() {
    const originRotationInverse = placementOrigin?.quaternion.clone().invert();
    return Array.from(placedObjects, (object) => ({
      modelIndex: object.userData.arModelIndex,
      scale: object.userData.arScale / object.userData.arBaseScale,
      position: placementOrigin
        ? object.position.clone().sub(placementOrigin.position)
          .applyQuaternion(originRotationInverse)
          .toArray()
        : object.position.toArray(),
      quaternion: placementOrigin
        ? originRotationInverse.clone().multiply(object.quaternion).normalize().toArray()
        : object.quaternion.toArray(),
    }));
  }

  function scheduleObjectSave() {
    if (isShowcaseMode) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      Promise.resolve(onObjectsChange(serializePlacedObjects(), "player-origin")).catch((error) => {
        console.error("Could not save the placed objects:", error);
        controlsHint.textContent = "Could not save your objects. Check your connection and try again.";
      });
    }, 400);
  }

  async function createShowcaseGroup() {
    const group = new THREE.Group();
    for (let playerIndex = 0; playerIndex < contributions.length; playerIndex += 1) {
      const contribution = contributions[playerIndex];
      const playerGroup = new THREE.Group();
      for (const [objectIndex, entry] of contribution.objects.entries()) {
        const object = createPrimitive(entry.modelIndex);
        object.scale.setScalar(entry.scale);
        if (Array.isArray(entry.position) && Array.isArray(entry.quaternion)) {
          object.position.fromArray(entry.position);
          object.quaternion.fromArray(entry.quaternion).normalize();
        } else {
          object.position.set(objectIndex * 1.25, 0, 0);
        }
        playerGroup.add(object);
      }
      playerGroup.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(playerGroup);
      if (!bounds.isEmpty()) {
        const usesPlayerOrigin = contribution.placementSpace === "player-origin";
        const center = bounds.getCenter(new THREE.Vector3());
        playerGroup.position.set(
          usesPlayerOrigin ? 0 : -center.x,
          -bounds.min.y,
          usesPlayerOrigin ? 0 : -center.z,
        );
      }
      group.add(playerGroup);
    }
    return group;
  }

  function placeFromReticle() {
    if (usingWebXR) {
      if (isShowcaseMode) return;
      if (reticle.visible) {
        placeSelected(reticle.matrix);
      } else if (!hitTestSource) {
        placeInFrontOfViewer();
      } else {
        controlsHint.textContent = "Aim at a surface until the placement marker appears.";
      }
      return;
    }
    const position = camera.position.clone();
    camera.getWorldDirection(cameraDirection);
    position.addScaledVector(cameraDirection, 1.4);
    const transform = new THREE.Matrix4().compose(
      position,
      camera.quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    placeSelected(transform);
  }

  function placeInFrontOfViewer() {
    if (!xrReferenceSpace) return;
    const transform = xrViewerTransform.clone().multiply(
      new THREE.Matrix4().makeTranslation(0, 0, -1.4),
    );
    placeSelected(transform);
  }

  const onBeforeXRSelect = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const overlayButtons = Array.from(overlay.querySelectorAll("button"));
  const onPlaceClick = () => placeFromReticle();
  const onScaleDown = () => scaleSelected(0.85);
  const onScaleUp = () => scaleSelected(1.18);
  const onEndDrag = () => {
    dragging = false;
    scheduleObjectSave();
  };
  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };

  promptElement.textContent = prompt;
  overlay.querySelector("#ar-primitive-name").textContent = primitives[primitiveIndex].name;
  overlay.classList.toggle("camera-preview", !usingWebXR);
  overlay.classList.toggle("ar-showcase-mode", isShowcaseMode);
  overlay.classList.add("is-active");
  overlay.hidden = false;
  document.documentElement.classList.add("immersive-ar-active");
  if (cameraVideo) document.body.append(cameraVideo);
  document.body.append(renderer.domElement);

  for (const button of overlayButtons) {
    button.addEventListener("beforexrselect", onBeforeXRSelect);
  }
  addButton.addEventListener("click", onPlaceClick);
  scaleDownButton.addEventListener("click", onScaleDown);
  scaleUpButton.addEventListener("click", onScaleUp);
  controller.addEventListener("selectstart", startXRDrag);
  controller.addEventListener("select", handleXRSelect);
  controller.addEventListener("selectend", onEndDrag);
  window.addEventListener("resize", onResize);

  if (!usingWebXR) {
    renderer.domElement.style.pointerEvents = isShowcaseMode ? "none" : "auto";
    if (!isShowcaseMode) {
      renderer.domElement.addEventListener("pointerdown", handlePreviewPointerDown);
      renderer.domElement.addEventListener("pointermove", updatePreviewDrag);
      renderer.domElement.addEventListener("pointerup", onEndDrag);
      renderer.domElement.addEventListener("pointercancel", onEndDrag);
      controlsHint.textContent = "Camera preview only. Tap to place; objects will not track room surfaces.";
    }
  }

  const cleanup = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(saveTimer);
    Promise.resolve(onObjectsChange(serializePlacedObjects(), "player-origin")).catch((error) => {
      console.error("Could not save the placed objects:", error);
    });
    exitButton.removeEventListener("click", endSession);
    for (const button of overlayButtons) {
      button.removeEventListener("beforexrselect", onBeforeXRSelect);
    }
    addButton.removeEventListener("click", onPlaceClick);
    scaleDownButton.removeEventListener("click", onScaleDown);
    scaleUpButton.removeEventListener("click", onScaleUp);
    controller.removeEventListener("selectstart", startXRDrag);
    controller.removeEventListener("select", handleXRSelect);
    controller.removeEventListener("selectend", onEndDrag);
    renderer.domElement.removeEventListener("pointerdown", handlePreviewPointerDown);
    renderer.domElement.removeEventListener("pointermove", updatePreviewDrag);
    renderer.domElement.removeEventListener("pointerup", onEndDrag);
    renderer.domElement.removeEventListener("pointercancel", onEndDrag);
    window.removeEventListener("resize", onResize);
    hitTestSource?.cancel();
    session = null;
    overlay.classList.remove("is-active", "camera-preview");
    overlay.hidden = true;
    document.documentElement.classList.remove("immersive-ar-active");
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    cameraVideo?.remove();
    cameraStream?.getTracks().forEach((track) => track.stop());
    const geometries = new Set();
    const materials = new Set();
    scene.traverse((part) => {
      if (!part.isMesh) return;
      geometries.add(part.geometry);
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
        materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  };

  async function endSession() {
    if (!session) {
      cleanup();
      notifyExit();
      return;
    }
    const finalSave = Promise.resolve(onObjectsChange(serializePlacedObjects(), "player-origin"));
    try {
      await session.end();
      await finalSave;
    } catch (error) {
      console.error("Could not cleanly end the immersive AR session:", error);
    } finally {
      cleanup();
      notifyExit();
    }
  }

  const onSessionEnded = () => {
    cleanup();
    notifyExit();
  };
  exitButton.addEventListener("click", endSession);

  if (usingWebXR) {
    try {
      session = await sessionRequest;
      session.addEventListener("end", onSessionEnded, { once: true });
      await renderer.xr.setSession(session);
      xrReferenceSpace = renderer.xr.getReferenceSpace();
      if (!isShowcaseMode) {
        const viewerSpace = await session.requestReferenceSpace("viewer");
        try {
          hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
        } catch (error) {
          console.warn("Immersive AR started without surface hit-testing:", error);
        }
      }
      if (isShowcaseMode) {
        showcaseGroup = await createShowcaseGroup();
        controlsHint.textContent = "Viewing the saved combined scene. Exit AR to return to the results.";
      }
    } catch (error) {
      if (session) await session.end().catch((endError) => {
        console.error("Could not end the failed immersive AR session:", endError);
      });
      cleanup();
      console.error("Could not start the AR primitive viewer:", error);
      throw immersiveSessionError(error);
    }
  }
  if (isShowcaseMode && !usingWebXR) {
    try {
      showcaseGroup = await createShowcaseGroup();
      showcaseGroup.position.set(0, -0.25, -1.5);
      scene.add(showcaseGroup);
      controlsHint.textContent = "Camera preview of the combined scene. Exit to return to results.";
    } catch (error) {
      cleanup();
      throw error;
    }
  }
  if (!isShowcaseMode) {
    controlsHint.textContent = usingWebXR && !hitTestSource
      ? `Your shape: ${primitives[primitiveIndex].name}. Surface detection is unavailable; tap to place it in front of you.`
      : `Your shape: ${primitives[primitiveIndex].name}. Aim at a surface and tap to place.`;
  }

  isActive = true;
  renderer.setAnimationLoop((time, frame) => {
    if (usingWebXR && frame) {
      const referenceSpace = renderer.xr.getReferenceSpace();
      const viewerPose = referenceSpace && frame.getViewerPose(referenceSpace);
      if (viewerPose) {
        xrViewerTransform.fromArray(viewerPose.transform.matrix);
        if (isShowcaseMode && showcaseGroup && !showcaseGroup.parent) {
          showcaseGroup.matrix.copy(
            xrViewerTransform.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -1.5)),
          );
          showcaseGroup.matrixAutoUpdate = false;
          scene.add(showcaseGroup);
        }
      }
      if (hitTestSource && referenceSpace) {
        const results = frame.getHitTestResults(hitTestSource);
        if (results.length) {
          const pose = results[0].getPose(referenceSpace);
          if (pose) {
            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
          }
        } else {
          reticle.visible = false;
        }
      }
      updateDrag();
    }
    renderer.render(scene, camera);
  });

  return session;
}

function immersiveSessionError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return new Error("The XR viewer denied camera passthrough. Allow camera/motion access for this site and start AR from its immersive browser, not a regular web tab.");
  }
  const details = error?.message ? ` ${error.message}` : "";
  const browserHint = /Android/i.test(navigator.userAgent)
    ? " On Android, immersive WebXR generally requires Chrome; use the camera-preview option if this browser does not support it."
    : "";
  return new Error(`Could not start immersive AR.${details} Check this viewer's WebXR and camera permissions, then try again.${browserHint}`);
}

function throwCameraError(error) {
  console.error("Could not start the camera preview:", error);
  if (error.name === "NotAllowedError") {
    throw new Error("Allow camera access in your browser settings, then try again.");
  }
  throw new Error("Could not open the camera. Check camera permissions and try again.");
}
