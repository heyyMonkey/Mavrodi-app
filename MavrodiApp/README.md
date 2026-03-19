# Lucky Bear Spin Demo

This repository contains a dependency-free Telegram Mini App demo:

- 1 free spin per player every 24 hours
- `99%` chance to win nothing
- `0.99%` chance to win `3 Stars`
- `0.01%` chance to win the `Bear` gift

It uses:

- a plain Node.js HTTP server
- static frontend files in `public/`
- JSON file persistence in `data/players.json`
- Telegram WebApp init data verification when `BOT_TOKEN` is configured

## Quick start

1. Copy `.env.example` to `.env`
2. Set:
   - `BOT_TOKEN` from BotFather
   - `APP_URL` to your public HTTPS URL
   - `SESSION_SECRET` to any random long string
3. Start the app:

```powershell
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).

If PowerShell blocks `npm`, you can still run everything with plain `node`.

## Telegram setup

1. Create a bot with BotFather.
2. Set the bot menu button or inline button to your Mini App URL.
3. Host this app on HTTPS because Telegram Mini Apps require HTTPS in production.
4. Point Telegram webhook to:

```text
https://your-domain.example/webhook
```

5. When a user sends `/start`, the bot replies with an `Open Mini App` button.
6. Optional helper: run the setup script to register the webhook and the bot menu button in one go:

```powershell
node scripts/setup-telegram.js
```

## Demo notes

- Outside Telegram, the app falls back to a demo user so you can test locally in the browser.
- `3 Stars` and `Bear` wins are recorded in local JSON storage.
- The `Bear` result is only represented as demo state right now. Real Telegram gift delivery would need a production reward-fulfillment flow on top of this.

## Important production follow-up

If you want to turn this into a real Stars casino-like product, we should add:

- a real database instead of JSON
- signed sessions and stricter anti-abuse controls
- admin logging and reward fulfillment
- real Telegram Stars purchase/payment flows
- legal/compliance checks for your target region
