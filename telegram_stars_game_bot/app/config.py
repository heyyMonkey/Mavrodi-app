from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    bot_token: str
    database_url: str
    bot_username: str


def get_settings() -> Settings:
    load_env_file()

    bot_token = os.getenv("BOT_TOKEN", "").strip()
    database_url = os.getenv("DATABASE_URL", "sqlite:///bot.sqlite3").strip()
    bot_username = os.getenv("BOT_USERNAME", "").strip().lstrip("@")

    if not bot_token:
        raise RuntimeError("BOT_TOKEN is required")

    if not bot_username:
        raise RuntimeError("BOT_USERNAME is required")

    return Settings(bot_token=bot_token, database_url=database_url, bot_username=bot_username)
