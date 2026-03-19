const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const playerNameEl = document.getElementById("playerName");
const cooldownEl = document.getElementById("cooldown");
const spinButton = document.getElementById("spinButton");
const resultCard = document.getElementById("resultCard");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const helperText = document.getElementById("helperText");

let state = null;
let cooldownTimer = null;

function getTelegramPayload() {
  const initData = tg?.initData || "";
  const tgUser = tg?.initDataUnsafe?.user;

  if (initData && tgUser?.id) {
    return {
      initData,
      fallbackUser: {
        id: tgUser.id,
        first_name: tgUser.first_name,
        last_name: tgUser.last_name,
        username: tgUser.username
      }
    };
  }

  return {
    initData: "",
    fallbackUser: {
      id: "demo-user",
      first_name: "Demo",
      last_name: "Player",
      username: "demo_player"
    }
  };
}

function formatName(user) {
  if (!user) {
    return "Unknown player";
  }

  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || `Player ${user.id}`;
}

function formatDuration(ms) {
  if (ms <= 0) {
    return "Available now";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function applyResultView(result) {
  const mapping = {
    nothing: {
      title: "No luck this time",
      text: "That spin landed on nothing. Come back when your next free spin unlocks.",
      className: "nothing"
    },
    stars: {
      title: "You won 3 Stars",
      text: "Nice hit. In this demo, the reward is recorded locally on the server.",
      className: "stars"
    },
    bear: {
      title: "Bear gift jackpot",
      text: "That is the rarest outcome in the demo. You hit the Bear gift slot.",
      className: "bear"
    }
  };

  const view = mapping[result] || {
    title: "Ready to spin",
    text: "Your daily demo spin is waiting.",
    className: "neutral"
  };

  resultCard.className = `result-card ${view.className}`;
  resultTitle.textContent = view.title;
  resultText.textContent = view.text;
}

function updateCooldown() {
  if (!state) {
    return;
  }

  const remaining = Math.max(0, state.nextSpinAt - Date.now());
  cooldownEl.textContent = formatDuration(remaining);
  spinButton.disabled = remaining > 0;
  spinButton.textContent = remaining > 0 ? "Free spin used" : "Spin now";
}

function startCooldownLoop() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }

  updateCooldown();
  cooldownTimer = setInterval(updateCooldown, 1000);
}

async function request(path, options = {}) {
  const payload = getTelegramPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

async function loadState() {
  const data = await request("/api/state");
  state = data;
  playerNameEl.textContent = formatName(data.user);
  helperText.textContent = data.demoMode
    ? "Demo mode is active because Telegram init data is not available outside Telegram."
    : "Connected with Telegram WebApp user data.";

  applyResultView(data.lastOutcome || "neutral");
  startCooldownLoop();
}

async function spin() {
  spinButton.disabled = true;
  spinButton.textContent = "Spinning...";

  try {
    const data = await request("/api/spin");
    state = data;
    applyResultView(data.outcome);
    startCooldownLoop();
  } catch (error) {
    helperText.textContent = error.message;
  } finally {
    updateCooldown();
  }
}

spinButton.addEventListener("click", spin);
loadState().catch((error) => {
  playerNameEl.textContent = "Connection failed";
  cooldownEl.textContent = "--:--:--";
  spinButton.disabled = true;
  helperText.textContent = error.message;
});
