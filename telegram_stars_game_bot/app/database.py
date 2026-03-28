from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Iterator

from .game_logic import calculate_level, daily_mission_targets


def utc_now() -> datetime:
    return datetime.now(UTC)


def to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def from_iso(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class UserRecord:
    user_id: int
    username: str | None
    first_name: str | None
    balance: int
    level: int
    experience: int
    streak: int
    last_daily_at: datetime | None
    last_activity_at: datetime | None
    daily_task_play_progress: int
    daily_task_earn_progress: int
    daily_task_claimed_at: datetime | None
    total_games_played: int
    total_stars_earned: int
    created_at: datetime


class Database:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith("sqlite:///"):
            raise RuntimeError("This MVP storage layer supports sqlite:/// URLs only.")
        self.path = Path(database_url.replace("sqlite:///", "", 1)).resolve()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init(self, schema_path: Path) -> None:
        with self.connection() as conn:
            conn.executescript(schema_path.read_text(encoding="utf-8"))

    def _row_to_user(self, row: sqlite3.Row) -> UserRecord:
        return UserRecord(
            user_id=row["user_id"],
            username=row["username"],
            first_name=row["first_name"],
            balance=row["balance"],
            level=row["level"],
            experience=row["experience"],
            streak=row["streak"],
            last_daily_at=from_iso(row["last_daily_at"]),
            last_activity_at=from_iso(row["last_activity_at"]),
            daily_task_play_progress=row["daily_task_play_progress"],
            daily_task_earn_progress=row["daily_task_earn_progress"],
            daily_task_claimed_at=from_iso(row["daily_task_claimed_at"]),
            total_games_played=row["total_games_played"],
            total_stars_earned=row["total_stars_earned"],
            created_at=from_iso(row["created_at"]) or utc_now(),
        )

    def get_or_create_user(self, user_id: int, username: str | None, first_name: str | None) -> UserRecord:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            if row is None:
                now = utc_now()
                conn.execute(
                    """
                    INSERT INTO users (
                        user_id, username, first_name, balance, level, experience, streak,
                        last_daily_at, last_activity_at, daily_task_play_progress,
                        daily_task_earn_progress, daily_task_claimed_at, total_games_played,
                        total_stars_earned, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, username, first_name, 100, 1, 0, 0, None, to_iso(now), 0, 0, None, 0, 0, to_iso(now)),
                )
                row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            else:
                conn.execute(
                    "UPDATE users SET username = ?, first_name = ?, last_activity_at = ? WHERE user_id = ?",
                    (username, first_name, to_iso(utc_now()), user_id),
                )
                row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return self._row_to_user(row)

    def get_user(self, user_id: int) -> UserRecord | None:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return self._row_to_user(row) if row else None

    def add_transaction(self, user_id: int, tx_type: str, amount: int, meta: dict | None = None) -> None:
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO transactions (user_id, type, amount, meta_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, tx_type, amount, json.dumps(meta or {}), to_iso(utc_now())),
            )

    def add_inventory_item(self, user_id: int, item_type: str, item_name: str, rarity: str) -> None:
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO inventory_items (user_id, item_type, item_name, rarity, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, item_type, item_name, rarity, to_iso(utc_now())),
            )

    def list_inventory_items(self, user_id: int) -> list[sqlite3.Row]:
        with self.connection() as conn:
            return conn.execute(
                """
                SELECT item_type, item_name, rarity, created_at
                FROM inventory_items
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT 20
                """,
                (user_id,),
            ).fetchall()

    def can_claim_daily(self, user: UserRecord) -> tuple[bool, timedelta]:
        if user.last_daily_at is None:
            return True, timedelta(0)
        next_daily = user.last_daily_at + timedelta(hours=24)
        remaining = next_daily - utc_now()
        return remaining.total_seconds() <= 0, max(remaining, timedelta(0))

    def apply_daily_reward(self, user_id: int, reward: int, bonus: int, new_streak: int) -> UserRecord:
        total = reward + bonus
        now = utc_now()
        with self.connection() as conn:
            current = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            experience = current["experience"] + 10
            level = calculate_level(experience)
            conn.execute(
                """
                UPDATE users
                SET balance = balance + ?,
                    streak = ?,
                    last_daily_at = ?,
                    last_activity_at = ?,
                    total_stars_earned = total_stars_earned + ?,
                    daily_task_earn_progress = daily_task_earn_progress + ?,
                    experience = ?,
                    level = ?
                WHERE user_id = ?
                """,
                (total, new_streak, to_iso(now), to_iso(now), total, total, experience, level, user_id),
            )
            updated = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        self.add_transaction(user_id, "daily_reward", total, {"reward": reward, "bonus": bonus, "streak": new_streak})
        return self._row_to_user(updated)

    def spend_balance(self, user_id: int, amount: int, tx_type: str, meta: dict | None = None) -> UserRecord | None:
        with self.connection() as conn:
            current = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            if current is None or current["balance"] < amount:
                return None
            conn.execute("UPDATE users SET balance = balance - ?, last_activity_at = ? WHERE user_id = ?", (amount, to_iso(utc_now()), user_id))
            updated = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        self.add_transaction(user_id, tx_type, -amount, meta)
        return self._row_to_user(updated)

    def apply_game_reward(self, user_id: int, stars_delta: int, xp_delta: int, reward_name: str, inventory_item_type: str | None, inventory_item_name: str | None, rarity: str) -> UserRecord:
        now = utc_now()
        with self.connection() as conn:
            current = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            experience = current["experience"] + xp_delta
            level = calculate_level(experience)
            conn.execute(
                """
                UPDATE users
                SET balance = balance + ?,
                    experience = ?,
                    level = ?,
                    total_games_played = total_games_played + 1,
                    total_stars_earned = total_stars_earned + ?,
                    daily_task_play_progress = daily_task_play_progress + 1,
                    daily_task_earn_progress = daily_task_earn_progress + ?,
                    last_activity_at = ?
                WHERE user_id = ?
                """,
                (stars_delta, experience, level, max(stars_delta, 0), max(stars_delta, 0), to_iso(now), user_id),
            )
            updated = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        self.add_transaction(user_id, "fortune_box_reward", stars_delta, {"reward_name": reward_name, "xp_delta": xp_delta, "rarity": rarity})
        if inventory_item_type and inventory_item_name:
            self.add_inventory_item(user_id, inventory_item_type, inventory_item_name, rarity)
        return self._row_to_user(updated)

    def credit_purchase(self, user_id: int, amount: int, payload: str, charge_id: str) -> UserRecord:
        now = utc_now()
        with self.connection() as conn:
            current = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            experience = current["experience"] + 15
            level = calculate_level(experience)
            conn.execute(
                """
                UPDATE users
                SET balance = balance + ?,
                    experience = ?,
                    level = ?,
                    total_stars_earned = total_stars_earned + ?,
                    daily_task_earn_progress = daily_task_earn_progress + ?,
                    last_activity_at = ?
                WHERE user_id = ?
                """,
                (amount, experience, level, amount, amount, to_iso(now), user_id),
            )
            updated = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        self.add_transaction(user_id, "stars_purchase", amount, {"payload": payload, "telegram_payment_charge_id": charge_id})
        return self._row_to_user(updated)

    def claim_daily_missions(self, user_id: int) -> tuple[bool, UserRecord]:
        with self.connection() as conn:
            current = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            user = self._row_to_user(current)
            targets = daily_mission_targets(user.level)
            today = date.today().isoformat()
            if user.daily_task_claimed_at and user.daily_task_claimed_at.date().isoformat() == today:
                return False, user
            if user.daily_task_play_progress < targets["play_times"] or user.daily_task_earn_progress < targets["earn_stars"]:
                return False, user
            experience = user.experience + 20
            level = calculate_level(experience)
            conn.execute(
                """
                UPDATE users
                SET balance = balance + 35,
                    daily_task_claimed_at = ?,
                    experience = ?,
                    level = ?,
                    last_activity_at = ?
                WHERE user_id = ?
                """,
                (to_iso(utc_now()), experience, level, to_iso(utc_now()), user_id),
            )
            updated = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        self.add_transaction(user_id, "daily_missions_claim", 35, {"reward": 35})
        return True, self._row_to_user(updated)

    def maybe_reset_daily_task_progress(self, user_id: int) -> None:
        with self.connection() as conn:
            current = conn.execute("SELECT daily_task_claimed_at FROM users WHERE user_id = ?", (user_id,)).fetchone()
            claimed_at = from_iso(current["daily_task_claimed_at"]) if current else None
            today = date.today().isoformat()
            if claimed_at and claimed_at.date().isoformat() == today:
                return
            conn.execute(
                """
                UPDATE users
                SET daily_task_play_progress = 0,
                    daily_task_earn_progress = 0,
                    daily_task_claimed_at = NULL
                WHERE user_id = ?
                """,
                (user_id,),
            )

    def leaderboard(self, limit: int = 10) -> list[sqlite3.Row]:
        with self.connection() as conn:
            return conn.execute(
                """
                SELECT user_id, first_name, username, balance, level, total_stars_earned
                FROM users
                ORDER BY balance DESC, total_stars_earned DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
