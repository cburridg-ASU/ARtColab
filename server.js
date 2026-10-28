const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const QRCode = require("qrcode");
const { Pool } = require("pg");
const { WebSocket, WebSocketServer } = require("ws");

const publicDirectory = path.join(__dirname, "public");
const roomCodeCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const primitiveCount = 8;
const roomLifetime = 2 * 60 * 60 * 1000;
const testRoundDurationMs = Number(process.env.ROUND_DURATION_MS) || null;
const maxRequestBytes = 4096;
const vendorFiles = {
  "/vendor/three.core.js": path.join(__dirname, "node_modules", "three", "build", "three.core.js"),
  "/vendor/three.module.js": path.join(__dirname, "node_modules", "three", "build", "three.module.js"),
};
const threeExamplesDirectory = path.join(__dirname, "node_modules", "three", "examples", "jsm");
const arAssetsDirectory = path.join(__dirname, "ar-object");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const rooms = new Map();
const roundStore = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function createRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      roomCodeCharacters[crypto.randomInt(roomCodeCharacters.length)],
    ).join("");
  } while (
    rooms.has(code) ||
    (roundStore && (await roundStore.query("SELECT 1 FROM rounds WHERE code = $1", [code])).rowCount)
  );
  return code;
}

function getRoomSnapshot(room) {
  return {
    type: "room",
    code: room.code,
    prompt: room.prompt,
    phase: room.phase,
    timerEndsAt: room.timerEndsAt,
    durationMinutes: room.durationMinutes,
    players: Array.from(room.players.values(), ({ id, name, connected, primitiveIndex }) => ({
      id,
      name,
      connected,
      primitiveIndex,
    })),
  };
}

function broadcastRoom(room) {
  const message = JSON.stringify(getRoomSnapshot(room));
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function sendError(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message }));
  }
  socket.close(1008, "Invalid room connection");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxRequestBytes) {
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = requestUrl.pathname;

  const qrMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/qr$/);
  if (qrMatch) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method Not Allowed");
      return;
    }

    const code = qrMatch[1].toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendJson(response, 404, { error: "Room not found. Create a new room or check the code." });
      return;
    }

    const forwardedHost = request.headers["x-forwarded-host"];
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || request.headers.host || "")
      .split(",")[0]
      .trim();
    const hostIsValid = /^(?:[a-zA-Z0-9.-]+|\[[\da-fA-F:.]+\])(?::\d{1,5})?$/.test(host);
    const forwardedProtocol = request.headers["x-forwarded-proto"];
    const protocol = (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const scheme = protocol === "https" || (protocol !== "http" && request.socket.encrypted)
      ? "https"
      : "http";

    if (!hostIsValid) {
      sendJson(response, 400, { error: "Unable to determine the public room address." });
      return;
    }

    try {
      const joinUrl = new URL(`/join?code=${encodeURIComponent(code)}`, `${scheme}://${host}`);
      const svg = await QRCode.toString(joinUrl.toString(), {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 200,
      });
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Length": Buffer.byteLength(svg),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : svg);
    } catch (error) {
      console.error("Unable to generate room QR code:", error);
      sendJson(response, 500, { error: "Unable to generate the room QR code." });
    }
    return;
  }

  if (pathname === "/api/rooms" || /^\/api\/rooms\/[^/]+\/players$/.test(pathname)) {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" });
      response.end("Method Not Allowed");
      return;
    }

    try {
      const body = await readJsonBody(request);
      if (pathname === "/api/rooms") {
        const code = await createRoomCode();
        const room = {
          code,
          prompt: "Build something unexpected.",
          phase: "lobby",
          durationMinutes: null,
          timerEndsAt: null,
          roundTimer: null,
          players: new Map(),
          contributions: new Map(),
          clients: new Set(),
          createdAt: Date.now(),
        };
        if (roundStore) {
          await roundStore.query(
            "INSERT INTO rounds (code, prompt, phase, created_at) VALUES ($1, $2, $3, $4)",
            [code, room.prompt, room.phase, room.createdAt],
          );
        }
        rooms.set(code, room);
        sendJson(response, 201, { code, prompt: room.prompt });
        return;
      }

      const code = pathname.split("/")[3].toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found. Check the code and try again." });
        return;
      }

      if (typeof body.name !== "string" || !body.name.trim()) {
        sendJson(response, 400, { error: "Enter a player name to join." });
        return;
      }
      if (room.players.size >= primitiveCount) {
        sendJson(response, 409, { error: "This room is full. Each player needs a unique primitive." });
        return;
      }

      const name = body.name.trim().slice(0, 20);
      const playerId = crypto.randomUUID();
      const primitiveIndex = room.players.size;
      room.players.set(playerId, { id: playerId, name, connected: false, primitiveIndex });
      sendJson(response, 201, { code, playerId, name, primitiveIndex });
      broadcastRoom(room);
      return;
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const statusCode = error.statusCode || 500;
      if (statusCode === 500) console.error("Room API request failed:", error);
      sendJson(response, statusCode, {
        error: statusCode === 500 ? "Unable to process the request." : error.message,
      });
      return;
    }
  }

  const resultMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/(results|contributions)$/);
  if (resultMatch) {
    const code = resultMatch[1].toUpperCase();
    const room = rooms.get(code);
    if (resultMatch[2] === "results") {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method Not Allowed");
        return;
      }
      let result;
      try {
        if (roundStore) {
          const { rows } = await roundStore.query(
            "SELECT code, prompt, phase, contributions FROM rounds WHERE code = $1",
            [code],
          );
          result = rows[0];
        } else if (room) {
          result = {
            code: room.code,
            prompt: room.prompt,
            phase: room.phase,
            contributions: Array.from(room.contributions.values()),
          };
        }
      } catch (error) {
        console.error("Unable to load round results:", error);
        sendJson(response, 500, { error: "Unable to load round results." });
        return;
      }
      if (!result) {
        sendJson(response, 404, { error: "Round results not found." });
        return;
      }
      if (result.phase !== "complete") {
        sendJson(response, 409, { error: "Round results are not ready yet." });
        return;
      }
      sendJson(response, 200, {
        code: result.code,
        prompt: result.prompt,
        contributions: result.contributions || [],
      });
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" });
      response.end("Method Not Allowed");
      return;
    }
    if (!room || (room.phase !== "active" && room.phase !== "complete")) {
      sendJson(response, 404, { error: "This room is not accepting object saves." });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const player = room.players.get(body.playerId);
      if (!player) {
        sendJson(response, 403, { error: "Player is not part of this room." });
        return;
      }
      if (!Array.isArray(body.objects) || body.objects.length > 24) {
        sendJson(response, 400, { error: "Send up to 24 placed objects." });
        return;
      }
      const objectsAreValid = body.objects.every((object) =>
        object &&
        Number.isInteger(object.modelIndex) &&
        object.modelIndex === player.primitiveIndex &&
        Number.isFinite(object.scale) &&
        object.scale >= 0.35 &&
        object.scale <= 3 &&
        Array.isArray(object.position) &&
        object.position.length === 3 &&
        object.position.every((value) => Number.isFinite(value) && Math.abs(value) <= 100) &&
        Array.isArray(object.quaternion) &&
        object.quaternion.length === 4 &&
        object.quaternion.every((value) => Number.isFinite(value) && Math.abs(value) <= 1) &&
        Math.abs(Math.hypot(...object.quaternion) - 1) < 0.1
      );
      if (!objectsAreValid) {
        sendJson(response, 400, { error: "The placement data is invalid." });
        return;
      }
      const contribution = {
        playerId: player.id,
        playerName: player.name,
        objects: body.objects,
      };
      if (roundStore) {
        await roundStore.query(
          `UPDATE rounds
           SET contributions =
             COALESCE(
               (SELECT jsonb_agg(item.value)
                FROM jsonb_array_elements(rounds.contributions) AS item(value)
                WHERE item.value->>'playerId' <> $2),
               '[]'::jsonb
             ) || jsonb_build_array($3::jsonb)
           WHERE code = $1`,
          [code, player.id, JSON.stringify(contribution)],
        );
      }
      room.contributions.set(player.id, contribution);
      sendJson(response, 200, { saved: true });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const statusCode = error.statusCode || 500;
      if (statusCode === 500) console.error("Unable to save player placements:", error);
      sendJson(response, statusCode, {
        error: statusCode === 500 ? "Unable to save the placements." : error.message,
      });
    }
    return;
  }

  const startRoomMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
  if (startRoomMatch) {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" });
      response.end("Method Not Allowed");
      return;
    }

    const code = startRoomMatch[1].toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendJson(response, 404, { error: "Room not found. Create a new room or check the code." });
      return;
    }

    if (room.phase === "lobby") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        const statusCode = error.statusCode || 500;
        sendJson(response, statusCode, { error: error.message });
        return;
      }
      const durationMinutes = body.durationMinutes;
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10) {
        sendJson(response, 400, { error: "Choose a round length from 1 to 10 minutes." });
        return;
      }
      const durationMs = testRoundDurationMs || durationMinutes * 60 * 1000;
      const timerEndsAt = Date.now() + durationMs;
      if (roundStore) {
        try {
          await roundStore.query(
            "UPDATE rounds SET phase = $2, timer_ends_at = $3, duration_minutes = $4 WHERE code = $1",
            [code, "active", timerEndsAt, durationMinutes],
          );
        } catch (error) {
          console.error("Unable to start the stored round:", error);
          sendJson(response, 500, { error: "Unable to start the round." });
          return;
        }
      }
      room.phase = "active";
      room.durationMinutes = durationMinutes;
      room.timerEndsAt = timerEndsAt;
      room.roundTimer = setTimeout(async () => {
        if (room.phase !== "active") return;
        if (roundStore) {
          try {
            await roundStore.query(
              "UPDATE rounds SET phase = $2, completed_at = $3 WHERE code = $1",
              [code, "complete", Date.now()],
            );
          } catch (error) {
            console.error("Unable to save round completion:", error);
          }
        }
        room.phase = "complete";
        room.roundTimer = null;
        broadcastRoom(room);
      }, durationMs);
      room.roundTimer.unref();
      broadcastRoom(room);
    }
    sendJson(response, 200, {
      code,
      phase: room.phase,
      prompt: room.prompt,
      timerEndsAt: room.timerEndsAt,
      durationMinutes: room.durationMinutes,
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  const pageAliases = { "/": "index.html", "/host": "host.html", "/join": "join.html" };
  let pathnameFromUrl;
  try {
    pathnameFromUrl = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }
  let filePath;
  if (vendorFiles[pathnameFromUrl]) {
    filePath = vendorFiles[pathnameFromUrl];
  } else if (pathnameFromUrl.startsWith("/vendor/three-examples/")) {
    const examplePath = path.resolve(
      threeExamplesDirectory,
      pathnameFromUrl.slice("/vendor/three-examples/".length),
    );
    if (
      !examplePath.startsWith(`${threeExamplesDirectory}${path.sep}`) ||
      path.extname(examplePath) !== ".js"
    ) {
      response.writeHead(404);
      response.end("Not Found");
      return;
    }
    filePath = examplePath;
  } else if (pathnameFromUrl.startsWith("/ar-assets/")) {
    const assetPath = path.resolve(
      arAssetsDirectory,
      pathnameFromUrl.slice("/ar-assets/".length),
    );
    const assetExtension = path.extname(assetPath).toLowerCase();
    if (
      !assetPath.startsWith(`${arAssetsDirectory}${path.sep}`) ||
      ![".glb", ".png"].includes(assetExtension)
    ) {
      response.writeHead(404);
      response.end("Not Found");
      return;
    }
    filePath = assetPath;
  } else {
    filePath = path.resolve(
      publicDirectory,
      pageAliases[pathnameFromUrl] || pathnameFromUrl.replace(/^[/\\]+/, ""),
    );
    if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
      response.writeHead(404);
      response.end("Not Found");
      return;
    }
  }

  if (!filePath) {
    response.writeHead(404);
    response.end("Not Found");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404);
      response.end("Not Found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": path.extname(filePath).toLowerCase() === ".glb"
        ? "model/gltf-binary"
        : contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": pathnameFromUrl.startsWith("/ar-assets/") ? "public, max-age=3600" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(filePath).pipe(response);
  });
});

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });

server.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;
  const expectedOrigin = `http://${request.headers.host}`;
  const secureOrigin = `https://${request.headers.host}`;
  if (origin && origin !== expectedOrigin && origin !== secureOrigin) {
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, request, requestUrl);
  });
});

webSocketServer.on("connection", (socket, _request, requestUrl) => {
  const code = (requestUrl.searchParams.get("code") || "").toUpperCase();
  const role = requestUrl.searchParams.get("role");
  const room = rooms.get(code);
  if (!room) {
    sendError(socket, "Room not found. Create a new room or check the code.");
    return;
  }

  let player;
  if (role === "player") {
    const playerId = requestUrl.searchParams.get("playerId");
    player = room.players.get(playerId);
    if (!player) {
      sendError(socket, "Player not found. Join the room again.");
      return;
    }
    player.connected = true;
  } else if (role !== "host") {
    sendError(socket, "Choose a valid room role.");
    return;
  }

  room.clients.add(socket);
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("close", () => {
    room.clients.delete(socket);
    if (player && player.socket === socket) {
      player.connected = false;
      player.socket = null;
      broadcastRoom(room);
    }
  });
  if (player?.socket && player.socket.readyState === WebSocket.OPEN) {
    player.socket.close(4000, "Reconnected on another device");
  }
  if (player) player.socket = socket;
  socket.send(JSON.stringify(getRoomSnapshot(room)));
  if (player) broadcastRoom(room);
});

const heartbeat = setInterval(() => {
  for (const client of webSocketServer.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);
heartbeat.unref();

const cleanup = setInterval(() => {
  const expiry = Date.now() - roomLifetime;
  for (const [code, room] of rooms) {
    if (room.createdAt < expiry) {
      if (room.roundTimer) clearTimeout(room.roundTimer);
      for (const client of room.clients) client.close(1001, "Room expired");
      rooms.delete(code);
    }
  }
}, 60000);
cleanup.unref();

async function initializeRoundStore() {
  if (!roundStore) {
    console.warn("DATABASE_URL is not configured; completed rounds will not survive server restarts.");
    return;
  }
  await roundStore.query(`
    CREATE TABLE IF NOT EXISTS rounds (
      code CHAR(6) PRIMARY KEY,
      prompt TEXT NOT NULL,
      phase TEXT NOT NULL,
      timer_ends_at BIGINT,
      created_at BIGINT NOT NULL,
      completed_at BIGINT,
      duration_minutes INTEGER,
      contributions JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await roundStore.query(
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS duration_minutes INTEGER",
  );
  await roundStore.query(
    "UPDATE rounds SET phase = 'complete', completed_at = COALESCE(completed_at, $1) WHERE phase = 'active'",
    [Date.now()],
  );
}

const port = Number(process.env.PORT) || 3000;
initializeRoundStore().then(() => {
  server.listen(port, "0.0.0.0", () => {
    console.log(`ARtColab is running on port ${port}`);
  });
}).catch((error) => {
  console.error("Unable to initialize round storage:", error);
  process.exitCode = 1;
  server.close();
});
