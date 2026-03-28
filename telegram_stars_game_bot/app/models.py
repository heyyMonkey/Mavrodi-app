from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RewardResult:
    name: str
    stars_delta: int = 0
    xp_delta: int = 0
    inventory_item_name: str | None = None
    inventory_item_type: str | None = None
    rarity: str = "common"
    message: str = ""


@dataclass(frozen=True)
class ShopPack:
    code: str
    title: str
    description: str
    price_xtr: int
    stars_granted: int
    bonus_text: str
