"""Teste e2e: full_session_init (login → gwt → warm-up) + spectator.

Executa o mesmo fluxo do bet_telegram.py sem precisar de Telegram.
Mantém o browser aberto por 30s após init para visualização no spectator.

Uso:
    1. Rode spectator.py em outro terminal
    2. python scripts/test_session_e2e.py
    3. Abra http://localhost:7777
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
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
from src.betting.ui_placer import UIBetPlacer

STAKE = float(os.environ.get("BET_STAKE", "0.20"))
SPECTATOR_PATH = Path(__file__).resolve().parent.parent / "tmp" / "spectator_live.png"


async def main() -> None:
    settings = get_settings()
    engine = BrowserEngine(settings.browser)

    print()
    print("=" * 60)
    print("  SHEVA — Teste e2e: full_session_init + spectator")
    print(f"  headless={settings.browser.headless}  stake=R${STAKE:.2f}")
    print("=" * 60)
    print()

    async with engine.launch() as context:
        # Carrega cookies
        loaded = await load_cookies(context)
        if loaded:
            print("[setup] Cookies carregados")

        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # Spectator loop em background
        SPECTATOR_PATH.parent.mkdir(parents=True, exist_ok=True)
        spectator_running = True

        async def spectator_loop():
            while spectator_running:
                try:
                    await page.screenshot(path=str(SPECTATOR_PATH), full_page=True)
                except Exception:
                    pass
                await asyncio.sleep(0.3)

        spec_task = asyncio.create_task(spectator_loop())
        print("[setup] Spectator loop ativo (tmp/spectator_live.png)")

        # ─── full_session_init inline (mesmo fluxo do bet_telegram.py) ───
        print()
        print("⏳ Navegando para Bet365...")
        try:
            await page.goto(
                "https://www.bet365.bet.br/#/IP/",
                wait_until="domcontentloaded",
                timeout=30000,
            )
        except Exception as e:
            print(f"  Navegação lenta: {e}")
        await asyncio.sleep(3)

        # Check sessão
        has_pstk = any(
            c["name"] == "pstk"
            for c in await context.cookies("https://www.bet365.bet.br")
        )

        session_active = False
        if has_pstk:
            for _ in range(16):
                dom_check = await page.evaluate("""() => {
                    const btns = [...document.querySelectorAll('button')];
                    const hasLogin = btns.some(b => b.textContent.trim() === 'Login');
                    const hasMyBets = btns.some(b => {
                        const t = b.textContent.trim();
                        return t.includes('Minhas Apostas') || t.includes('My Bets');
                    });
                    const balEl = document.querySelector('.hm-Balance, [class*="Balance"]');
                    const hasBal = balEl && balEl.textContent.trim().length > 0;
                    return { hasLogin, hasMyBets, hasBal, btnCount: btns.length };
                }""")
                if dom_check.get("hasMyBets") or dom_check.get("hasBal"):
                    session_active = True
                    break
                if dom_check.get("hasLogin") and dom_check.get("btnCount", 0) > 2:
                    break
                await asyncio.sleep(0.5)

        if session_active:
            print("  ✅ Sessão ativa — login pulado!")
            logged = True
        else:
            print("  Fazendo auto-login...")
            logged = await auto_login(page, context)
            if logged:
                await save_cookies(context)
                print("  ✅ Login OK!")

        if not logged:
            print("❌ Login falhou!")
            spectator_running = False
            spec_task.cancel()
            return

        print("🔐 Login: ✅")

        # Navega In-Play eSports (trigger GeoComply)
        print("[gwt] Navegando para #/IP/B18...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(3)

        # Dismiss overlays
        ui = UIBetPlacer(page)
        await asyncio.sleep(1)
        await ui.dismiss_overlays()

        # Geo check
        geo_ok = await engine.check_geolocation(page)
        if geo_ok:
            print(f"[geo] OK (lat={geo_ok['latitude']:.4f})")
        else:
            print("[geo] ⚠️ Não confirmado")

        # Espera gwt (até 60s)
        harvester = TokenHarvester()
        tokens = await harvester.extract_from_page(page)
        if tokens.gwt:
            print(f"[gwt] Já presente: {tokens.gwt[:30]}...")
        else:
            print("[gwt] Esperando (até 60s)...")
            for i in range(60):
                await asyncio.sleep(1)
                all_ck = await context.cookies()
                if any(c["name"] == "gwt" for c in all_ck):
                    tokens = await harvester.extract_from_page(page)
                    print(f"[gwt] Apareceu após {i + 1}s ✅")
                    break
                if (i + 1) % 30 == 0:
                    await page.evaluate("window.location.hash = '#/IP'")
                    await asyncio.sleep(2)
                    await page.evaluate("window.location.hash = '#/IP/B18'")
                    await asyncio.sleep(3)
                    print(f"  ... {i + 1}s — re-navegando...")

        # Navega para Favoritos
        print("[nav] #/IP/FAV/...")
        await page.evaluate("window.location.hash = '#/IP/FAV/'")
        await asyncio.sleep(3)
        await ui.dismiss_overlays()

        # Warm-up
        print(f"[warmup] Tentando stake R${STAKE:.2f}...")
        warmup_ok = await ui.warm_up_stake(STAKE)
        if not warmup_ok:
            print("[warmup] Falhou em FAV — fallback #/IP/B18...")
            await page.evaluate("window.location.hash = '#/IP/B18'")
            await asyncio.sleep(3)
            await ui.dismiss_overlays()
            warmup_ok = await ui.warm_up_stake(STAKE)
            await page.evaluate("window.location.hash = '#/IP/FAV/'")
            await asyncio.sleep(2)

        # ─── Resultado final ─────────────────────────────────────────────
        print()
        print("=" * 60)
        print("  RESULTADO e2e")
        print("=" * 60)
        print(f"  Login   : ✅")
        print(f"  pstk    : {'OK' if tokens.pstk else 'AUSENTE'}")
        print(f"  gwt     : {'OK' if tokens.gwt else 'AUSENTE ❌'}")
        print(f"  swt     : {'OK' if tokens.swt else 'ausente'}")
        print(f"  Geo     : {'OK' if geo_ok else 'não confirmado'}")
        print(f"  Warm-up : {'Lembrar ATIVO ✅' if warmup_ok else '⚠️ manual'}")
        print()

        if tokens.gwt and logged:
            print("✅ SESSÃO COMPLETA — pronto para produção!")
        else:
            print("⚠️ Sessão parcial — verificar itens acima")

        # Mantém browser 30s para visualização no spectator
        print()
        print("  Mantendo browser aberto por 30s (veja http://localhost:7777)...")
        await asyncio.sleep(30)

        spectator_running = False
        spec_task.cancel()
        await save_cookies(context)


if __name__ == "__main__":
    asyncio.run(main())
