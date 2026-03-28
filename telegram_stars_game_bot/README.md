# Telegram Stars Mini-Game Bot

Casual Telegram bot built with `aiogram` and SQLite.

Features:
- `/start`
- `/daily`
- `/play`
- `/missions`
- `/leaderboard`
- `/shop`

This project uses Telegram Stars payments with `currency="XTR"` for content packs and keeps the game framed as a casual progression system.

Official references:
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Stars](https://core.telegram.org/api/stars)

## Quick start

1. Copy `.env.example` to `.env`
2. Fill `BOT_TOKEN` and `BOT_USERNAME`
3. Install dependencies:

```powershell
pip install -r requirements.txt
```

4. Run:

```powershell
python -m app.main
```
