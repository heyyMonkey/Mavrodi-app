from aiogram import Router

from .common import router as common_router
from .payments import router as payments_router


def setup_routers() -> Router:
    root = Router()
    root.include_router(common_router)
    root.include_router(payments_router)
    return root
