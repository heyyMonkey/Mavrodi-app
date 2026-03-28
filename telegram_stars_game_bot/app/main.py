from __future__ import annotations

import asyncio
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from app.config import get_settings
from app.database import Database
from app.handlers import setup_routers
from app.handlers.common import bind_database as bind_common_database
from app.handlers.payments import bind_database as bind_payments_database


async def main() -> None:
    settings = get_settings()
    database = Database(settings.database_url)
    database.init(Path(__file__).resolve().parents[1] / "schema.sql")

    bind_common_database(database)
    bind_payments_database(database)

    bot = Bot(token=settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = Dispatcher()
    dispatcher.include_router(setup_routers())

    await bot.delete_webhook(drop_pending_updates=True)
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
