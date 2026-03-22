// Telegram Mini Apps expose data on window.Telegram.WebApp.
// These calls make the Mini App initialize and open in an expanded view.
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const STATE_CACHE_KEY = "lucky-bear-state-v2";
const PAGE_CACHE_KEY = "lucky-bear-page-v1";

// Cache the main DOM elements once so the app can reuse them later.
const playerNameEl = document.getElementById("playerName");
// Ticket balance label in the top status bar.
const ticketBalanceEl = document.getElementById("ticketBalance");
const cooldownEl = document.getElementById("cooldown");
const spinButton = document.getElementById("spinButton");
const openCaseButton = document.getElementById("openCaseButton");
const resultCard = document.getElementById("resultCard");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const caseResultCard = document.getElementById("caseResultCard");
const caseResultTitle = document.getElementById("caseResultTitle");
const caseResultText = document.getElementById("caseResultText");
const helperText = document.getElementById("helperText");
const wheel = document.getElementById("wheel");
const wheelPointer = document.getElementById("wheelPointer");
const pageTrack = document.getElementById("pageTrack");
const inventoryGrid = document.getElementById("inventoryGrid");
const inventoryCount = document.getElementById("inventoryCount");
const tabs = [...document.querySelectorAll(".section-tab")];
const pages = [...document.querySelectorAll(".page-panel")];

// Shared frontend state.
// `state` is the latest backend response for the current player.
let state = null;
let cooldownTimer = null;
let spinInFlight = false;
let caseInFlight = false;
let wheelRotation = 0;

// Visual stop points for the daily wheel animation.
// The server decides the prize, then the UI chooses one matching angle.
const spinSegmentAngles = {
  nothing: [18, 54, 126, 162, 198, 234, 270, 306],
  stars: [342],
  bear: [90]
};

const defaultBearImages = ["/assets/bear-1.png", "/assets/bear-2.png", "/assets/bear-3.png"];

// Build the payload used for every backend request.
// In Telegram we send signed init data.
// In a normal browser we fall back to a demo user so local testing still works.
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

// Turn the Telegram user object into a readable display name.
function formatName(user) {
  if (!user) {
    return "Unknown player";
  }

  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || `Player ${user.id}`;
}

// Format numbers like 1000 -> 1,000.
function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

// Convert remaining milliseconds into HH:MM:SS for the cooldown label.
function formatDuration(ms) {
  if (ms <= 0) {
    return "Available now";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

// Update the daily spin result card styling and text.
function applySpinResultView(result) {
  const mapping = {
    nothing: {
      title: "No luck this time",
      text: "That spin landed on nothing. Come back when your next free spin unlocks.",
      className: "nothing"
    },
    stars: {
      title: "You won STARS 3X",
      text: "A shiny Stars reward has been added to your inventory.",
      className: "stars"
    },
    bear: {
      title: "Bear gift jackpot",
      text: "The Bear reward has been added to your inventory.",
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

// Update the case opening result card styling and text.
function applyCaseResultView(result) {
  const mapping = {
    nothing: {
      title: "Empty case",
      text: "This one came up empty, but your next case might pop.",
      className: "nothing"
    },
    stars: {
      title: "STARS 3X found",
      text: "A Stars reward card has been placed in your inventory.",
      className: "stars"
    },
    bear: {
      title: "Bear gift found",
      text: "A Bear gift has been placed in your inventory.",
      className: "bear"
    },
    tickets_500: {
      title: "+500 tickets",
      text: "Half your case price came back straight into balance.",
      className: "tickets"
    }
  };

  const view = mapping[result] || {
    title: "Case unopened",
    text: "Use tickets to open your first Golden Bear Case.",
    className: "neutral"
  };

  caseResultCard.className = `result-card ${view.className}`;
  caseResultTitle.textContent = view.title;
  caseResultText.textContent = view.text;
}

// Render every saved reward into the inventory page.
// Bears become image cards, stars become a badge, tickets become a bonus card.
function renderInventory(items) {
  inventoryCount.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    inventoryGrid.innerHTML = `
      <article class="inventory-empty">
        <p>No rewards yet.</p>
        <p>Your Bear gifts and STARS 3X drops will appear here.</p>
      </article>
    `;
    return;
  }

  inventoryGrid.innerHTML = items
    .map((item) => {
      const created = new Date(item.createdAt).toLocaleString();

      if (item.type === "bear") {
        const fallbackIndex = Math.abs(String(item.id || created).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % defaultBearImages.length;
        const bearAsset = item.image || defaultBearImages[fallbackIndex];
        return `
          <article class="inventory-item bear">
            <div class="inventory-media">
              <img src="${bearAsset}" alt="${item.label}" onerror="this.onerror=null;this.src='${defaultBearImages[0]}'">
            </div>
            <div>
              <p class="label">Rare drop</p>
              <h3>${item.label}</h3>
              <p>Added ${created}</p>
            </div>
          </article>
        `;
      }

      if (item.type === "stars") {
        return `
          <article class="inventory-item stars">
            <div class="inventory-placeholder">
              <div class="stars-badge">STARS<br>3X</div>
            </div>
            <div>
              <p class="label">Reward card</p>
              <h3>${item.label}</h3>
              <p>Added ${created}</p>
            </div>
          </article>
        `;
      }

      return `
        <article class="inventory-item tickets">
          <div class="inventory-placeholder">
            <div class="tickets-badge">TICKETS<br>+${item.amount || 0}</div>
          </div>
          <div>
            <p class="label">Bonus</p>
            <h3>${item.label}</h3>
            <p>Added ${created}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

// Refresh the top status bar and button states from the latest state.
function updateHeaderState() {
  if (!state) {
    return;
  }

  // Current player ticket amount from backend state.
  ticketBalanceEl.textContent = formatNumber(state.tickets);

  const remaining = Math.max(0, state.nextSpinAt - Date.now());
  cooldownEl.textContent = formatDuration(remaining);
  spinButton.disabled = spinInFlight || remaining > 0;
  spinButton.textContent = spinInFlight ? "..." : remaining > 0 ? "WAIT" : "SPIN";
  openCaseButton.disabled = caseInFlight || state.tickets < state.casePrice;
  openCaseButton.textContent = caseInFlight
    ? "OPENING..."
    : state.tickets < state.casePrice
      ? "NEED 1000 TICKETS"
      : "OPEN CASE";
}

// Start a one-second timer so the cooldown display updates live.
function startCooldownLoop() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }

  updateHeaderState();
  cooldownTimer = setInterval(updateHeaderState, 1000);
}

// Apply the wheel rotation in CSS.
function setWheelRotation(deg, animated) {
  wheel.style.transition = animated
    ? "transform 5000ms cubic-bezier(0.12, 0.8, 0.18, 1)" 
    : "none";
  wheelRotation = deg;
  wheel.style.transform = `rotate(${deg}deg)`;
}

// Pick one of the valid visual stop points for a given reward.
function pickTargetAngle(outcome) {
  const candidates = spinSegmentAngles[outcome] || [18];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Small helper for waiting during animations.
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Play the wheel animation and the pointer drop at the end.
async function animateSpin(outcome) {
  const targetAngle = pickTargetAngle(outcome);
  const extraSpins = 360 * 8;
  const normalizedCurrent = ((wheelRotation % 360) + 360) % 360;
  const finalRotation = wheelRotation + extraSpins + (360 - normalizedCurrent) + targetAngle;

  wheel.classList.add("spinning");
  setWheelRotation(finalRotation, true);
  await wait(4500);
  wheelPointer.classList.add("dropping");
  await wait(520);
  wheelPointer.classList.remove("dropping");
  wheel.classList.remove("spinning");
}

// Generic POST helper for all frontend -> backend API requests.
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

  const data = await response.json().catch(() => ({ error: "Request failed" }));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.payload = data;
    throw error;
  }

  return data;
}

// Take fresh backend state and repaint the UI from it.
function applyState(nextState) {
  state = nextState;
  window.localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(nextState));
  playerNameEl.textContent = formatName(nextState.user);
  helperText.textContent = nextState.demoMode
    ? "Demo mode is active because Telegram init data is not available outside Telegram."
    : "Connected with Telegram WebApp user data.";
  applySpinResultView(nextState.lastOutcome || "neutral");
  applyCaseResultView(nextState.lastCaseOutcome || "neutral");
  renderInventory(nextState.inventory || []);
  updateHeaderState();
}

// Load the player state when the app first opens.
async function loadState() {
  const cachedState = window.localStorage.getItem(STATE_CACHE_KEY);
  if (cachedState) {
    try {
      applyState(JSON.parse(cachedState));
    } catch {
      window.localStorage.removeItem(STATE_CACHE_KEY);
    }
  }

  const data = await request("/api/state");
  applyState(data);
  startCooldownLoop();
}

// Daily free spin flow.
async function spin() {
  spinInFlight = true;
  updateHeaderState();
  helperText.textContent = "The wheel is turning...";

  try {
    const data = await request("/api/spin");
    await animateSpin(data.outcome);
    applyState(data);
    helperText.textContent =
      data.outcome === "nothing"
        ? "The wheel stopped on a miss. Your next free spin unlocks in 24 hours."
        : data.outcome === "stars"
          ? "The wheel landed on STARS 3X."
          : "The wheel landed on the Bear gift.";
    startCooldownLoop();
  } catch (error) {
    if (error.payload) {
      applyState(error.payload);
    }
    helperText.textContent = error.message;
  } finally {
    spinInFlight = false;
    updateHeaderState();
  }
}

// Ticket case opening flow.
async function openCase() {
  caseInFlight = true;
  updateHeaderState();
  caseResultTitle.textContent = "Opening case...";
  caseResultText.textContent = "The Golden Bear Case is cracking open.";

  try {
    const data = await request("/api/case/open");
    applyState(data);
  } catch (error) {
    if (error.payload) {
      applyState(error.payload);
    }
    caseResultCard.className = "result-card neutral";
    caseResultTitle.textContent = "Case blocked";
    caseResultText.textContent = error.message;
  } finally {
    caseInFlight = false;
    updateHeaderState();
  }
}

// Highlight the active top tab.
function activateTab(targetId) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.target === targetId);
  });
  window.localStorage.setItem(PAGE_CACHE_KEY, targetId);
}

// Smooth-scroll horizontally to the chosen page.
function scrollToPage(targetId) {
  const page = document.getElementById(targetId);
  if (!page) {
    return;
  }

  page.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "start"
  });
  activateTab(targetId);
}

// While the user swipes, keep the active tab matched to the visible page.
function syncTabToScroll() {
  const trackBounds = pageTrack.getBoundingClientRect();
  let closestId = pages[0]?.id;
  let closestDistance = Number.POSITIVE_INFINITY;

  pages.forEach((page) => {
    const bounds = page.getBoundingClientRect();
    const distance = Math.abs(bounds.left - trackBounds.left);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestId = page.id;
    }
  });

  if (closestId) {
    activateTab(closestId);
  }
}

// Wire up page navigation.
tabs.forEach((tab) => {
  tab.addEventListener("click", () => scrollToPage(tab.dataset.target));
});

pageTrack.addEventListener("scroll", syncTabToScroll, { passive: true });
spinButton.addEventListener("click", spin);
openCaseButton.addEventListener("click", openCase);

const cachedPage = window.localStorage.getItem(PAGE_CACHE_KEY);
if (cachedPage && document.getElementById(cachedPage)) {
  requestAnimationFrame(() => scrollToPage(cachedPage));
}

// If the first load fails, disable gameplay and show the error.
loadState().catch((error) => {
  playerNameEl.textContent = "Connection failed";
  ticketBalanceEl.textContent = "--";
  cooldownEl.textContent = "--:--:--";
  spinButton.disabled = true;
  openCaseButton.disabled = true;
  helperText.textContent = error.message;
});
