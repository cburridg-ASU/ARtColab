import * as THREE from "/vendor/three.module.js";

export async function enterAR({ overlay, prompt, exitButton }) {
  const supportsAR = await navigator.xr?.isSessionSupported("immersive-ar").catch(() => false);
  if (!supportsAR) {
    throw new Error(
      "AR isn't available here. Try a WebXR-compatible phone browser over HTTPS.",
    );
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
  const sculpture = new THREE.Group();
  sculpture.position.set(0, 1.25, -1.7);
  scene.add(sculpture);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x71634b, 2));

  const colors = [0xf05d43, 0xf2c84b, 0x6b91a3, 0x9c83ab];
  const materials = colors.map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 }),
  );
  const shapes = [
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), materials[0]),
    new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 10, 28), materials[1]),
    new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), materials[2]),
    new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.25, 6), materials[3]),
  ];
  shapes[0].position.set(-0.2, 0.03, 0);
  shapes[1].position.set(0.1, 0.12, -0.08);
  shapes[1].rotation.set(0.7, 0.3, 0.2);
  shapes[2].position.set(0.25, -0.09, 0.04);
  shapes[3].position.set(-0.02, -0.22, 0.02);
  shapes.forEach((shape) => sculpture.add(shape));

  overlay.hidden = false;
  overlay.classList.add("is-active");
  document.body.append(renderer.domElement);
  let session;

  const cleanup = () => {
    exitButton.removeEventListener("click", endSession);
    overlay.classList.remove("is-active");
    overlay.hidden = true;
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    sculpture.traverse((object) => {
      if (object.isMesh) object.geometry.dispose();
    });
    materials.forEach((material) => material.dispose());
  };

  const endSession = () => {
    if (session) session.end();
  };

  try {
    session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["local"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: overlay },
    });
    session.addEventListener("end", cleanup, { once: true });
    exitButton.addEventListener("click", endSession);
    await renderer.xr.setSession(session);
  } catch (error) {
    if (session) await session.end();
    cleanup();
    console.error("Could not start an immersive AR session:", error);
    throw new Error("Could not start AR. Check camera permissions and try again.");
  }

  renderer.setAnimationLoop((time) => {
    sculpture.rotation.y = time * 0.00025;
    sculpture.rotation.x = Math.sin(time * 0.0002) * 0.12;
    renderer.render(scene, camera);
  });

  const promptElement = overlay.querySelector("#ar-prompt");
  if (promptElement) promptElement.textContent = prompt;

  return session;
}
