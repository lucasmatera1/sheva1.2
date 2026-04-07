"""
Perfil Passivo (Desbug) — apostas aleatórias para manter conta ativa.

Inspirado no recurso "Perfis Passivos" do Tippy.bet:
- Faz apostas pequenas em intervalos configuráveis
- Odds e mercados aleatórios (parece comportamento humano real)
- Evita detecção por inatividade prolongada na conta Bet365

Uso:
  python scripts/bet_passive.py                       → 1 aposta aleatória
  python scripts/bet_passive.py --count 3             → 3 apostas
  python scripts/bet_passive.py --dry-run             → simula sem apostar
  python scripts/bet_passive.py --interval 3600       → espera 1h entre apostas

Variáveis de ambiente (.env):
  PASSIVE_STAKE=1.00        → valor por aposta (R$)
  PASSIVE_ODD_MIN=1.50      → odd mínima
  PASSIVE_ODD_MAX=3.00      → odd máxima
  PASSIVE_COUNT=1            → apostas por execução
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.async_api import async_playwright
from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies
from src.utils.logger import get_logger

logger = get_logger("bet_passive")

# ── Config ───────────────────────────────────────────────────────────────────

PASSIVE_STAKE = float(os.getenv("PASSIVE_STAKE", "1.00"))
PASSIVE_ODD_MIN = float(os.getenv("PASSIVE_ODD_MIN", "1.50"))
PASSIVE_ODD_MAX = float(os.getenv("PASSIVE_ODD_MAX", "3.00"))
PASSIVE_COUNT = int(os.getenv("PASSIVE_COUNT", "1"))

# URLs de esportes populares no Bet365 (eSoccer / eBattle / leagues comuns)
PASSIVE_URLS = [
    "https://www.bet365.bet.br/#/IP/B18",          # eSoccer geral
    "https://www.bet365.bet.br/#/IP/B151",         # eBasket
]


async def dismiss_popups(page) -> int:
    """Fecha popups do Bet365."""
    total = 0
    for _ in range(3):
        closed = await page.evaluate("""() => {
            let count = 0;
            const cookie = document.querySelector('#onetrust-accept-btn-handler');
            if (cookie && cookie.offsetParent !== null) { cookie.click(); count++; }
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
            while (walk.nextNode()) {
                const el = walk.currentNode;
                const dt = Array.from(el.childNodes)
                    .filter(n => n.nodeType === 3)
                    .map(n => n.textContent.trim()).join('');
                if ((dt === 'Continuar' || dt === 'Continue') &&
                    el.getBoundingClientRect().width > 50) {
                    el.click(); count++; break;
                }
            }
            return count;
        }""")
        if closed and closed > 0:
            total += closed
            await asyncio.sleep(0.5)
        else:
            break
    return total


async def find_random_odd(page, odd_min: float, odd_max: float) -> dict | None:
    """Encontra uma odd aleatória dentro do range na página atual.

    Returns:
        dict com {selector_index, odd_value, label} ou None.
    """
    odds_data = await page.evaluate(f"""() => {{
        const cells = document.querySelectorAll(
            '.sgl-ParticipantOddsOnly80_Odds, .gl-ParticipantOddsOnly_Odds'
        );
        const results = [];
        for (let i = 0; i < cells.length; i++) {{
            const text = cells[i].textContent.trim();
            const val = parseFloat(text);
            if (!isNaN(val) && val >= {odd_min} && val <= {odd_max}) {{
                results.push({{index: i, value: val, text: text}});
            }}
        }}
        return results;
    }}""")

    if not odds_data:
        return None

    chosen = random.choice(odds_data)
    return chosen


async def click_odd_by_index(page, index: int) -> bool:
    """Clica na odd pelo índice da lista de odds visíveis."""
    return await page.evaluate(f"""() => {{
        const cells = document.querySelectorAll(
            '.sgl-ParticipantOddsOnly80_Odds, .gl-ParticipantOddsOnly_Odds'
        );
        if ({index} < cells.length) {{
            cells[{index}].click();
            return true;
        }}
        return false;
    }}""")


async def fill_stake_and_place(page, stake: float, dry_run: bool = False) -> dict:
    """Preenche stake e coloca a aposta.

    Returns:
        dict com {success, odd, stake, message}.
    """
    result = {"success": False, "odd": 0.0, "stake": stake, "message": ""}

    # Espera betslip abrir
    await asyncio.sleep(1.5)

    # Lê odd do betslip
    odd_sel = page.locator('.bsf-BetslipOdds, [class*="Odds_Odds"]').first
    try:
        odd_text = await odd_sel.text_content(timeout=3000)
        if odd_text:
            result["odd"] = float(odd_text.strip())
    except Exception:
        pass

    if dry_run:
        result["message"] = "DRY RUN — aposta simulada"
        logger.info("🔵 DRY RUN: odd={:.2f} stake={:.2f}", result["odd"], stake)
        # Fecha betslip
        close_btn = page.locator('[class*="RemoveButton"], [class*="Close"]').first
        try:
            await close_btn.click(timeout=2000)
        except Exception:
            pass
        result["success"] = True
        return result

    # Preenche stake
    stake_loc = page.locator(
        'div[contenteditable="true"].bsf-StakeBox_StakeValue-input'
    ).first
    try:
        await stake_loc.wait_for(state="attached", timeout=3000)
    except Exception:
        alt = page.locator('[class*="StakeBox"] [contenteditable="true"]').first
        try:
            await alt.wait_for(state="attached", timeout=2000)
            stake_loc = alt
        except Exception:
            result["message"] = "Campo de stake não encontrado"
            return result

    await stake_loc.click(timeout=2000)
    await page.keyboard.press("Control+a")
    await page.keyboard.type(f"{stake:.2f}", delay=random.randint(40, 80))
    await asyncio.sleep(0.5)

    # Clica em "Fazer Aposta"
    place_btn = page.locator('.bsf-PlaceBetButton').first
    try:
        await place_btn.wait_for(state="visible", timeout=3000)
        btn_text = await place_btn.text_content()
        logger.info("Botão: {}", btn_text)
        await place_btn.click(timeout=3000)
    except Exception as e:
        result["message"] = f"Erro ao clicar botão: {e}"
        return result

    # Aguarda confirmação
    await asyncio.sleep(3)
    receipt = page.locator('[class*="ReceiptContent"], [class*="Receipt"]').first
    try:
        await receipt.wait_for(state="visible", timeout=10000)
        result["success"] = True
        result["message"] = "Aposta colocada"
        logger.info("✅ Aposta passiva colocada: odd={:.2f} stake={:.2f}",
                     result["odd"], stake)
    except Exception:
        # Pode ter rejeitado ou odd mudou
        result["message"] = "Sem confirmação de recibo"
        logger.warning("⚠️ Sem recibo de confirmação")

    return result


async def run_passive(
    count: int = 1,
    stake: float = PASSIVE_STAKE,
    odd_min: float = PASSIVE_ODD_MIN,
    odd_max: float = PASSIVE_ODD_MAX,
    interval: int = 0,
    dry_run: bool = False,
) -> list[dict]:
    """Executa apostas passivas.

    Returns:
        Lista de resultados por aposta.
    """
    settings = get_settings()
    s = settings.browser
    results = []

    from src.browser.engine import STEALTH_CHROMIUM_ARGS

    args = list(STEALTH_CHROMIUM_ARGS)
    if not s.headless:
        args.append(f"--window-size={s.viewport_width},{s.viewport_height}")

    print("=" * 60)
    print("  🎭 Perfil Passivo (Desbug)")
    print(f"  Apostas: {count} | Stake: R${stake:.2f}")
    print(f"  Odds: {odd_min:.2f}–{odd_max:.2f}")
    print(f"  {'🔵 DRY RUN' if dry_run else '🔴 REAL'}")
    print("=" * 60)

    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=s.user_data_dir,
        headless=s.headless,
        args=args,
        geolocation={"latitude": -23.4210, "longitude": -51.9331},
        permissions=["geolocation"],
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": s.viewport_width, "height": s.viewport_height},
        ignore_https_errors=True,
    )
    try:
        ctx = context
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        engine = BrowserEngine(s)
        engine._page = page

        # Login
        print("\n⏳ Carregando cookies...")
        cookies = load_cookies()
        if cookies:
            await ctx.add_cookies(cookies)

        await page.goto("https://www.bet365.bet.br", timeout=30000)
        await asyncio.sleep(3)
        await dismiss_popups(page)

        logged_in = await ensure_logged_in(page, s)
        if not logged_in:
            print("❌ Falha no login — abortando")
            return results

        await dismiss_popups(page)

        for i in range(count):
            if i > 0 and interval > 0:
                wait_jitter = interval + random.randint(-30, 30)
                print(f"\n⏳ Aguardando {wait_jitter}s antes da próxima aposta...")
                await asyncio.sleep(wait_jitter)

            # Navega para URL aleatória
            url = random.choice(PASSIVE_URLS)
            print(f"\n🎲 Aposta {i + 1}/{count}")
            print(f"   URL: {url}")

            await page.goto(url, timeout=30000)
            await asyncio.sleep(random.uniform(3, 6))
            await dismiss_popups(page)

            # Scroll aleatório para parecer humano
            scroll_amount = random.randint(200, 800)
            await page.evaluate(f"window.scrollBy(0, {scroll_amount})")
            await asyncio.sleep(random.uniform(1, 3))

            # Encontra odd aleatória
            odd_data = await find_random_odd(page, odd_min, odd_max)
            if not odd_data:
                print("   ⚠️ Nenhuma odd encontrada no range — pulando")
                results.append({"success": False, "message": "Sem odds no range"})
                continue

            print(f"   Odd selecionada: {odd_data['value']:.2f} (índice {odd_data['index']})")

            # Clica na odd
            clicked = await click_odd_by_index(page, odd_data["index"])
            if not clicked:
                print("   ⚠️ Falha ao clicar na odd — pulando")
                results.append({"success": False, "message": "Click falhou"})
                continue

            # Preenche e aposta
            bet_result = await fill_stake_and_place(page, stake, dry_run=dry_run)
            results.append(bet_result)

            status = "✅" if bet_result["success"] else "❌"
            print(f"   {status} {bet_result['message']}")

            # Pausa humanizada
            await asyncio.sleep(random.uniform(2, 5))
    finally:
        await context.close()
        await pw.stop()

    # Resumo
    print("\n" + "=" * 60)
    placed = sum(1 for r in results if r["success"])
    print(f"  📊 Resultado: {placed}/{count} apostas realizadas")
    total_staked = sum(r["stake"] for r in results if r["success"])
    print(f"  💰 Total apostado: R${total_staked:.2f}")
    print("=" * 60)

    return results


def main():
    parser = argparse.ArgumentParser(description="Perfil Passivo — apostas de desbug")
    parser.add_argument("--count", type=int, default=PASSIVE_COUNT,
                        help="Número de apostas (default: 1)")
    parser.add_argument("--stake", type=float, default=PASSIVE_STAKE,
                        help="Valor por aposta em R$ (default: 1.00)")
    parser.add_argument("--odd-min", type=float, default=PASSIVE_ODD_MIN,
                        help="Odd mínima (default: 1.50)")
    parser.add_argument("--odd-max", type=float, default=PASSIVE_ODD_MAX,
                        help="Odd máxima (default: 3.00)")
    parser.add_argument("--interval", type=int, default=0,
                        help="Intervalo em segundos entre apostas (default: 0)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Simula sem apostar")
    args = parser.parse_args()

    asyncio.run(run_passive(
        count=args.count,
        stake=args.stake,
        odd_min=args.odd_min,
        odd_max=args.odd_max,
        interval=args.interval,
        dry_run=args.dry_run,
    ))


if __name__ == "__main__":
    main()
