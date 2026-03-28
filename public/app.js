const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const STATE_CACHE_KEY = "lucky-bear-miniapp-v3";
const PAGE_CACHE_KEY = "lucky-bear-miniapp-page-v3";

const playerNameEl = document.getElementById("playerName");
const balanceValue = document.getElementById("balanceValue");
const levelValue = document.getElementById("levelValue");
const homeLevelValue = document.getElementById("homeLevelValue");
const xpValue = document.getElementById("xpValue");
const xpBar = document.getElementById("xpBar");
const streakValue = document.getElementById("streakValue");
const dailyCooldown = document.getElementById("dailyCooldown");
const claimDailyButton = document.getElementById("claimDailyButton");
const spinButton = document.getElementById("spinButton");
const openFortuneButton = document.getElementById("openFortuneButton");
const claimMissionButton = document.getElementById("claimMissionButton");
const dailyResultCard = document.getElementById("dailyResultCard");
const dailyResultTitle = document.getElementById("dailyResultTitle");
const dailyResultText = document.getElementById("dailyResultText");
const gameResultCard = document.getElementById("gameResultCard");
const gameResultTitle = document.getElementById("gameResultTitle");
const gameResultText = document.getElementById("gameResultText");
const missionResultCard = document.getElementById("missionResultCard");
const missionResultTitle = document.getElementById("missionResultTitle");
const missionResultText = document.getElementById("missionResultText");
const missionPlayText = document.getElementById("missionPlayText");
const missionEarnText = document.getElementById("missionEarnText");
const helperText = document.getElementById("helperText");
const wheel = document.getElementById("wheel");
const wheelPointer = document.getElementById("wheelPointer");
const inventoryCount = document.getElementById("inventoryCount");
const inventoryGrid = document.getElementById("inventoryGrid");
const leaderboardList = document.getElementById("leaderboardList");
const pageTrack = document.getElementById("pageTrack");
const tabs = [...document.querySelectorAll(".section-tab")];
const pages = [...document.querySelectorAll(".page-panel")];

let state = null;
let wheelRotation = 0;
let timers = { daily: null };
let spinInFlight = false;
let fortuneInFlight = false;
let dailyInFlight = false;
let missionInFlight = false;

const wheelStops = {
  nothing: [18, 126, 198, 270, 306],
  stars: [54, 162, 234, 342],
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
  const full = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return full || user?.username || `Player ${user?.id || "?"}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDuration(ms) {
  if (ms <= 0) {
    return "Ready now";
  }
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((item) => String(item).padStart(2, "0")).join(":");
}

function setResultCard(element, titleElement, textElement, variant, title, text) {
  element.className = `result-card ${variant}`;
  titleElement.textContent = title;
  textElement.textContent = text;
}

function renderInventory(items) {
  const countLabel = `${items.length} item${items.length === 1 ? "" : "s"}`;
  inventoryCount.textContent = countLabel;

  if (!items.length) {
    inventoryGrid.innerHTML = `
      <article class="inventory-empty">
        <p>No rewards yet.</p>
        <p>Your Bears and Stars cards will appear here.</p>
      </article>
    `;
    return;
  }

  inventoryGrid.innerHTML = items.map((item) => {
    const created = new Date(item.createdAt).toLocaleString();
    if (item.type === "bear") {
      return `
        <article class="inventory-item bear">
          <div class="inventory-media">
            <img src="${item.image}" alt="${item.label}">
          </div>
          <div>
            <p class="label">Rare collectible</p>
            <h3>${item.label}</h3>
            <p>Added ${created}</p>
          </div>
        </article>
      `;
    }

    return `
      <article class="inventory-item stars">
        <div class="inventory-placeholder">
          <div class="stars-badge">${item.label.replace(" ", "<br>")}</div>
        </div>
        <div>
          <p class="label">Reward card</p>
          <h3>${item.label}</h3>
          <p>Added ${created}</p>
        </div>
      </article>
    `;
  }).join("");
}

function renderLeaderboard(rows) {
  if (!rows?.length) {
    leaderboardList.innerHTML = `<article class="leaderboard-empty">No players on the board yet.</article>`;
    return;
  }

  leaderboardList.innerHTML = rows.map((row, index) => `
    <article class="leaderboard-row">
      <div>
        <p class="label">#${index + 1}</p>
        <h3>${formatName(row.user)}</h3>
      </div>
      <div class="leaderboard-metrics">
        <strong>${formatNumber(row.balance)} Stars</strong>
        <span>L${row.level}</span>
      </div>
    </article>
  `).join("");
}

function updateMissionUI() {
  const missions = state?.missions;
  if (!missions) {
    return;
  }

  missionPlayText.textContent = `${missions.playGames.progress} / ${missions.playGames.target}`;
  missionEarnText.textContent = `${missions.earnStars.progress} / ${missions.earnStars.target}`;

  const ready = !missions.claimed &&
    missions.playGames.progress >= missions.playGames.target &&
    missions.earnStars.progress >= missions.earnStars.target;

  claimMissionButton.disabled = missionInFlight || missions.claimed || !ready;
  claimMissionButton.textContent = missionInFlight
    ? "Claiming..."
    : missions.claimed
      ? "Claimed"
      : ready
        ? "Claim Mission Reward"
        : "Finish Missions";
}

function updateHeader() {
  if (!state) {
    return;
  }

  balanceValue.textContent = formatNumber(state.balance);
  levelValue.textContent = state.level;
  homeLevelValue.textContent = state.level;
  xpValue.textContent = formatNumber(state.xp);
  streakValue.textContent = `${state.streak} day${state.streak === 1 ? "" : "s"}`;
  playerNameEl.textContent = formatName(state.user);

  const currentLevelXp = state.xp % 100;
  xpBar.style.width = `${currentLevelXp}%`;

  const dailyRemaining = Math.max(0, (state.nextDailyAt || 0) - Date.now());
  dailyCooldown.textContent = formatDuration(dailyRemaining);
  claimDailyButton.disabled = dailyInFlight || dailyRemaining > 0;
  claimDailyButton.textContent = dailyInFlight ? "Claiming..." : dailyRemaining > 0 ? "Cooldown active" : "Claim Daily";

  const wheelRemaining = Math.max(0, (state.nextWheelAt || 0) - Date.now());
  spinButton.disabled = spinInFlight || wheelRemaining > 0;
  spinButton.textContent = spinInFlight ? "..." : wheelRemaining > 0 ? "WAIT" : "SPIN";

  openFortuneButton.disabled = fortuneInFlight || state.balance < 15;
  openFortuneButton.textContent = fortuneInFlight ? "Opening..." : state.balance < 15 ? "Need 15 Stars" : "Open Fortune Box";

  updateMissionUI();
  renderInventory(state.inventory || []);
  renderLeaderboard(state.leaderboard || []);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setWheelRotation(deg, animated) {
  wheel.style.transition = animated ? "transform 4800ms cubic-bezier(0.12, 0.8, 0.18, 1)" : "none";
  wheelRotation = deg;
  wheel.style.transform = `rotate(${deg}deg)`;
}

async function animateWheel(outcome) {
  const candidates = wheelStops[outcome] || wheelStops.nothing;
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const normalized = ((wheelRotation % 360) + 360) % 360;
  const finalRotation = wheelRotation + 360 * 8 + (360 - normalized) + target;
  wheel.classList.add("spinning");
  setWheelRotation(finalRotation, true);
  await wait(4300);
  wheelPointer.classList.add("dropping");
  await wait(520);
  wheelPointer.classList.remove("dropping");
  wheel.classList.remove("spinning");
}

async function request(path) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getTelegramPayload())
  });

  const data = await response.json().catch(() => ({ error: "Request failed" }));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.payload = data;
    throw error;
  }
  return data;
}

function applyState(nextState) {
  state = nextState;
  window.localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(nextState));
  helperText.textContent = nextState.demoMode
    ? "Demo mode is active because Telegram init data is not available outside Telegram."
    : "Connected with Telegram WebApp user data.";
  updateHeader();
}

async function loadState() {
  const cached = window.localStorage.getItem(STATE_CACHE_KEY);
  if (cached) {
    try {
      applyState(JSON.parse(cached));
    } catch {
      window.localStorage.removeItem(STATE_CACHE_KEY);
    }
  }

  const data = await request("/api/state");
  applyState(data);
  if (timers.daily) {
    clearInterval(timers.daily);
  }
  timers.daily = setInterval(updateHeader, 1000);
}

async function claimDaily() {
  dailyInFlight = true;
  updateHeader();
  try {
    const data = await request("/api/daily");
    applyState(data);
    setResultCard(
      dailyResultCard,
      dailyResultTitle,
      dailyResultText,
      "stars",
      `Daily claimed: ${data.reward + data.streakBonus} Stars`,
      `Base ${data.reward} + streak bonus ${data.streakBonus}. Your streak is now ${data.streak}.`
    );
  } catch (error) {
    if (error.payload) {
      applyState(error.payload);
    }
    setResultCard(dailyResultCard, dailyResultTitle, dailyResultText, "nothing", "Daily locked", error.message);
  } finally {
    dailyInFlight = false;
    updateHeader();
  }
}

async function playWheel() {
  spinInFlight = true;
  updateHeader();
  try {
    const data = await request("/api/games/wheel");
    await animateWheel(data.result.type);
    applyState(data);
    setResultCard(
      gameResultCard,
      gameResultTitle,
      gameResultText,
      data.result.type === "nothing" ? "nothing" : data.result.type === "bear" ? "bear" : "stars",
      data.result.title,
      data.result.message
    );
  } catch (error) {
    if (error.payload) {
      applyState(error.payload);
    }
    setResultCard(gameResultCard, gameResultTitle, gameResultText, "nothing", "Wheel locked", error.message);
  } finally {
    spinInFlight = false;
    updateHeader();
  }
}

async function playFortuneBox() {
  fortuneInFlight = true;
  updateHeader();
  try {
    const data = await request("/api/games/fortune");
    applyState(data);
    setResultCard(
      gameResultCard,
      gameResultTitle,
      gameResultText,
      data.result.type === "nothing" ? "nothing" : data.result.type === "bear" ? "bear" : "stars",
      `${data.result.title} (${data.cost} Stars)`,
      data.result.message
    );
  } catch (error) {
    if (error.payload) {
      applyState(error.payload);
    }
    setResultCard(gameResultCard, gameResultTitle, gameResultText, "nothing", "Fortune Box blocked", error.message);
  } finally {
    fortuneInFlight = false;
    updateHeader();
  }
}

async function claimMissions() {
  missionInFlight = true;
  updateMissionUI();
  try {
    const data = await request("/api/missions/claim");
    applyState(data);
    setResultCard(missionResultCard, missionResultTitle, missionResultText, "stars", "Mission reward claimed", "You received 35 Stars for completing today's missions.");
  } catch (error) {
    if (error.payload) {
      applyState(error.payload);
    }
    setResultCard(missionResultCard, missionResultTitle, missionResultText, "nothing", "Mission reward locked", error.message);
  } finally {
    missionInFlight = false;
    updateMissionUI();
  }
}

function activateTab(targetId) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.target === targetId));
  window.localStorage.setItem(PAGE_CACHE_KEY, targetId);
}

function scrollToPage(targetId) {
  const page = document.getElementById(targetId);
  if (!page) {
    return;
  }
  page.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  activateTab(targetId);
}

function syncTabToScroll() {
  const trackBounds = pageTrack.getBoundingClientRect();
  let closestId = pages[0]?.id;
  let closestDistance = Number.POSITIVE_INFINITY;
  pages.forEach((page) => {
    const distance = Math.abs(page.getBoundingClientRect().left - trackBounds.left);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestId = page.id;
    }
  });
  if (closestId) {
    activateTab(closestId);
  }
}

tabs.forEach((tab) => tab.addEventListener("click", () => scrollToPage(tab.dataset.target)));
pageTrack.addEventListener("scroll", syncTabToScroll, { passive: true });
claimDailyButton.addEventListener("click", claimDaily);
spinButton.addEventListener("click", playWheel);
openFortuneButton.addEventListener("click", playFortuneBox);
claimMissionButton.addEventListener("click", claimMissions);

const cachedPage = window.localStorage.getItem(PAGE_CACHE_KEY);
if (cachedPage && document.getElementById(cachedPage)) {
  requestAnimationFrame(() => scrollToPage(cachedPage));
}

loadState().catch((error) => {
  helperText.textContent = error.message;
});
