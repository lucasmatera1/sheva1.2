"""Verifica se a sessão do Bet365 está logada (via cookies salvos)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.login import is_logged_in
from src.browser.session import load_cookies

BET365_URL = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"


async def main() -> None:
    settings = get_settings()
    engine = BrowserEngine(settings.browser)

    async with engine.launch() as context:
        await load_cookies(context)
        page = await engine.new_page(context)

        print("[1] Navegando para Bet365...")
        try:
            await page.goto(BET365_URL, wait_until="commit", timeout=45000)
            print("[2] Navegação OK (commit)")
        except Exception as e:
            print(f"[2] Navegação falhou: {e}")

        print("[3] Aguardando 8s para página carregar...")
        await asyncio.sleep(8)

        print("[4] Verificando login...")
        try:
            logged = await is_logged_in(page)
            if logged:
                print("✅ LOGADO — sessão válida")
            else:
                print("❌ NÃO LOGADO — execute: python scripts/manual_login.py")
        except Exception as e:
            print(f"[4] Erro ao verificar login: {e}")

        print("[5] Fechando...")
        try:
            await page.close()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
