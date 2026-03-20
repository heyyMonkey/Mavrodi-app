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
const wheel = document.getElementById("wheel");

let state = null;
let cooldownTimer = null;
let spinInFlight = false;
let wheelRotation = 0;

const segmentAngles = {
  nothing: [18, 54, 126, 162, 198, 234, 270, 306],
  stars: [342],
  bear: [90]
};

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
  spinButton.disabled = spinInFlight || remaining > 0;
  spinButton.textContent = spinInFlight ? "Wheel is spinning..." : remaining > 0 ? "Free spin used" : "Spin now";
}

function startCooldownLoop() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }

  updateCooldown();
  cooldownTimer = setInterval(updateCooldown, 1000);
}

function setWheelRotation(deg, animated) {
  wheel.style.transition = animated
    ? "transform 5000ms cubic-bezier(0.12, 0.8, 0.18, 1)"
    : "none";
  wheelRotation = deg;
  wheel.style.transform = `rotate(${deg}deg)`;
}

function pickTargetAngle(outcome) {
  const candidates = segmentAngles[outcome] || [18];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function animateSpin(outcome) {
  const targetAngle = pickTargetAngle(outcome);
  const extraSpins = 360 * 8;
  const normalizedCurrent = ((wheelRotation % 360) + 360) % 360;
  const finalRotation = wheelRotation + extraSpins + (360 - normalizedCurrent) + targetAngle;

  wheel.classList.add("spinning");
  setWheelRotation(finalRotation, true);
  await wait(5000);
  wheel.classList.remove("spinning");
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
  spinInFlight = true;
  updateCooldown();
  helperText.textContent = "The wheel is turning...";

  try {
    const data = await request("/api/spin");
    await animateSpin(data.outcome);
    state = data;
    applyResultView(data.outcome);
    helperText.textContent =
      data.outcome === "nothing"
        ? "The wheel stopped on a miss. Your next free spin unlocks in 24 hours."
        : data.outcome === "stars"
          ? "The wheel landed on 3 Stars."
          : "The wheel landed on the Bear gift.";
    startCooldownLoop();
  } catch (error) {
    helperText.textContent = error.message;
  } finally {
    spinInFlight = false;
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

spinButton.addEventListener("click", spin);
loadState().catch((error) => {
  playerNameEl.textContent = "Connection failed";
  cooldownEl.textContent = "--:--:--";
  spinButton.disabled = true;
  helperText.textContent = error.message;
});
