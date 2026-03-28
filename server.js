import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const dataFile = join(dataDir, "players.json");

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WHEEL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTER_STARS = 100;
const FORTUNE_BOX_COST = 15;
const BEAR_ASSETS = ["/assets/bear-1.png", "/assets/bear-2.png", "/assets/bear-3.png"];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

if (!existsSync(dataFile)) {
  writeFileSync(dataFile, JSON.stringify({ players: {} }, null, 2));
}

function loadEnvFile() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const [key, ...rest] = line.split("=");
    if (key && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join("=").trim();
    }
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const APP_URL = process.env.APP_URL || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "demo-secret";

function readStore() {
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

function writeStore(store) {
  writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, "http://localhost");
  const requestPath = parsedUrl.pathname === "/" ? "/index.html" : parsedUrl.pathname;
  const filePath = normalize(join(publicDir, requestPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  });
  res.end(readFileSync(filePath));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const sorted = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const userValue = params.get("user");
  return {
    hash,
    sorted,
    user: userValue ? JSON.parse(userValue) : null
  };
}

function validateInitData(initData) {
  if (!BOT_TOKEN || !initData) {
    return null;
  }

  const { hash, sorted, user } = parseInitData(initData);
  if (!hash || !user) {
    return null;
  }

  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computed = createHmac("sha256", secretKey).update(sorted).digest("hex");
  const left = Buffer.from(computed, "utf8");
  const right = Buffer.from(hash, "utf8");

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  return user;
}

function deriveDemoUser(fallbackUser = {}) {
  const rawId = String(fallbackUser.id || randomUUID());
  const signedId = createHmac("sha256", SESSION_SECRET).update(rawId).digest("hex");
  return {
    id: `demo-${signedId.slice(0, 16)}`,
    first_name: fallbackUser.first_name || "Demo",
    last_name: fallbackUser.last_name || "Player",
    username: fallbackUser.username || "demo_player"
  };
}

function calculateLevel(xp) {
  return Math.max(1, 1 + Math.floor(xp / 100));
}

function dailyMissionTargets(level) {
  return {
    playGames: level < 10 ? 3 : 5,
    earnStars: level < 10 ? 25 : 40
  };
}

function resetMissionsIfNeeded(record) {
  const today = new Date().toISOString().slice(0, 10);
  if (record.missions.date === today) {
    return;
  }

  const targets = dailyMissionTargets(record.level);
  record.missions = {
    date: today,
    playGames: { progress: 0, target: targets.playGames },
    earnStars: { progress: 0, target: targets.earnStars },
    claimed: false
  };
}

function ensureRecordShape(record, user) {
  record.user = user;
  record.balance ??= STARTER_STARS;
  record.level ??= 1;
  record.xp ??= 0;
  record.streak ??= 0;
  record.referrals ??= 0;
  record.lastDailyAt ??= 0;
  record.lastDailyClaimAt ??= 0;
  record.lastWheelAt ??= 0;
  record.lastWheelOutcome ??= null;
  record.lastFortuneOutcome ??= null;
  record.totalGamesPlayed ??= 0;
  record.totalStarsEarned ??= 0;
  record.inventory ??= [];
  record.achievements ??= [];
  record.transactions ??= [];
  record.createdAt ??= Date.now();
  record.lastActivityAt = Date.now();
  record.wins ??= { bears: 0, starsCards: 0 };
  record.missions ??= {
    date: "",
    playGames: { progress: 0, target: 3 },
    earnStars: { progress: 0, target: 25 },
    claimed: false
  };
  resetMissionsIfNeeded(record);
}

function getPlayerRecord(store, user) {
  if (!store.players[user.id]) {
    store.players[user.id] = { user };
  }
  ensureRecordShape(store.players[user.id], user);
  return store.players[user.id];
}

function logTransaction(record, type, amount, meta = {}) {
  record.transactions.unshift({
    id: randomUUID(),
    type,
    amount,
    createdAt: Date.now(),
    meta
  });
  record.transactions = record.transactions.slice(0, 50);
}

function addInventoryItem(record, item) {
  record.inventory.unshift({
    id: randomUUID(),
    createdAt: Date.now(),
    ...item
  });
}

function awardStars(record, amount, type, meta = {}) {
  record.balance += amount;
  record.totalStarsEarned += Math.max(amount, 0);
  record.missions.earnStars.progress += Math.max(amount, 0);
  record.xp += Math.max(5, Math.floor(Math.max(amount, 0) / 2));
  record.level = calculateLevel(record.xp);
  logTransaction(record, type, amount, meta);
}

function spendStars(record, amount, type, meta = {}) {
  if (record.balance < amount) {
    return false;
  }
  record.balance -= amount;
  logTransaction(record, type, -amount, meta);
  return true;
}

function pickRandomBearAsset() {
  return BEAR_ASSETS[Math.floor(Math.random() * BEAR_ASSETS.length)];
}

function rollDailyWheel() {
  const roll = Math.random();
  if (roll < 0.01) {
    return { type: "bear", stars: 0, xp: 30, title: "Bear Gift", message: "Legendary Bear unlocked." };
  }
  if (roll < 0.15) {
    return { type: "stars", stars: 12, xp: 18, title: "Stars 12X", message: "A strong daily pull." };
  }
  if (roll < 0.45) {
    return { type: "stars", stars: 6, xp: 12, title: "Stars 6X", message: "A nice daily bonus." };
  }
  return { type: "nothing", stars: 0, xp: 8, title: "Miss", message: "No stars this time, but your streak continues." };
}

function rollFortuneBox() {
  const roll = Math.random();
  if (roll < 0.08) {
    return { type: "bear", stars: 0, xp: 30, title: "Bear Gift", message: "Rare Bear found in the Fortune Box." };
  }
  if (roll < 0.3) {
    return { type: "stars", stars: 25, xp: 22, title: "Stars 25X", message: "Big Stars burst." };
  }
  if (roll < 0.7) {
    return { type: "stars", stars: 12, xp: 14, title: "Stars 12X", message: "Solid reward from the box." };
  }
  return { type: "nothing", stars: 0, xp: 10, title: "Empty Box", message: "The box was empty, but you still gained a little XP." };
}

function claimMissionReward(record) {
  resetMissionsIfNeeded(record);
  const { playGames, earnStars } = record.missions;
  if (record.missions.claimed || playGames.progress < playGames.target || earnStars.progress < earnStars.target) {
    return false;
  }
  record.missions.claimed = true;
  awardStars(record, 35, "missions_claim", { reward: 35 });
  record.xp += 20;
  record.level = calculateLevel(record.xp);
  return true;
}

function leaderboard(store) {
  return Object.values(store.players)
    .map((record) => {
      ensureRecordShape(record, record.user);
      return {
        user: record.user,
        balance: record.balance,
        level: record.level,
        totalStarsEarned: record.totalStarsEarned,
        totalGamesPlayed: record.totalGamesPlayed
      };
    })
    .sort((a, b) => b.balance - a.balance || b.totalStarsEarned - a.totalStarsEarned)
    .slice(0, 10);
}

function createStateResponse(record, demoMode, store) {
  resetMissionsIfNeeded(record);
  return {
    user: record.user,
    balance: record.balance,
    level: record.level,
    xp: record.xp,
    streak: record.streak,
    referrals: record.referrals,
    inventory: record.inventory,
    achievements: record.achievements,
    missions: record.missions,
    totalGamesPlayed: record.totalGamesPlayed,
    totalStarsEarned: record.totalStarsEarned,
    lastDailyAt: record.lastDailyAt,
    lastDailyClaimAt: record.lastDailyClaimAt,
    lastWheelAt: record.lastWheelAt,
    lastWheelOutcome: record.lastWheelOutcome,
    lastFortuneOutcome: record.lastFortuneOutcome,
    nextDailyAt: record.lastDailyClaimAt ? record.lastDailyClaimAt + DAILY_INTERVAL_MS : 0,
    nextWheelAt: record.lastWheelAt ? record.lastWheelAt + WHEEL_INTERVAL_MS : 0,
    leaderboard: leaderboard(store),
    demoMode
  };
}

async function sendStartMessage(chatId) {
  if (!BOT_TOKEN) {
    return { ok: false, description: "BOT_TOKEN is missing" };
  }

  const payload = {
    chat_id: chatId,
    text: [
      "Welcome to Lucky Bear Lounge.",
      "",
      "Open the Mini App to claim daily rewards, play casual mini-games, complete missions, and grow your collection."
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [[{ text: "Open Mini App", web_app: { url: APP_URL || "http://localhost:3000" } }]]
    }
  };

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}

async function handleApi(req, res) {
  const body = await collectBody(req);
  const telegramUser = validateInitData(body.initData || "");
  const demoMode = !telegramUser;
  const user = telegramUser || deriveDemoUser(body.fallbackUser);
  const store = readStore();
  const record = getPlayerRecord(store, user);
  const now = Date.now();

  if (req.url === "/api/state") {
    writeStore(store);
    sendJson(res, 200, createStateResponse(record, demoMode, store));
    return;
  }

  if (req.url === "/api/daily") {
    if (record.lastDailyClaimAt && record.lastDailyClaimAt + DAILY_INTERVAL_MS > now) {
      sendJson(res, 429, { error: "Daily reward is on cooldown", ...createStateResponse(record, demoMode, store) });
      return;
    }

    const previous = record.lastDailyClaimAt ? new Date(record.lastDailyClaimAt).toISOString().slice(0, 10) : null;
    const yesterday = new Date(now - DAILY_INTERVAL_MS).toISOString().slice(0, 10);
    record.streak = previous === yesterday ? record.streak + 1 : 1;

    const base = 10 + Math.floor(Math.random() * 41);
    const bonus = Math.min(25, Math.max(0, record.streak - 1) * 5);
    record.lastDailyClaimAt = now;
    record.lastDailyAt = now;
    awardStars(record, base + bonus, "daily_claim", { base, bonus, streak: record.streak });
    writeStore(store);
    sendJson(res, 200, { reward: base, streakBonus: bonus, ...createStateResponse(record, demoMode, store) });
    return;
  }

  if (req.url === "/api/games/wheel") {
    if (record.lastWheelAt && record.lastWheelAt + WHEEL_INTERVAL_MS > now) {
      sendJson(res, 429, { error: "Daily wheel is on cooldown", ...createStateResponse(record, demoMode, store) });
      return;
    }

    const result = rollDailyWheel();
    record.lastWheelAt = now;
    record.lastWheelOutcome = result.type;
    record.totalGamesPlayed += 1;
    record.missions.playGames.progress += 1;
    record.xp += result.xp;
    record.level = calculateLevel(record.xp);

    if (result.stars > 0) {
      awardStars(record, result.stars, "wheel_reward", { result: result.type, title: result.title });
    } else {
      logTransaction(record, "wheel_reward", 0, { result: result.type, title: result.title });
    }

    if (result.type === "bear") {
      record.wins.bears += 1;
      addInventoryItem(record, { type: "bear", label: "Bear Gift", image: pickRandomBearAsset() });
    }
    if (result.type === "stars") {
      record.wins.starsCards += 1;
      addInventoryItem(record, { type: "stars", label: result.title, amount: result.stars });
    }

    writeStore(store);
    sendJson(res, 200, { result, ...createStateResponse(record, demoMode, store) });
    return;
  }

  if (req.url === "/api/games/fortune") {
    if (!spendStars(record, FORTUNE_BOX_COST, "fortune_cost", { cost: FORTUNE_BOX_COST })) {
      sendJson(res, 400, { error: "Not enough Stars to open a Fortune Box", ...createStateResponse(record, demoMode, store) });
      return;
    }

    const result = rollFortuneBox();
    record.lastFortuneOutcome = result.type;
    record.totalGamesPlayed += 1;
    record.missions.playGames.progress += 1;
    record.xp += result.xp;
    record.level = calculateLevel(record.xp);

    if (result.stars > 0) {
      awardStars(record, result.stars, "fortune_reward", { result: result.type, title: result.title });
    } else {
      logTransaction(record, "fortune_reward", 0, { result: result.type, title: result.title });
    }

    if (result.type === "bear") {
      record.wins.bears += 1;
      addInventoryItem(record, { type: "bear", label: "Bear Gift", image: pickRandomBearAsset() });
    }
    if (result.type === "stars") {
      record.wins.starsCards += 1;
      addInventoryItem(record, { type: "stars", label: result.title, amount: result.stars });
    }

    writeStore(store);
    sendJson(res, 200, { cost: FORTUNE_BOX_COST, result, ...createStateResponse(record, demoMode, store) });
    return;
  }

  if (req.url === "/api/missions/claim") {
    if (!claimMissionReward(record)) {
      sendJson(res, 400, { error: "Daily missions are not complete yet", ...createStateResponse(record, demoMode, store) });
      return;
    }

    writeStore(store);
    sendJson(res, 200, { reward: 35, ...createStateResponse(record, demoMode, store) });
    return;
  }

  if (req.url === "/api/leaderboard") {
    writeStore(store);
    sendJson(res, 200, { leaderboard: leaderboard(store) });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handleWebhook(req, res) {
  const update = await collectBody(req);
  const message = update.message;
  if (message?.text?.startsWith("/start")) {
    const result = await sendStartMessage(message.chat.id);
    sendJson(res, 200, result);
    return;
  }
  sendJson(res, 200, { ok: true });
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: "Invalid request" });
      return;
    }

    if (
      req.method === "POST" &&
      [
        "/api/state",
        "/api/daily",
        "/api/games/wheel",
        "/api/games/fortune",
        "/api/missions/claim",
        "/api/leaderboard"
      ].includes(new URL(req.url, "http://localhost").pathname)
    ) {
      await handleApi(req, res);
      return;
    }

    if (req.method === "POST" && new URL(req.url, "http://localhost").pathname === "/webhook") {
      await handleWebhook(req, res);
      return;
    }

    if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

if (!globalThis.__luckyBearServerStarted) {
  globalThis.__luckyBearServerStarted = true;
  server.listen(PORT, () => {
    console.log(`Lucky Bear Lounge is running on http://localhost:${PORT}`);
  });
}
