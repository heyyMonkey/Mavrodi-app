import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the important folders used by the app.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const dataFile = join(dataDir, "players.json");

// Main game configuration.
const SPIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTER_TICKETS = 10000000;
const CASE_PRICE = 1000;

// Minimal content types for the static files we serve.
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
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

// Load environment variables from .env without installing extra packages.
function loadEnvFile() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const APP_URL = process.env.APP_URL || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "demo-secret";

// Read and write the small JSON datastore.
function readStore() {
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

function writeStore(store) {
  writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

// Helper for sending JSON responses.
function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

// Serve frontend files from /public.
function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = normalize(join(publicDir, requestPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = extname(filePath);
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const body = readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}

// Read JSON request bodies for POST endpoints.
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

// Telegram Mini App init data is signed.
// These helpers rebuild and verify the signature before trusting the user object.
function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const sorted = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const userValue = params.get("user");
  const user = userValue ? JSON.parse(userValue) : null;
  return { hash, sorted, user };
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

// For local browser testing, create a stable demo user from SESSION_SECRET.
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

// Ensure a player record exists and has all required fields.
function getPlayerRecord(store, user) {
  if (!store.players[user.id]) {
    store.players[user.id] = {
      user,
      tickets: STARTER_TICKETS,
      wins: {
        stars: 0,
        bear: 0
      },
      inventory: [],
      lastOutcome: null,
      lastCaseOutcome: null,
      lastSpinAt: 0,
      nextSpinAt: 0,
      casesOpened: 0
    };
  }

  store.players[user.id].user = user;
  if (typeof store.players[user.id].tickets !== "number") {
    store.players[user.id].tickets = STARTER_TICKETS;
  }
  if (!Array.isArray(store.players[user.id].inventory)) {
    store.players[user.id].inventory = [];
  }
  if (typeof store.players[user.id].casesOpened !== "number") {
    store.players[user.id].casesOpened = 0;
  }
  if (!Object.prototype.hasOwnProperty.call(store.players[user.id], "lastCaseOutcome")) {
    store.players[user.id].lastCaseOutcome = null;
  }
  return store.players[user.id];
}

// Random result for the daily free spin.
function rollOutcome() {
  const roll = Math.random() * 100;
  if (roll < 0.01) {
    return "bear";
  }

  if (roll < 1.0) {
    return "stars";
  }

  return "nothing";
}

// Random result for the 1000-ticket case.
function rollCaseOutcome() {
  const roll = Math.random() * 100;
  if (roll < 5) {
    return "bear";
  }

  if (roll < 25) {
    return "tickets_500";
  }

  if (roll < 40) {
    return "stars";
  }

  return "nothing";
}

// Add a reward item to the front of the player's inventory list.
function addInventoryItem(record, item) {
  record.inventory.unshift({
    id: randomUUID(),
    createdAt: Date.now(),
    ...item
  });
}

// Build the JSON state returned to the frontend.
function createStateResponse(record, demoMode) {
  return {
    user: record.user,
    tickets: record.tickets,
    wins: record.wins,
    inventory: record.inventory,
    lastOutcome: record.lastOutcome,
    lastCaseOutcome: record.lastCaseOutcome,
    lastSpinAt: record.lastSpinAt,
    nextSpinAt: record.nextSpinAt,
    casesOpened: record.casesOpened,
    casePrice: CASE_PRICE,
    demoMode
  };
}

// Optional Telegram DM after the daily spin.
async function notifyTelegram(userId, outcome) {
  if (!BOT_TOKEN || !userId || String(userId).startsWith("demo-")) {
    return;
  }

  const text =
    outcome === "bear"
      ? "You hit the Bear gift jackpot in the demo."
      : outcome === "stars"
        ? "You won 3 Stars in the demo."
        : "Your free spin landed on nothing this time.";

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: userId,
      text
    })
  }).catch(() => {});
}

// What the bot sends back when the user types /start.
async function sendStartMessage(chatId) {
  if (!BOT_TOKEN) {
    return { ok: false, description: "BOT_TOKEN is missing" };
  }

  const text = [
    "Welcome to Lucky Bear Lounge.",
    "",
    "You get 1 free spin every 24 hours.",
    `You start with ${STARTER_TICKETS} tickets.`,
    `Golden Bear Case costs ${CASE_PRICE} tickets.`,
    "Open the Mini App to spin, open cases, and manage your inventory."
  ].join("\n");

  const payload = {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Mini App",
            web_app: {
              url: APP_URL || "http://localhost:3000"
            }
          }
        ]
      ]
    }
  };

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return response.json();
}

// Main API handler for state loading, daily spin, and case opening.
async function handleApi(req, res) {
  const body = await collectBody(req);
  const telegramUser = validateInitData(body.initData || "");
  const demoMode = !telegramUser;
  const user = telegramUser || deriveDemoUser(body.fallbackUser);

  const store = readStore();
  const record = getPlayerRecord(store, user);

  if (req.url === "/api/state") {
    writeStore(store);
    sendJson(res, 200, createStateResponse(record, demoMode));
    return;
  }

  // Daily free spin endpoint.
  if (req.url === "/api/spin") {
    const now = Date.now();
    if (record.nextSpinAt > now) {
      sendJson(res, 429, {
        error: "Free spin is on cooldown",
        ...createStateResponse(record, demoMode)
      });
      return;
    }

    const outcome = rollOutcome();
    record.lastOutcome = outcome;
    record.lastSpinAt = now;
    record.nextSpinAt = now + SPIN_INTERVAL_MS;

    if (outcome === "stars") {
      record.wins.stars += 3;
      addInventoryItem(record, {
        type: "stars",
        label: "STARS 3X",
        amount: 3
      });
    }

    if (outcome === "bear") {
      record.wins.bear += 1;
      addInventoryItem(record, {
        type: "bear",
        label: "Bear Gift",
        video: "/assets/bear.mp4"
      });
    }

    writeStore(store);
    await notifyTelegram(user.id, outcome);
    sendJson(res, 200, {
      outcome,
      ...createStateResponse(record, demoMode)
    });
    return;
  }

  // Ticket case endpoint.
  if (req.url === "/api/case/open") {
    if (record.tickets < CASE_PRICE) {
      sendJson(res, 400, {
        error: "Not enough tickets to open this case",
        ...createStateResponse(record, demoMode)
      });
      return;
    }

    const outcome = rollCaseOutcome();
    record.tickets -= CASE_PRICE;
    record.lastCaseOutcome = outcome;
    record.casesOpened += 1;

    if (outcome === "tickets_500") {
      record.tickets += 500;
      addInventoryItem(record, {
        type: "tickets",
        label: "TICKETS +500",
        amount: 500
      });
    }

    if (outcome === "stars") {
      record.wins.stars += 3;
      addInventoryItem(record, {
        type: "stars",
        label: "STARS 3X",
        amount: 3
      });
    }

    if (outcome === "bear") {
      record.wins.bear += 1;
      addInventoryItem(record, {
        type: "bear",
        label: "Bear Gift",
        video: "/assets/bear.mp4"
      });
    }

    writeStore(store);
    sendJson(res, 200, {
      outcome,
      ...createStateResponse(record, demoMode)
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

// Telegram webhook endpoint for bot messages.
async function handleWebhook(req, res) {
  const update = await collectBody(req);
  const message = update.message;
  const text = message?.text || "";

  if (text.startsWith("/start")) {
    const result = await sendStartMessage(message.chat.id);
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 200, { ok: true });
}

// Start the HTTP server and route incoming requests.
const server = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: "Invalid request" });
      return;
    }

    if (
      req.method === "POST" &&
      (req.url === "/api/state" || req.url === "/api/spin" || req.url === "/api/case/open")
    ) {
      await handleApi(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/webhook") {
      await handleWebhook(req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
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

server.listen(PORT, () => {
  console.log(`Lucky Bear Spin is running on http://localhost:${PORT}`);
});
