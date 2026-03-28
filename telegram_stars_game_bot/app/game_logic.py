from __future__ import annotations

import random

from .models import RewardResult

PLAY_COST = 10
DAILY_REWARD_MIN = 10
DAILY_REWARD_MAX = 50
STREAK_BONUS_STEP = 5


def calculate_level(experience: int) -> int:
    return max(1, 1 + experience // 100)


def roll_daily_reward(streak: int) -> tuple[int, int]:
    base = random.randint(DAILY_REWARD_MIN, DAILY_REWARD_MAX)
    bonus = min(25, max(0, streak - 1) * STREAK_BONUS_STEP)
    return base, bonus


def roll_fortune_box() -> RewardResult:
    roll = random.random()

    if roll < 0.45:
        return RewardResult(
            name="Comet Dust",
            xp_delta=18,
            message="You found Comet Dust. It boosts your progression.",
        )

    if roll < 0.75:
        return RewardResult(
            name="Lucky Shards",
            stars_delta=6,
            xp_delta=8,
            message="Lucky Shards turned into a small Stars bonus.",
        )

    if roll < 0.94:
        return RewardResult(
            name="Prism Ticket",
            stars_delta=14,
            xp_delta=14,
            inventory_item_name="Prism Ticket",
            inventory_item_type="ticket",
            rarity="rare",
            message="You pulled a Prism Ticket and extra Stars.",
        )

    return RewardResult(
        name="Aurora Badge",
        stars_delta=25,
        xp_delta=30,
        inventory_item_name="Aurora Badge",
        inventory_item_type="badge",
        rarity="epic",
        message="Epic pull: Aurora Badge unlocked.",
    )


def daily_mission_targets(level: int) -> dict[str, int]:
    return {
        "play_times": 3 if level < 10 else 5,
        "earn_stars": 25 if level < 10 else 40,
    }
