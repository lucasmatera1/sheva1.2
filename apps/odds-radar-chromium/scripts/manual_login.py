"""Abre o Chromium para login no Bet365.

Tenta auto-login com credenciais do .env (BET365_USER / BET365_PASS).
Se não houver credenciais, abre o browser para login manual.

Uso:
    python scripts/manual_login.py

O browser abre, loga automaticamente (ou você loga manualmente),
e os cookies são salvos para reutilização.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.login import auto_login, is_logged_in
from src.browser.session import load_cookies, save_cookies
from src.utils.logger import get_logger

logger = get_logger("manual_login")

BET365_URL = "https://www.bet365.bet.br/"

# Aceita URL via CLI: python scripts/manual_login.py "URL"
if len(sys.argv) > 1:
    BET365_URL = sys.argv[1]


async def _wait_enter() -> None:
    """Aguarda ENTER no terminal sem bloquear o event-loop."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: input("  >>> Pressione ENTER após fazer login: "))


async def _dump_header(page) -> dict:
    """Captura o estado do header para diagnóstico."""
    return await page.evaluate("""() => {
        const r = { buttons: [], hmElements: [] };
        document.querySelectorAll('button').forEach(b => {
            const t = (b.textContent || '').trim();
            if (t && t.length < 40)
                r.buttons.push({ text: t, cls: b.className.substring(0, 120) });
        });
        document.querySelectorAll('[class*="hm-"]').forEach(el => {
            r.hmElements.push({
                tag: el.tagName,
                cls: el.className.substring(0, 200),
                text: (el.textContent || '').trim().substring(0, 80),
            });
        });
        return r;
    }""")


async def main() -> None:
    settings = get_settings()
    # Força headless=False para login (precisa de browser visível)
    from dataclasses import replace as dc_replace
    browser_settings = dc_replace(settings.browser, headless=False)
    engine = BrowserEngine(browser_settings)

    has_creds = bool(os.environ.get("BET365_USER")) and bool(os.environ.get("BET365_PASS"))

    print()
    print("=" * 55)
    print("  SHEVA — Login no Bet365 via Chromium")
    print("=" * 55)
    print()
    if has_creds:
        print("  Modo: AUTO-LOGIN (credenciais do .env)")
    else:
        print("  Modo: LOGIN MANUAL (sem credenciais no .env)")
        print("  1. Clique em 'Login' no header")
        print("  2. Digite seu usuário e senha")
        print("  3. Clique em 'Login' para entrar")
        print("  4. Volte aqui e pressione ENTER para salvar")
    print()

    async with engine.launch() as context:
        # Carrega cookies salvos (pode ter sessão ativa)
        cookies_loaded = await load_cookies(context)
        if cookies_loaded:
            print("  [*] Cookies de sessão anterior carregados")

        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        print("  [*] Navegando para Bet365...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(5)

        # Fecha popup de geolocalização se existir
        try:
            geo = await page.query_selector(".gsm-EnableBrowserGeolocationPopup")
            if geo:
                close = await geo.query_selector("button, [class*='Close']")
                if close:
                    await close.click()
                    print("  [*] Popup de geo fechado")
                    await asyncio.sleep(1)
        except Exception:
            pass

        # Verifica se já está logado (via cookies)
        if await is_logged_in(page):
            print("  ✅ Já logado via cookies de sessão anterior!")
            await save_cookies(context)
            cookie_count = len(await context.cookies())
            print(f"     {cookie_count} cookies atualizados.")
        elif has_creds:
            # Auto-login com credenciais
            print("  [*] Tentando auto-login...")
            logged = await auto_login(page, context)
            if logged:
                await save_cookies(context)
                cookie_count = len(await context.cookies())
                print(f"  ✅ Login automático OK! {cookie_count} cookies salvos.")
            else:
                print("  ⚠️ Auto-login falhou. Tente login manual.")
                print("     Faça login no browser e pressione ENTER...")
                await _wait_enter()
                await save_cookies(context)
        else:
            # Login manual
            print("  [*] Browser aberto. Faça login agora...")
            print()
            await _wait_enter()

            if await is_logged_in(page):
                await save_cookies(context)
                cookie_count = len(await context.cookies())
                print(f"  ✅ {cookie_count} cookies salvos!")
            else:
                print("  ⚠️ Parece que o login não foi feito.")
                print("     Os cookies serão salvos assim mesmo.")
                await save_cookies(context)

        # Diagnóstico do header
        header = await _dump_header(page)
        btn_texts = [b["text"] for b in header.get("buttons", [])]
        print()
        print("  --- Header Debug ---")
        print(f"  Botões: {btn_texts[:10]}")
        print(f"  Elementos hm-*: {len(header.get('hmElements', []))}")
        for el in header.get("hmElements", [])[:5]:
            print(f"    <{el['tag']}> {el['cls'][:80]}")
        print("  --- Fim Debug ---")
        print()

        await page.close()

    print("=" * 55)
    print("  Browser fechado.")
    print("=" * 55)


if __name__ == "__main__":
    asyncio.run(main())
