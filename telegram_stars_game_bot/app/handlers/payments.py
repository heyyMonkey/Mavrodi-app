from __future__ import annotations

from aiogram import F, Router
from aiogram.methods import SendInvoice
from aiogram.types import CallbackQuery, Message, PreCheckoutQuery

from app.database import Database
from app.keyboards import main_menu_keyboard
from app.payments import SHOP_PACKS, build_invoice_prices

router = Router()
db: Database | None = None


def bind_database(database: Database) -> None:
    global db
    db = database


def get_db() -> Database:
    if db is None:
        raise RuntimeError("Database is not bound")
    return db


@router.callback_query(F.data.startswith("buy:"))
async def buy_pack(callback: CallbackQuery) -> None:
    pack_code = callback.data.split(":", 1)[1]
    pack = SHOP_PACKS.get(pack_code)
    if not pack:
        await callback.answer("Unknown pack", show_alert=True)
        return

    await callback.bot(
        SendInvoice(
            chat_id=callback.from_user.id,
            title=pack.title,
            description=f"{pack.description} {pack.bonus_text}",
            payload=f"pack:{pack.code}",
            provider_token="",
            currency="XTR",
            prices=build_invoice_prices(pack),
            start_parameter=f"buy-{pack.code}",
        )
    )
    await callback.answer()


@router.pre_checkout_query()
async def pre_checkout(pre_checkout_query: PreCheckoutQuery) -> None:
    payload = pre_checkout_query.invoice_payload.replace("pack:", "")
    if payload not in SHOP_PACKS:
        await pre_checkout_query.answer(ok=False, error_message="This pack is no longer available.")
        return
    await pre_checkout_query.answer(ok=True)


@router.message(F.successful_payment)
async def successful_payment(message: Message) -> None:
    database = get_db()
    payment = message.successful_payment
    payload = payment.invoice_payload.replace("pack:", "")
    pack = SHOP_PACKS.get(payload)
    if not pack:
        await message.answer("Payment received, but the pack payload was unknown. Please contact support.")
        return

    updated = database.credit_purchase(
        user_id=message.from_user.id,
        amount=pack.stars_granted,
        payload=payment.invoice_payload,
        charge_id=payment.telegram_payment_charge_id,
    )
    await message.answer(
        f"Purchase successful.\n"
        f"Unlocked: {pack.title}\n"
        f"Added: {pack.stars_granted} in-game Stars\n"
        f"New balance: {updated.balance}",
        reply_markup=main_menu_keyboard(),
    )
