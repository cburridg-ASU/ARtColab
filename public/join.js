const joinForm = document.querySelector("#join-form");
const codeInput = document.querySelector("#room-code-input");
const nameInput = document.querySelector("#player-name");
const errorElement = document.querySelector("#join-error");
const joinedPanel = document.querySelector("#joined-panel");
const joinedName = document.querySelector("#joined-name");
const connectionElement = document.querySelector("#player-connection");

let playerId;
let roomCode;

const initialCode = new URLSearchParams(window.location.search).get("code");
if (initialCode) codeInput.value = initialCode.toUpperCase().slice(0, 6);

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});

function connectToRoom() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = new URLSearchParams({ role: "player", code: roomCode, playerId });
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws?${query}`);

  socket.addEventListener("open", () => {
    connectionElement.textContent = "CONNECTED";
    connectionElement.classList.add("is-connected");
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "error") {
      errorElement.textContent = message.message;
      errorElement.hidden = false;
      return;
    }
    if (message.type === "room") {
      const player = message.players.find((entry) => entry.id === playerId);
      if (!player) {
        errorElement.textContent = "You are no longer in this room. Join again from the host screen.";
        errorElement.hidden = false;
      }
    }
  });
  socket.addEventListener("close", () => {
    connectionElement.textContent = "RECONNECTING";
    connectionElement.classList.remove("is-connected");
    window.setTimeout(connectToRoom, 1500);
  });
  socket.addEventListener("error", () => {
    connectionElement.textContent = "CONNECTION ISSUE";
    connectionElement.classList.remove("is-connected");
  });
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = joinForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  errorElement.hidden = true;

  try {
    roomCode = codeInput.value.trim().toUpperCase();
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not join the room.");

    playerId = result.playerId;
    joinedName.textContent = result.name;
    joinForm.hidden = true;
    joinedPanel.hidden = false;
    connectToRoom();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
    submitButton.disabled = false;
  }
});
