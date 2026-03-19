import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

function loadEnvFile() {
  const envPath = join(rootDir, ".env");
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

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return response.json();
}

async function main() {
  loadEnvFile();

  const botToken = process.env.BOT_TOKEN;
  const appUrl = process.env.APP_URL;

  if (!botToken || !appUrl) {
    throw new Error("BOT_TOKEN and APP_URL must be set in .env before running setup.");
  }

  const normalizedAppUrl = appUrl.replace(/\/$/, "");
  const webhookUrl = `${normalizedAppUrl}/webhook`;

  const webhook = await telegram("setWebhook", { url: webhookUrl });
  const menuButton = await telegram("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Lucky Bear Spin",
      web_app: {
        url: normalizedAppUrl
      }
    }
  });

  console.log(JSON.stringify({ webhook, menuButton }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
