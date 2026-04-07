"""Módulo de login no Bet365 via cookies persistentes + auto-login.

Estratégia:
1. Verificar se já está logado (cookies de sessão anteriores)
2. Se não, tentar auto_login() com credenciais do .env
3. Se falhar, avisar que precisa rodar `python scripts/manual_login.py`

O login manual abre o Chromium, o usuário loga com mouse/teclado
reais, e os cookies são salvos para reutilização automática.
"""

from __future__ import annotations

import asyncio
import os
import random

from playwright.async_api import BrowserContext, Page

from src.browser.session import save_cookies
from src.utils.logger import get_logger

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


async def auto_login(page: Page, context: BrowserContext) -> bool:
    """Login automático usando credenciais do .env (BET365_USER / BET365_PASS).

    Fluxo idêntico ao padrão Camoufox:
    1. Aceita popup de cookies
    2. Verifica se já está logado
    3. Clica no botão Login (via coordenadas — trusted event)
    4. Preenche credenciais via locator.fill()
    5. Valida via cookie pstk
    """
    bet_user = os.environ.get("BET365_USER", "")
    bet_pass = os.environ.get("BET365_PASS", "")
    if not bet_user or not bet_pass:
        logger.warning("BET365_USER/BET365_PASS não definidos no .env")
        return False

    # 0. Espera a página carregar de verdade (spinner do bet365 desaparecer)
    for _ in range(30):
        ready = await page.evaluate("""() => {
            const btns = [...document.querySelectorAll('button')];
            return btns.length >= 2;  // header com botões = carregou
        }""")
        if ready:
            break
        await asyncio.sleep(1)
    else:
        logger.warning("Página demorou para carregar (sem botões após 30s)")

    # 1. Aceita popup de cookies
    try:
        cookie_btn = await page.query_selector("#onetrust-accept-btn-handler")
        if cookie_btn:
            await cookie_btn.click()
            logger.debug("Popup de cookies fechado")
            await asyncio.sleep(1)
    except Exception:
        pass

    # 2. Verifica se já está logado
    login_visible = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        return btns.some(b => b.textContent.trim() === 'Login');
    }""")
    if not login_visible:
        logger.info("Já logado (botão Login ausente)")
        return True

    # 3. Busca botão Login e clica via mouse (trusted event)
    login_bbox = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        const loginBtn = btns.find(b => b.textContent.trim() === 'Login');
        if (loginBtn) {
            const r = loginBtn.getBoundingClientRect();
            if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return null;
    }""")
    if not login_bbox:
        logger.warning("Botão Login não encontrado no DOM")
        return False

    lx = login_bbox["x"] + random.uniform(5, max(6, login_bbox["w"] - 5))
    ly = login_bbox["y"] + random.uniform(3, max(4, login_bbox["h"] - 3))
    try:
        await asyncio.wait_for(page.mouse.click(lx, ly), timeout=5)
    except asyncio.TimeoutError:
        await page.evaluate(
            f"() => {{ const el = document.elementFromPoint({lx}, {ly}); if (el) el.click(); }}"
        )
    logger.debug("Botão Login clicado")

    # 4. Aguarda modal de login
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:
        pass
    await asyncio.sleep(2)

    try:
        await page.wait_for_selector(
            'input[type="text"], input[name="username"]',
            timeout=15_000,
            state="visible",
        )
    except Exception:
        pass

    # 5. Preenche credenciais via locator.fill()
    user_input = page.locator('input[type="text"]').first
    pass_input = page.locator('input[type="password"]').first
    await user_input.fill(bet_user)
    await asyncio.sleep(0.3)
    await pass_input.fill(bet_pass)
    await asyncio.sleep(0.3)
    await page.keyboard.press("Enter")
    logger.info("Credenciais enviadas — aguardando validação...")
    await asyncio.sleep(5)

    # 6. Valida login via cookie pstk
    for _ in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            logger.info("Login OK — cookie pstk presente")
            return True
        await asyncio.sleep(3)

    logger.warning("pstk não apareceu após login — pode ter falhado")
    return False


async def ensure_logged_in(
    page: Page,
    context: BrowserContext | None = None,
) -> bool:
    """Verifica se está logado. Se não, tenta auto_login(). Se falhar, avisa.

    Returns:
        True se está logado, False se precisa de login manual.
    """
    if await is_logged_in(page):
        logger.info("Sessão ativa — usuário logado no Bet365")
        if context:
            await save_cookies(context)
        return True

    # Tenta auto_login com credenciais do .env
    if context:
        logged = await auto_login(page, context)
        if logged:
            await save_cookies(context)
            return True

    logger.warning(
        "Não está logado no Bet365. "
        "Execute: python scripts/manual_login.py"
    )
    return False
