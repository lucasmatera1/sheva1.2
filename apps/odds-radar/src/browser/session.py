"""Utilitário de cookies e sessão para persistência entre execuções."""

from __future__ import annotations

import json
from pathlib import Path

from playwright.async_api import BrowserContext

from src.utils.logger import get_logger

logger = get_logger(__name__)

COOKIES_FILE = Path(__file__).resolve().parent.parent.parent / ".browser_data" / "cookies.json"


async def save_cookies(context: BrowserContext) -> None:
    """Salva cookies do contexto atual em arquivo."""
    COOKIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    cookies = await context.cookies()
    COOKIES_FILE.write_text(json.dumps(cookies, indent=2), encoding="utf-8")
    logger.debug("Saved {} cookies", len(cookies))


async def load_cookies(context: BrowserContext) -> bool:
    """Carrega cookies salvos no contexto. Retorna True se carregou."""
    if not COOKIES_FILE.exists():
        return False
    try:
        cookies = json.loads(COOKIES_FILE.read_text(encoding="utf-8"))
        await context.add_cookies(cookies)
        logger.info("Loaded {} cookies from file", len(cookies))
        return True
    except Exception as e:
        logger.warning("Failed to load cookies: {}", e)
        return False
