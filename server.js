const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const QRCode = require("qrcode");
const { WebSocket, WebSocketServer } = require("ws");

const publicDirectory = path.join(__dirname, "public");
const roomCodeCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomLifetime = 2 * 60 * 60 * 1000;
const maxRequestBytes = 4096;
const vendorFiles = {
  "/vendor/three.core.js": path.join(__dirname, "node_modules", "three", "build", "three.core.js"),
  "/vendor/three.module.js": path.join(__dirname, "node_modules", "three", "build", "three.module.js"),
};
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

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function createRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      roomCodeCharacters[crypto.randomInt(roomCodeCharacters.length)],
    ).join("");
  } while (rooms.has(code));
  return code;
}

function getRoomSnapshot(room) {
  return {
    type: "room",
    code: room.code,
    prompt: room.prompt,
    phase: room.phase,
    players: Array.from(room.players.values(), ({ id, name, connected }) => ({
      id,
      name,
      connected,
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
        const code = createRoomCode();
        const room = {
          code,
          prompt: "Build something unexpected.",
          phase: "lobby",
          players: new Map(),
          clients: new Set(),
          createdAt: Date.now(),
        };
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

      const name = body.name.trim().slice(0, 20);
      const playerId = crypto.randomUUID();
      room.players.set(playerId, { id: playerId, name, connected: false });
      sendJson(response, 201, { code, playerId, name });
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

    if (room.phase !== "active") {
      room.phase = "active";
      broadcastRoom(room);
    }
    sendJson(response, 200, { code, phase: room.phase, prompt: room.prompt });
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
  const filePath = vendorFiles[pathnameFromUrl]
    ? vendorFiles[pathnameFromUrl]
    : path.resolve(publicDirectory, pageAliases[pathnameFromUrl] || pathnameFromUrl.replace(/^[/\\]+/, ""));
  if (
    !vendorFiles[pathnameFromUrl] &&
    !filePath.startsWith(`${publicDirectory}${path.sep}`)
  ) {
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
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
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
      for (const client of room.clients) client.close(1001, "Room expired");
      rooms.delete(code);
    }
  }
}, 60000);
cleanup.unref();

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`ARtColab is running on port ${port}`);
});
