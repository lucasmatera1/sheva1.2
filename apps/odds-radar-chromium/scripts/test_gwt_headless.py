"""Teste headless: login + gwt cookie.

Verifica se o Playwright Chromium em modo headless
consegue gerar o cookie gwt (GeoComply) após login.

Uso:
    python scripts/test_gwt_headless.py
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
from src.api.token_harvester import TokenHarvester

BET365_URL = "https://www.bet365.bet.br/"
GWT_TIMEOUT = 90  # segundos


async def main() -> None:
    settings = get_settings()
    # Usa headless do .env (deve ser True para produção)
    engine = BrowserEngine(settings.browser)

    print()
    print("=" * 55)
    print("  SHEVA — Teste gwt headless")
    print(f"  headless={settings.browser.headless}")
    print("=" * 55)
    print()

    async with engine.launch() as context:
        # 1. Carrega cookies
        loaded = await load_cookies(context)
        if loaded:
            print("[1] Cookies de sessão carregados")
        else:
            print("[1] Nenhum cookie salvo encontrado")

        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # 2. Navega
        print("[2] Navegando para Bet365...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30_000)
        await asyncio.sleep(3)

        # 3. Login
        logged = await is_logged_in(page)
        if logged:
            print("[3] Já logado (cookie pstk presente)")
        else:
            print("[3] Fazendo auto-login...")
            ok = await auto_login(page, context)
            if not ok:
                print("❌ Login falhou! Abortando.")
                await save_cookies(context)
                return
            print("[3] Login OK ✅")

        await save_cookies(context)

        # 4. Navega para In-Play eSports (trigger GeoComply)
        print("[4] Navegando para #/IP/B18 (In-Play eSports)...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(4)

        # 5. Geo check
        geo_ok = await engine.check_geolocation(page)
        if geo_ok:
            print(f"[5] Geolocalização: OK (lat={geo_ok['latitude']:.4f})")
        else:
            print("[5] ⚠️ Geolocalização: NÃO confirmada (pode funcionar ainda)")

        # 6. Espera gwt
        harvester = TokenHarvester()
        tokens = await harvester.extract_from_page(page)

        if tokens.gwt:
            print(f"[6] gwt já presente: {tokens.gwt[:30]}...")
        else:
            print(f"[6] gwt ausente — esperando até {GWT_TIMEOUT}s...")
            for i in range(GWT_TIMEOUT):
                await asyncio.sleep(1)
                all_ck = await context.cookies()
                gwt_found = any(c["name"] == "gwt" for c in all_ck)
                if gwt_found:
                    tokens = await harvester.extract_from_page(page)
                    print(f"[6] gwt APARECEU após {i + 1}s ✅")
                    break
                if (i + 1) % 30 == 0:
                    # Re-navega para re-triggar GeoComply
                    await page.evaluate("window.location.hash = '#/IP'")
                    await asyncio.sleep(2)
                    await page.evaluate("window.location.hash = '#/IP/B18'")
                    await asyncio.sleep(3)
                    print(f"  ... {i + 1}s — re-navegando para triggar GeoComply...")

        # 7. Resultado final
        print()
        print("=" * 55)
        print("  RESULTADO")
        print("=" * 55)
        print(f"  pstk : {'OK' if tokens.pstk else 'AUSENTE'}")
        print(f"  gwt  : {'OK (' + tokens.gwt[:30] + '...)' if tokens.gwt else 'AUSENTE ❌'}")
        print(f"  swt  : {'OK' if tokens.swt else 'ausente'}")
        print(f"  aaat : {'OK' if tokens.aaat else 'ausente'}")
        print(f"  pers : {'OK' if tokens.pers else 'ausente'}")
        print()

        if tokens.gwt:
            print("✅ gwt headless FUNCIONA — Chromium produção OK")
        else:
            print("❌ gwt NÃO apareceu — GeoComply pode não funcionar headless")
            print("   Possíveis causas:")
            print("   - GeoComply requer browser visível (headed)")
            print("   - WebRTC está sendo bloqueado")
            print("   - Geolocalização não foi aceita")
        print()

        await save_cookies(context)


if __name__ == "__main__":
    asyncio.run(main())
