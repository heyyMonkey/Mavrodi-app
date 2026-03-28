from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from .payments import SHOP_PACKS


def main_menu_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="Daily Reward", callback_data="menu:daily")
    builder.button(text="Fortune Box", callback_data="menu:play")
    builder.button(text="Missions", callback_data="menu:missions")
    builder.button(text="Leaderboard", callback_data="menu:leaderboard")
    builder.button(text="Shop", callback_data="menu:shop")
    builder.adjust(2, 2, 1)
    return builder.as_markup()


def shop_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for pack in SHOP_PACKS.values():
        builder.row(InlineKeyboardButton(text=f"{pack.title} • {pack.price_xtr} XTR", callback_data=f"buy:{pack.code}"))
    return builder.as_markup()
