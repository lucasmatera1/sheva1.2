"""Módulo de login no Bet365 via cookies persistentes.

O Bet365 bloqueia login automatizado (preenchimento por script é
detectado como "senha incorreta"). A estratégia é:

1. Verificar se já está logado (cookies de sessão anteriores)
2. Se não, avisar que precisa rodar `python scripts/manual_login.py`

O login manual abre o Camoufox, o usuário loga com mouse/teclado
reais, e os cookies são salvos para reutilização automática.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from src.browser.session import save_cookies
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Page

logger = get_logger(__name__)

async def is_logged_in(page: Page) -> bool:
    """Verifica se o usuário está logado no Bet365.

    Detecta via botões do header:
    - Logado: "Minhas Apostas" presente + saldo (R$) visível, sem "Login"
    - Não logado: botão "Login" presente
    """
    try:
        return await page.evaluate("""() => {
            const btns = [...document.querySelectorAll('button')];
            const texts = btns.map(b => b.textContent.trim());

            // Se existe botão "Login" → não logado
            if (texts.some(t => t === 'Login')) return false;

            // Se existe "Minhas Apostas" → logado
            if (texts.some(t => t === 'Minhas Apostas')) return true;

            // Se existe botão com R$ (saldo) → logado
            if (texts.some(t => /^R\\$/.test(t))) return true;

            // Nenhum indicador → página ainda carregando
            return false;
        }""")
    except Exception:
        return False


async def ensure_logged_in(
    page: Page,
    context: BrowserContext | None = None,
) -> bool:
    """Verifica se está logado. Se não, avisa para fazer login manual.

    Returns:
        True se está logado, False se precisa de login manual.
    """
    if await is_logged_in(page):
        logger.info("Sessão ativa — usuário logado no Bet365")
        if context:
            await save_cookies(context)
        return True

    logger.warning(
        "Não está logado no Bet365. "
        "Execute: python scripts/manual_login.py"
    )
    return False
