import { renderShowcase } from "/showcase.js";

const createButton = document.querySelector("#create-room");
const codeElement = document.querySelector("#room-code");
const countElement = document.querySelector("#player-count");
const joinUrlElement = document.querySelector("#join-url");
const qrImage = document.querySelector("#room-qr");
const promptElement = document.querySelector("#prompt");
const promptPanel = document.querySelector("#prompt-panel");
const timerElement = document.querySelector("#round-timer");
const completeElement = document.querySelector("#round-complete");
const showcasePanel = document.querySelector("#host-showcase-panel");
const showcaseCanvas = document.querySelector("#host-showcase");
const showcasePlayers = document.querySelector("#host-showcase-players");
const resultsLink = document.querySelector("#host-results-link");
const resultsQr = document.querySelector("#host-results-qr");
const playerList = document.querySelector("#player-list");
const summaryElement = document.querySelector("#player-summary");
const statusElement = document.querySelector("#connection-status");
const errorElement = document.querySelector("#host-error");
const copyButton = document.querySelector("#copy-code");
const startButton = document.querySelector("#start-session");
const durationLabel = document.querySelector("#round-duration-label");
const durationSelect = document.querySelector("#round-duration");
const sessionErrorElement = document.querySelector("#session-error");

let roomCode;
let timerEndsAt = null;
let renderedResultsCode = null;
let loadingResultsCode = null;

function updateRoundTimer() {
  if (!timerEndsAt) {
    timerElement.hidden = true;
    return;
  }
  const secondsRemaining = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
  timerElement.textContent = `TIME LEFT ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  timerElement.hidden = false;
}

function setStatus(text, connected) {
  statusElement.textContent = text;
  statusElement.classList.toggle("is-connected", connected);
}

function showError(message) {
  errorElement.textContent = message;
  errorElement.hidden = false;
}

async function loadCompletedResults(code) {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/results`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load the finished round.");
    showcasePanel.hidden = false;
    const resultUrl = `/join?code=${encodeURIComponent(code)}`;
    resultsLink.href = resultUrl;
    resultsQr.src = `/api/rooms/${encodeURIComponent(code)}/qr`;
    resultsQr.hidden = false;
    await renderShowcase(showcaseCanvas, result.contributions, showcasePlayers);
    renderedResultsCode = code;
  } catch (error) {
    sessionErrorElement.textContent = error.message;
    sessionErrorElement.hidden = false;
  } finally {
    loadingResultsCode = null;
  }
}

function renderRoom(room) {
  document.querySelector(".game-content").classList.toggle("is-showcasing", room.phase === "complete");
  codeElement.textContent = room.code;
  promptElement.textContent = room.prompt;
  timerEndsAt = room.timerEndsAt || null;
  promptPanel.hidden = room.phase === "lobby";
  completeElement.hidden = room.phase !== "complete";
  startButton.hidden = room.phase !== "lobby";
  durationLabel.hidden = room.phase !== "lobby";
  startButton.disabled = false;
  updateRoundTimer();
  if (room.phase === "complete" && renderedResultsCode !== room.code && loadingResultsCode !== room.code) {
    loadingResultsCode = room.code;
    loadCompletedResults(room.code);
  }
  const connectedPlayers = room.players.filter((player) => player.connected);
  countElement.textContent = `${connectedPlayers.length} ${connectedPlayers.length === 1 ? "PLAYER" : "PLAYERS"}`;
  summaryElement.textContent = room.players.length
    ? `${connectedPlayers.length} of ${room.players.length} connected`
    : "Waiting for friends";
  playerList.replaceChildren();
  if (room.players.length === 0) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty-state";
    emptyState.textContent = "Your friends will show up here.";
    playerList.append(emptyState);
    return;
  }

  for (const player of room.players) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const connection = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;
    connection.className = `player-connection${player.connected ? " is-connected" : ""}`;
    connection.textContent = player.connected ? "IN" : "RECONNECTING";
    item.append(name, connection);
    playerList.append(item);
  }
}

function connectToRoom() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws?role=host&code=${roomCode}`);

  socket.addEventListener("open", () => setStatus("SCREEN CONNECTED", true));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "room") renderRoom(message);
    if (message.type === "error") showError(message.message);
  });
  socket.addEventListener("close", () => {
    setStatus("RECONNECTING", false);
    if (roomCode) window.setTimeout(connectToRoom, 1500);
  });
  socket.addEventListener("error", () => setStatus("CONNECTION ISSUE", false));
}

createButton.addEventListener("click", async () => {
  createButton.disabled = true;
  errorElement.hidden = true;
  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not create a room.");

    roomCode = result.code;
    codeElement.textContent = roomCode;
    promptElement.textContent = result.prompt;
    const joinUrl = new URL(`/join?code=${encodeURIComponent(roomCode)}`, window.location.origin);
    joinUrlElement.textContent = `${window.location.host}/join`;
    joinUrlElement.href = joinUrl.pathname + joinUrl.search;
    joinUrlElement.setAttribute("aria-label", `Join this room at ${window.location.host}/join`);
    qrImage.src = `/api/rooms/${encodeURIComponent(roomCode)}/qr`;
    qrImage.hidden = false;
    createButton.hidden = true;
    copyButton.disabled = false;
    startButton.hidden = false;
    durationLabel.hidden = false;
    connectToRoom();
  } catch (error) {
    showError(error.message);
    createButton.disabled = false;
  }
});

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  sessionErrorElement.hidden = true;
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMinutes: Number(durationSelect.value) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not start the session.");
    promptElement.textContent = result.prompt;
    promptPanel.hidden = false;
    startButton.hidden = true;
    durationLabel.hidden = true;
    timerEndsAt = result.timerEndsAt;
    updateRoundTimer();
  } catch (error) {
    sessionErrorElement.textContent = error.message;
    sessionErrorElement.hidden = false;
    startButton.disabled = false;
  }
});

window.setInterval(updateRoundTimer, 1000);

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    copyButton.textContent = "Copied!";
    window.setTimeout(() => {
      copyButton.textContent = "Copy room code";
    }, 1500);
  } catch {
    showError("Could not copy the code. Share it with your players instead.");
  }
});

qrImage.addEventListener("error", () => {
  showError("Could not load the QR code. Players can still join with the room code.");
});
