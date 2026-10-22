const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");
const QRCode = require("qrcode");
const WebSocket = require("ws");

const projectDirectory = path.join(__dirname, "..");
let serverProcess;
let baseUrl;
let serverError = "";

async function findAvailablePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  let lastError;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Server exited before becoming ready. ${serverError}`);
    }

    try {
      return await fetch(baseUrl);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server did not become ready: ${lastError?.message}. ${serverError}`);
}

function waitForMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for a WebSocket message."));
    }, 3000);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function connectWebSocket(url) {
  const socket = new WebSocket(url);
  const opened = once(socket, "open");
  return { socket, opened };
}

before(async () => {
  const port = await findAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  serverProcess.stderr.setEncoding("utf8");
  serverProcess.stderr.on("data", (chunk) => {
    serverError += chunk;
  });
  await waitForServer();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await once(serverProcess, "exit");
  }
});

test("serves the landing page", async () => {
  const response = await fetch(baseUrl);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html; charset=utf-8$/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(html, /<title>ARtColab — Play in your space<\/title>/);
  assert.match(html, /Make your<br>space/);
});

test("serves the stylesheet", async () => {
  const response = await fetch(`${baseUrl}/styles.css`);
  const css = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/css; charset=utf-8$/);
  assert.match(css, /@media \(max-width: 600px\)/);
});

test("serves host and player screens", async () => {
  const [hostResponse, joinResponse] = await Promise.all([
    fetch(`${baseUrl}/host`),
    fetch(`${baseUrl}/join`),
  ]);
  const hostPage = await hostResponse.text();
  const joinPage = await joinResponse.text();

  assert.equal(hostResponse.status, 200);
  assert.match(hostPage, /id="create-room"/);
  assert.match(hostPage, /id="start-session"/);
  assert.equal(joinResponse.status, 200);
  assert.match(joinPage, /id="room-code-input"/);
  assert.match(joinPage, /id="mobile-game-panel"/);
  assert.match(joinPage, /id="camera-preview"/);
  assert.match(joinPage, /Choose furniture to place/);
  assert.match(joinPage, /id="add-ar-object"/);
  assert.match(joinPage, /id="scale-ar-object-down"/);
  assert.match(joinPage, /id="scale-ar-object-up"/);
  assert.match(joinPage, /type="module" src="\/join\.js"/);
});

test("serves the AR module and Three.js runtime", async () => {
  const [
    arResponse,
    threeResponse,
    threeCoreResponse,
    loaderResponse,
    geometryUtilsResponse,
    skeletonUtilsResponse,
  ] = await Promise.all([
    fetch(`${baseUrl}/ar.js`),
    fetch(`${baseUrl}/vendor/three.module.js`),
    fetch(`${baseUrl}/vendor/three.core.js`),
    fetch(`${baseUrl}/vendor/three-examples/loaders/GLTFLoader.js`),
    fetch(`${baseUrl}/vendor/three-examples/utils/BufferGeometryUtils.js`),
    fetch(`${baseUrl}/vendor/three-examples/utils/SkeletonUtils.js`),
  ]);
  const arModule = await arResponse.text();
  const threeModule = await threeResponse.text();
  const threeCoreModule = await threeCoreResponse.text();
  const loaderModule = await loaderResponse.text();
  const joinPageResponse = await fetch(`${baseUrl}/join`);
  const joinPage = await joinPageResponse.text();

  assert.equal(arResponse.status, 200);
  assert.match(arModule, /requestSession\("immersive-ar"/);
  assert.match(arModule, /mediaDevices\?\.getUserMedia/);
  assert.match(arModule, /GLTFLoader/);
  assert.match(arModule, /placeSelected/);
  assert.doesNotMatch(arModule, /await navigator\.xr\?\.isSessionSupported/);
  assert.ok(
    arModule.indexOf('navigator.xr.requestSession("immersive-ar"') <
      arModule.indexOf("new THREE.WebGLRenderer"),
    "the XR session request must happen directly from the user gesture",
  );
  assert.match(arModule, /className = "ar-camera"/);
  assert.match(arModule, /async function endSession\(\)/);
  assert.match(arModule, /optionalFeatures: \["hit-test", "dom-overlay", "light-estimation"\]/);
  assert.doesNotMatch(arModule, /requiredFeatures: \["hit-test"\]/);
  assert.match(arModule, /placeInFrontOfViewer/);
  assert.match(arModule, /Surface detection is unavailable/);
  assert.match(arModule, /premultipliedAlpha: false/);
  assert.match(arModule, /setClearAlpha\(0\)/);
  assert.match(arModule, /immersive-ar-active/);
  assert.match(arModule, /getHitTestResults/);
  assert.match(arModule, /selectstart/);
  assert.match(arModule, /scaleSelected/);
  assert.equal(threeResponse.status, 200);
  assert.match(threeModule, /WebGLRenderer/);
  assert.equal(threeCoreResponse.status, 200);
  assert.match(threeCoreModule, /REVISION/);
  assert.equal(loaderResponse.status, 200);
  assert.match(loaderResponse.headers.get("content-type"), /^text\/javascript; charset=utf-8$/);
  assert.match(loaderModule, /class GLTFLoader/);
  assert.equal(geometryUtilsResponse.status, 200);
  assert.equal(geometryUtilsResponse.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(skeletonUtilsResponse.status, 200);
  assert.equal(skeletonUtilsResponse.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(joinPageResponse.status, 200);
  assert.match(joinPage, /"three": "\/vendor\/three\.module\.js"/);
});

test("serves the supplied furniture thumbnails and GLB models", async () => {
  const [thumbnailResponse, modelResponse, traversalResponse] = await Promise.all([
    fetch(`${baseUrl}/ar-assets/pngs/armchair.png`, { method: "HEAD" }),
    fetch(`${baseUrl}/ar-assets/glbs/dylan_armchair_yolk_yellow.glb`, { method: "HEAD" }),
    fetch(`${baseUrl}/ar-assets/glbs/..%5C..%5Cserver.js`),
  ]);

  assert.equal(thumbnailResponse.status, 200);
  assert.match(thumbnailResponse.headers.get("content-type"), /^image\/png$/);
  assert.equal(modelResponse.status, 200);
  assert.equal(modelResponse.headers.get("content-type"), "model/gltf-binary");
  assert.equal(traversalResponse.status, 404);
});

test("supports HEAD requests without a response body", async () => {
  const response = await fetch(baseUrl, { method: "HEAD" });
  const getResponse = await fetch(baseUrl);
  const expectedLength = Buffer.byteLength(await getResponse.text());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), String(expectedLength));
  assert.equal(await response.text(), "");
});

test("returns 404 for missing files and path traversal", async () => {
  const missingResponse = await fetch(`${baseUrl}/missing-file`);
  const traversalResponse = await fetch(`${baseUrl}/..%2fserver.js`);

  assert.equal(missingResponse.status, 404);
  assert.equal(traversalResponse.status, 404);
});

test("rejects unsupported methods", async () => {
  const response = await fetch(baseUrl, { method: "POST" });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("creates rooms, validates joins, and broadcasts connected players", async (context) => {
  const createResponse = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  const room = await createResponse.json();
  assert.equal(createResponse.status, 201);
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);

  const qrResponse = await fetch(`${baseUrl}/api/rooms/${room.code}/qr`);
  const qrSvg = await qrResponse.text();
  assert.equal(qrResponse.status, 200);
  assert.match(qrResponse.headers.get("content-type"), /^image\/svg\+xml; charset=utf-8$/);
  assert.equal(qrResponse.headers.get("cache-control"), "no-store");
  assert.match(qrSvg, /^<svg\b/);
  assert.match(qrSvg, /<path\b/);
  assert.equal(
    qrSvg,
    await QRCode.toString(`${baseUrl}/join?code=${room.code}`, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 200,
    }),
  );

  const forwardedQrResponse = await fetch(`${baseUrl}/api/rooms/${room.code}/qr`, {
    headers: {
      "x-forwarded-host": "games.example",
      "x-forwarded-proto": "https",
    },
  });
  const forwardedQrSvg = await forwardedQrResponse.text();
  assert.equal(
    forwardedQrSvg,
    await QRCode.toString(`https://games.example/join?code=${room.code}`, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 200,
    }),
  );

  const missingQrResponse = await fetch(`${baseUrl}/api/rooms/NOPE00/qr`);
  assert.equal(missingQrResponse.status, 404);

  const invalidJoin = await fetch(`${baseUrl}/api/rooms/NOPE00/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Tester" }),
  });
  assert.equal(invalidJoin.status, 404);

  const { socket: hostSocket, opened: hostOpened } = connectWebSocket(
    `${baseUrl.replace("http:", "ws:")}/ws?role=host&code=${room.code}`,
  );
  context.after(() => hostSocket.close());
  const hostSnapshotPromise = waitForMessage(hostSocket, (message) => message.type === "room");
  await hostOpened;
  const hostSnapshot = await hostSnapshotPromise;
  assert.equal(hostSnapshot.code, room.code);
  assert.equal(hostSnapshot.phase, "lobby");
  assert.deepEqual(hostSnapshot.players, []);

  const joinResponsePromise = fetch(`${baseUrl}/api/rooms/${room.code}/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "  Alex  " }),
  });
  const waitingRoomUpdate = waitForMessage(
    hostSocket,
    (message) => message.type === "room" && message.players.length === 1,
  );
  const joinResponse = await joinResponsePromise;
  const player = await joinResponse.json();
  assert.equal(joinResponse.status, 201);
  assert.equal(player.name, "Alex");
  const waitingRoom = await waitingRoomUpdate;
  assert.equal(waitingRoom.players[0].connected, false);

  const { socket: playerSocket, opened: playerOpened } = connectWebSocket(
    `${baseUrl.replace("http:", "ws:")}/ws?role=player&code=${room.code}&playerId=${player.playerId}`,
  );
  context.after(() => playerSocket.close());
  const playerSnapshotPromise = waitForMessage(playerSocket, (message) => message.type === "room");
  const connectedRoomPromise = waitForMessage(
    hostSocket,
    (message) => message.type === "room" && message.players[0]?.connected === true,
  );
  await playerOpened;
  const playerSnapshot = await playerSnapshotPromise;
  const connectedRoom = await connectedRoomPromise;
  assert.equal(playerSnapshot.players[0].name, "Alex");
  assert.equal(connectedRoom.players[0].connected, true);

  const activeRoomPromise = waitForMessage(
    hostSocket,
    (message) => message.type === "room" && message.phase === "active",
  );
  const activePlayerRoomPromise = waitForMessage(
    playerSocket,
    (message) => message.type === "room" && message.phase === "active",
  );
  const startResponse = await fetch(`${baseUrl}/api/rooms/${room.code}/start`, {
    method: "POST",
  });
  const started = await startResponse.json();
  const activeRoom = await activeRoomPromise;
  assert.equal(startResponse.status, 200);
  assert.equal(started.phase, "active");
  assert.equal(started.prompt, room.prompt);
  assert.equal(activeRoom.prompt, room.prompt);
  assert.equal((await activePlayerRoomPromise).phase, "active");
  const repeatedStart = await fetch(`${baseUrl}/api/rooms/${room.code}/start`, {
    method: "POST",
  });
  assert.equal(repeatedStart.status, 200);

  const disconnectedRoomPromise = waitForMessage(
    hostSocket,
    (message) => message.type === "room" && message.players[0]?.connected === false,
  );
  playerSocket.close();
  const disconnectedRoom = await disconnectedRoomPromise;
  assert.equal(disconnectedRoom.players[0].name, "Alex");
});
