import * as THREE from "/vendor/three.module.js";
import { GLTFLoader } from "/vendor/three-examples/loaders/GLTFLoader.js";

const models = [
  { name: "Chair", file: "dylan_armchair_yolk_yellow.glb", scale: 0.01 },
  { name: "Lounger", file: "ivan_armchair_mineral_blue.glb", scale: 0.01 },
  { name: "Marble table", file: "marble_coffee_table.glb", scale: 0.005 },
  { name: "Walnut table", file: "flippa_functional_coffee_table_w._storagewalnut.glb", scale: 0.01 },
  { name: "Velvet chair", file: "frame_armchairpetrol_velvet_with_gold_frame.glb", scale: 0.01 },
  { name: "Nesting tables", file: "elnaz_nesting_side_tables_brass__green_marble.glb", scale: 0.01 },
];

export async function enterAR({ overlay, prompt, exitButton, mode = "immersive" }) {
  const usingWebXR = mode === "immersive";
  let sessionRequest;
  let cameraStream;
  let cameraVideo;

  if (usingWebXR) {
    if (!navigator.xr) {
      throw new Error("This viewer does not expose WebXR immersive AR. It may display XR web apps without providing camera passthrough. Try an AR-compatible browser, or use camera preview without room tracking.");
    }
    try {
      sessionRequest = navigator.xr.requestSession("immersive-ar", {
        optionalFeatures: ["hit-test", "dom-overlay", "light-estimation"],
        domOverlay: { root: overlay },
      });
    } catch (error) {
      console.error("Could not request an immersive AR session:", error);
      throw new Error("This viewer did not start immersive AR. It may not provide camera passthrough to web apps. Try an AR-compatible browser, or use camera preview without room tracking.");
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

  const loader = new GLTFLoader();
  const loadedModels = new Map();
  const placedObjects = new Set();
  const catalogButtons = Array.from(overlay.querySelectorAll("[data-model-index]"));
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
  let selectedModelIndex = 0;
  let selectedObject = null;
  let hitTestSource = null;
  let session = null;
  let xrReferenceSpace = null;
  const xrViewerTransform = new THREE.Matrix4();
  let dragging = false;
  let closed = false;

  function loadModel(index) {
    if (!loadedModels.has(index)) {
      const model = models[index];
      const loading = new Promise((resolve, reject) => {
        loader.load(`/ar-assets/glbs/${encodeURIComponent(model.file)}`, (result) => {
          resolve(result.scene);
        }, undefined, reject);
      });
      loadedModels.set(index, loading);
      loading.catch(() => loadedModels.delete(index));
    }
    return loadedModels.get(index);
  }

  function setSelectedModel(index) {
    selectedModelIndex = index;
    for (const button of catalogButtons) {
      const selected = Number(button.dataset.modelIndex) === index;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    controlsHint.textContent = usingWebXR && !hitTestSource
      ? `Selected ${models[index].name}. Surface detection is unavailable; tap to place it in front of you.`
      : `Selected ${models[index].name}. Aim at a surface and tap to place.`;
    loadModel(index).catch((error) => {
      console.error(`Could not load AR model ${models[index].file}:`, error);
      controlsHint.textContent = `Could not load ${models[index].name}. Check your connection and try another model.`;
    });
  }

  function setSelectedObject(object) {
    selectedObject = object;
    controlsHint.textContent = selectedObject
      ? "Object selected. Drag to move it or use the size controls."
      : "Aim at a surface and tap to place the selected item.";
  }

  async function placeSelected(transform) {
    const matrix = transform.clone();
    const index = selectedModelIndex;
    controlsHint.textContent = `Loading ${models[index].name}…`;
    try {
      const source = await loadModel(index);
      if (closed || (usingWebXR && session?.ended)) return;
      const object = source.clone(true);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const hitScale = new THREE.Vector3();
      matrix.decompose(position, quaternion, hitScale);
      object.position.copy(position);
      object.quaternion.copy(quaternion);
      object.scale.setScalar(models[index].scale);
      object.userData.arScale = models[index].scale;
      object.userData.arBaseScale = models[index].scale;
      object.userData.arModelIndex = index;
      object.traverse((part) => {
        if (part.isMesh) part.userData.arObject = object;
      });
      scene.add(object);
      placedObjects.add(object);
      setSelectedObject(object);
    } catch (error) {
      console.error(`Could not place AR model ${models[index].file}:`, error);
      controlsHint.textContent = `Could not place ${models[index].name}. Try again.`;
    }
  }

  function getXRRay() {
    raycaster.setFromXRController(controller);
    return raycaster;
  }

  function startXRDrag() {
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
  }

  function placeFromReticle() {
    if (usingWebXR) {
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

  const onCatalogClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedModel(Number(event.currentTarget.dataset.modelIndex));
  };
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
  };
  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };

  promptElement.textContent = prompt;
  overlay.classList.toggle("camera-preview", !usingWebXR);
  overlay.classList.add("is-active");
  overlay.hidden = false;
  document.documentElement.classList.add("immersive-ar-active");
  if (cameraVideo) document.body.append(cameraVideo);
  document.body.append(renderer.domElement);

  for (const button of overlayButtons) {
    button.addEventListener("beforexrselect", onBeforeXRSelect);
  }
  for (const button of catalogButtons) {
    button.addEventListener("click", onCatalogClick);
  }
  addButton.addEventListener("click", onPlaceClick);
  scaleDownButton.addEventListener("click", onScaleDown);
  scaleUpButton.addEventListener("click", onScaleUp);
  controller.addEventListener("selectstart", startXRDrag);
  controller.addEventListener("select", handleXRSelect);
  controller.addEventListener("selectend", onEndDrag);
  window.addEventListener("resize", onResize);

  if (!usingWebXR) {
    renderer.domElement.style.pointerEvents = "auto";
    renderer.domElement.addEventListener("pointerdown", handlePreviewPointerDown);
    renderer.domElement.addEventListener("pointermove", updatePreviewDrag);
    renderer.domElement.addEventListener("pointerup", onEndDrag);
    renderer.domElement.addEventListener("pointercancel", onEndDrag);
    controlsHint.textContent = "Camera preview only. Tap to place; objects will not track room surfaces.";
  }

  const cleanup = () => {
    if (closed) return;
    closed = true;
    exitButton.removeEventListener("click", endSession);
    for (const button of overlayButtons) {
      button.removeEventListener("beforexrselect", onBeforeXRSelect);
    }
    for (const button of catalogButtons) {
      button.removeEventListener("click", onCatalogClick);
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
    overlay.classList.remove("is-active", "camera-preview");
    overlay.hidden = true;
    document.documentElement.classList.remove("immersive-ar-active");
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    cameraVideo?.remove();
    cameraStream?.getTracks().forEach((track) => track.stop());
    reticle.geometry.dispose();
    reticle.material.dispose();

    const geometries = new Set();
    const materials = new Set();
    for (const sourcePromise of loadedModels.values()) {
      sourcePromise.then((source) => {
        source.traverse((part) => {
          if (!part.isMesh) return;
          geometries.add(part.geometry);
          for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
            materials.add(material);
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
      }).catch(() => {});
    }
  };

  async function endSession() {
    if (session) await session.end();
    else cleanup();
  }

  const onSessionEnded = () => cleanup();
  exitButton.addEventListener("click", endSession);

  if (usingWebXR) {
    try {
      session = await sessionRequest;
      session.addEventListener("end", onSessionEnded, { once: true });
      await renderer.xr.setSession(session);
      const viewerSpace = await session.requestReferenceSpace("viewer");
      xrReferenceSpace = renderer.xr.getReferenceSpace();
      try {
        hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      } catch (error) {
        console.warn("Immersive AR started without surface hit-testing:", error);
      }
      setSelectedModel(0);
      if (!hitTestSource) {
        controlsHint.textContent = "Surface detection is unavailable. Tap to place objects in front of you; placement may not stay fixed to room surfaces.";
      }
    } catch (error) {
      if (session) await session.end();
      cleanup();
      console.error("Could not start the AR furniture viewer:", error);
      throw new Error("This viewer could not start an immersive AR session. It may support XR web apps without camera passthrough, or may not support the features this app needs. Try an AR-compatible browser, or use camera preview without room tracking.");
    }
  } else {
    setSelectedModel(0);
  }

  renderer.setAnimationLoop((time, frame) => {
    if (usingWebXR && frame) {
      const referenceSpace = renderer.xr.getReferenceSpace();
      const viewerPose = referenceSpace && frame.getViewerPose(referenceSpace);
      if (viewerPose) {
        xrViewerTransform.fromArray(viewerPose.transform.matrix);
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

function throwCameraError(error) {
  console.error("Could not start the camera preview:", error);
  if (error.name === "NotAllowedError") {
    throw new Error("Allow camera access in your browser settings, then try again.");
  }
  throw new Error("Could not open the camera. Check camera permissions and try again.");
}
