from __future__ import annotations

from aiogram.types import LabeledPrice

from .models import ShopPack

SHOP_PACKS = {
    "small_pack": ShopPack(
        code="small_pack",
        title="Small Spark Pack",
        description="Adds 120 in-game Stars for more daily play.",
        price_xtr=50,
        stars_granted=120,
        bonus_text="Starter friendly",
    ),
    "medium_pack": ShopPack(
        code="medium_pack",
        title="Medium Spark Pack",
        description="Adds 550 in-game Stars with a better value bonus.",
        price_xtr=200,
        stars_granted=550,
        bonus_text="+50 bonus Stars",
    ),
    "large_pack": ShopPack(
        code="large_pack",
        title="Large Spark Pack",
        description="Adds 1500 in-game Stars and a big progression boost.",
        price_xtr=500,
        stars_granted=1500,
        bonus_text="+250 bonus Stars",
    ),
}


def build_invoice_prices(pack: ShopPack) -> list[LabeledPrice]:
    return [LabeledPrice(label=pack.title, amount=pack.price_xtr)]
