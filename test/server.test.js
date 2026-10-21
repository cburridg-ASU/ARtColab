const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");

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
