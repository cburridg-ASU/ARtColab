const createButton = document.querySelector("#create-room");
const codeElement = document.querySelector("#room-code");
const countElement = document.querySelector("#player-count");
const joinUrlElement = document.querySelector("#join-url");
const promptElement = document.querySelector("#prompt");
const playerList = document.querySelector("#player-list");
const summaryElement = document.querySelector("#player-summary");
const statusElement = document.querySelector("#connection-status");
const errorElement = document.querySelector("#host-error");
const copyButton = document.querySelector("#copy-code");

let roomCode;

function setStatus(text, connected) {
  statusElement.textContent = text;
  statusElement.classList.toggle("is-connected", connected);
}

function showError(message) {
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function renderRoom(room) {
  codeElement.textContent = room.code;
  promptElement.textContent = room.prompt;
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
    joinUrlElement.textContent = `${window.location.host}/join`;
    joinUrlElement.href = `/join?code=${roomCode}`;
    joinUrlElement.setAttribute("aria-label", `Join this room at ${window.location.host}/join`);
    createButton.hidden = true;
    copyButton.disabled = false;
    connectToRoom();
  } catch (error) {
    showError(error.message);
    createButton.disabled = false;
  }
});

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
