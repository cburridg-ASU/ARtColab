import { enterAR } from "/ar.js";
import { primitives } from "/primitives.js";
import { renderShowcase } from "/showcase.js";

const joinForm = document.querySelector("#join-form");
const codeInput = document.querySelector("#room-code-input");
const nameInput = document.querySelector("#player-name");
const errorElement = document.querySelector("#join-error");
const joinedPanel = document.querySelector("#joined-panel");
const joinedName = document.querySelector("#joined-name");
const connectionElement = document.querySelector("#player-connection");
const gamePanel = document.querySelector("#mobile-game-panel");
const mobilePrompt = document.querySelector("#mobile-prompt");
const playerPrimitiveName = document.querySelector("#player-primitive-name");
const mobileTimerElement = document.querySelector("#mobile-round-timer");
const arTimerElement = document.querySelector("#ar-round-timer");
const mobileCompleteElement = document.querySelector("#mobile-round-complete");
const mobileResultPanel = document.querySelector("#mobile-result-panel");
const mobileShowcaseCanvas = document.querySelector("#mobile-showcase");
const mobileShowcasePlayers = document.querySelector("#mobile-showcase-players");
const viewShowcaseArButton = document.querySelector("#view-showcase-ar");
const viewShowcaseCameraButton = document.querySelector("#view-showcase-camera");
const resultError = document.querySelector("#result-error");
const enterArButton = document.querySelector("#enter-ar");
const cameraPreviewButton = document.querySelector("#camera-preview");
const arError = document.querySelector("#ar-error");
const arOverlay = document.querySelector("#ar-overlay");
const arPrompt = document.querySelector("#ar-prompt");
const exitArButton = document.querySelector("#exit-ar");

let playerId;
let roomCode;
let primitiveIndex = null;
let timerEndsAt = null;
let roundComplete = false;
let latestObjects = [];
let savedContributions = [];
let showcaseDisposer = null;
let renderedResultsCode = null;
let loadingResultsCode = null;

function updateRoundTimer() {
  if (!timerEndsAt) return;
  const secondsRemaining = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
  const time = `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  mobileTimerElement.textContent = `TIME LEFT ${time}`;
  arTimerElement.textContent = time;
}

async function restoreSavedResults(code) {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/results`);
    if (response.status === 404 || response.status === 409) return;
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load the saved showcase.");
    roomCode = code;
    joinForm.hidden = true;
    await showRoundComplete(result.prompt, result);
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  }
}

const initialCode = new URLSearchParams(window.location.search).get("code");
if (initialCode) {
  codeInput.value = initialCode.toUpperCase().slice(0, 6);
  restoreSavedResults(codeInput.value);
}

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
      if (message.phase === "active") {
        timerEndsAt = message.timerEndsAt;
        roundComplete = false;
        showActivePrompt(message.prompt);
        updateRoundTimer();
      } else if (message.phase === "complete") {
        timerEndsAt = message.timerEndsAt;
        showRoundComplete(message.prompt);
        updateRoundTimer();
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

function showActivePrompt(prompt) {
  roundComplete = false;
  mobilePrompt.textContent = prompt;
  arPrompt.textContent = prompt;
  mobileCompleteElement.hidden = true;
  enterArButton.hidden = false;
  cameraPreviewButton.hidden = true;
  joinedPanel.hidden = true;
  gamePanel.hidden = false;
  mobileResultPanel.hidden = true;
}

async function showRoundComplete(prompt, completedResult = null) {
  if (renderedResultsCode === roomCode || loadingResultsCode === roomCode) return;
  loadingResultsCode = roomCode;
  roundComplete = true;
  mobilePrompt.textContent = prompt;
  arPrompt.textContent = prompt;
  joinedPanel.hidden = true;
  gamePanel.hidden = true;
  mobileResultPanel.hidden = false;
  exitArButton.click();
  resultError.hidden = true;
  viewShowcaseArButton.disabled = true;
  let saveWarning = "";
  try {
    try {
      await saveObjects(latestObjects);
    } catch (error) {
      console.error("Could not save the final placements before showing results:", error);
      saveWarning = "Some final placements may not have been saved. " + error.message;
    }
    let result = completedResult;
    if (!result) {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/results`);
      result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load the finished round.");
    }
    savedContributions = result.contributions;
    showcaseDisposer?.();
    showcaseDisposer = await renderShowcase(
      mobileShowcaseCanvas,
      savedContributions,
      mobileShowcasePlayers,
    );
    renderedResultsCode = roomCode;
    const hasObjects = savedContributions.some((entry) => entry.objects.length > 0);
    viewShowcaseArButton.disabled = !hasObjects;
    viewShowcaseCameraButton.disabled = !hasObjects;
    if (saveWarning) {
      resultError.textContent = saveWarning;
      resultError.hidden = false;
    }
  } catch (error) {
    resultError.textContent = error.message;
    resultError.hidden = false;
  } finally {
    loadingResultsCode = null;
  }
}

async function restoreShowcase() {
  if (mobileResultPanel.hidden || !Array.isArray(savedContributions)) return;
  try {
    showcaseDisposer?.();
    showcaseDisposer = await renderShowcase(
      mobileShowcaseCanvas,
      savedContributions,
      mobileShowcasePlayers,
    );
    const hasObjects = savedContributions.some((entry) => entry.objects.length > 0);
    viewShowcaseArButton.disabled = !hasObjects;
    viewShowcaseCameraButton.disabled = !hasObjects;
  } catch (error) {
    resultError.textContent = error.message;
    resultError.hidden = false;
  }
}

async function startAR(mode, contributions = null) {
  if (roundComplete && !contributions) return;
  const isViewingShowcase = Array.isArray(contributions);
  if (isViewingShowcase) {
    viewShowcaseArButton.disabled = true;
    viewShowcaseCameraButton.disabled = true;
    showcaseDisposer?.();
    showcaseDisposer = null;
  }
  enterArButton.disabled = true;
  cameraPreviewButton.disabled = true;
  arError.hidden = true;
  try {
    const session = await enterAR({
      overlay: arOverlay,
      prompt: arPrompt.textContent,
      exitButton: exitArButton,
      mode,
      contributions,
      primitiveIndex: primitiveIndex ?? 0,
      onObjectsChange: (objects, placementSpace) => {
        latestObjects = objects;
        return contributions ? undefined : saveObjects(objects, placementSpace);
      },
      onExit: () => {
        if (isViewingShowcase) void restoreShowcase();
      },
    });
    arError.hidden = true;
    cameraPreviewButton.hidden = true;
    if (roundComplete && !isViewingShowcase) exitArButton.click();
  } catch (error) {
    if (roundComplete) {
      resultError.textContent = error.message;
      resultError.hidden = false;
    } else {
      arError.textContent = error.message;
      arError.hidden = false;
      cameraPreviewButton.hidden = false;
    }
    if (isViewingShowcase) await restoreShowcase();
  } finally {
    enterArButton.disabled = false;
    cameraPreviewButton.disabled = false;
    if (isViewingShowcase) {
      viewShowcaseArButton.disabled = savedContributions.every((entry) => entry.objects.length === 0);
      viewShowcaseCameraButton.disabled = viewShowcaseArButton.disabled;
    }
  }
}

enterArButton.addEventListener("click", () => startAR("immersive"));
cameraPreviewButton.addEventListener("click", () => startAR("camera"));
viewShowcaseArButton.addEventListener("click", () => startAR("immersive", savedContributions));
viewShowcaseCameraButton.addEventListener("click", () => startAR("camera", savedContributions));

window.setInterval(updateRoundTimer, 1000);

async function saveObjects(objects, placementSpace = "player-origin") {
  if (!roomCode || !playerId) return;
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/contributions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, objects, placementSpace }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not save your objects.");
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
    primitiveIndex = result.primitiveIndex;
    playerPrimitiveName.textContent = primitives[primitiveIndex]?.name || "Unavailable";
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
