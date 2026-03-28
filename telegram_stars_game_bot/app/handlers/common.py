from __future__ import annotations

from datetime import UTC, datetime, timedelta

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from app.database import Database
from app.game_logic import PLAY_COST, daily_mission_targets, roll_daily_reward, roll_fortune_box
from app.keyboards import main_menu_keyboard, shop_keyboard

router = Router()
db: Database | None = None


def bind_database(database: Database) -> None:
    global db
    db = database


def get_db() -> Database:
    if db is None:
        raise RuntimeError("Database is not bound")
    return db


def _remaining_text(delta: timedelta) -> str:
    total = int(delta.total_seconds())
    hours = total // 3600
    minutes = (total % 3600) // 60
    return f"{hours}h {minutes}m"


@router.message(Command("start"))
async def start_command(message: Message) -> None:
    database = get_db()
    user = database.get_or_create_user(
        user_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    text = (
        f"Welcome, {user.first_name or 'player'}.\n\n"
        f"You have {user.balance} Stars and level {user.level}.\n"
        "Use the menu below to claim your daily reward, open the Fortune Box, or visit the shop."
    )
    await message.answer(text, reply_markup=main_menu_keyboard())


@router.message(Command("profile"))
async def profile_command(message: Message) -> None:
    database = get_db()
    user = database.get_or_create_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    inventory = database.list_inventory_items(user.user_id)
    text = (
        f"Profile for {user.first_name or 'player'}\n"
        f"Stars: {user.balance}\n"
        f"Level: {user.level}\n"
        f"XP: {user.experience}\n"
        f"Streak: {user.streak}\n"
        f"Total plays: {user.total_games_played}\n"
        f"Inventory items: {len(inventory)}"
    )
    await message.answer(text, reply_markup=main_menu_keyboard())


@router.message(Command("daily"))
async def daily_command(message: Message) -> None:
    database = get_db()
    user = database.get_or_create_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    can_claim, remaining = database.can_claim_daily(user)
    if not can_claim:
        await message.answer(f"Daily reward is on cooldown. Come back in {_remaining_text(remaining)}.")
        return

    now = datetime.now(UTC)
    if user.last_daily_at and user.last_daily_at.date() == (now - timedelta(days=1)).date():
        new_streak = user.streak + 1
    else:
        new_streak = 1

    reward, bonus = roll_daily_reward(new_streak)
    updated = database.apply_daily_reward(user.user_id, reward, bonus, new_streak)
    await message.answer(
        f"Daily reward claimed.\nBase: {reward} Stars\nStreak bonus: {bonus} Stars\n"
        f"New balance: {updated.balance}\nStreak: {updated.streak}"
    )


@router.message(Command("play"))
async def play_command(message: Message) -> None:
    database = get_db()
    database.maybe_reset_daily_task_progress(message.from_user.id)
    user = database.get_or_create_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    if user.balance < PLAY_COST:
        await message.answer(f"You need at least {PLAY_COST} Stars to open a Fortune Box.")
        return

    spent_user = database.spend_balance(user.user_id, PLAY_COST, "fortune_box_cost", {"cost": PLAY_COST})
    if spent_user is None:
        await message.answer("Not enough Stars.")
        return

    await message.answer("Opening Fortune Box...")
    reward = roll_fortune_box()
    updated = database.apply_game_reward(
        user_id=user.user_id,
        stars_delta=reward.stars_delta,
        xp_delta=reward.xp_delta,
        reward_name=reward.name,
        inventory_item_type=reward.inventory_item_type,
        inventory_item_name=reward.inventory_item_name,
        rarity=reward.rarity,
    )
    await message.answer(
        f"{reward.message}\n"
        f"Reward: {reward.name}\n"
        f"Stars change: -{PLAY_COST} + {reward.stars_delta}\n"
        f"XP gained: {reward.xp_delta}\n"
        f"New balance: {updated.balance}\n"
        f"Level: {updated.level}"
    )


@router.message(Command("missions"))
async def missions_command(message: Message) -> None:
    database = get_db()
    database.maybe_reset_daily_task_progress(message.from_user.id)
    user = database.get_or_create_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    targets = daily_mission_targets(user.level)
    completed, updated = database.claim_daily_missions(user.user_id)
    if completed:
        await message.answer(
            f"Daily missions complete. You received 35 Stars.\nNew balance: {updated.balance}\nLevel: {updated.level}"
        )
        return

    await message.answer(
        "Daily missions\n"
        f"- Open Fortune Box: {user.daily_task_play_progress}/{targets['play_times']}\n"
        f"- Earn Stars: {user.daily_task_earn_progress}/{targets['earn_stars']}\n"
        "Complete both goals, then use /missions again to claim 35 Stars."
    )


@router.message(Command("leaderboard"))
async def leaderboard_command(message: Message) -> None:
    rows = get_db().leaderboard()
    lines = ["Top players"]
    for index, row in enumerate(rows, start=1):
        name = row["first_name"] or row["username"] or f"User {row['user_id']}"
        lines.append(f"{index}. {name} — {row['balance']} Stars, L{row['level']}")
    await message.answer("\n".join(lines))


@router.message(Command("shop"))
async def shop_command(message: Message) -> None:
    await message.answer(
        "Choose a pack. Telegram Stars payments use XTR and unlock in-game Stars for progression.",
        reply_markup=shop_keyboard(),
    )


@router.callback_query(F.data.startswith("menu:"))
async def menu_callback(callback: CallbackQuery) -> None:
    action = callback.data.split(":", 1)[1]
    if action == "daily":
        await daily_command(callback.message)
    elif action == "play":
        await play_command(callback.message)
    elif action == "missions":
        await missions_command(callback.message)
    elif action == "leaderboard":
        await leaderboard_command(callback.message)
    elif action == "shop":
        await shop_command(callback.message)
    await callback.answer()
