"""Aposta REAL de R$1.00 em URL direta de jogo.

⚠️  ESTE SCRIPT COLOCA UMA APOSTA DE VERDADE!
    Valor: R$1.00 | URL passada como argumento ou hardcoded
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.betting import BetPlacer
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies, save_cookies
from src.models.odds import BetStatus
from src.utils.logger import get_logger

logger = get_logger("bet_direct")

# URL padrão — pode ser substituída via CLI: python scripts/bet_direct.py "URL"
DEFAULT_URL = "https://www.bet365.bet.br/?#/AC/B1/C1/D8/E190299225/F3/P30423/H1/"
STAKE = 1.00


async def dump_page(page, label: str = "") -> dict:
    """Diagnóstico completo da página."""
    return await page.evaluate("""(label) => {
        const r = { label };

        // Título / breadcrumb
        const title = document.querySelector('.sph-EventWrapper_Label, .cl-EnhancedDropDown');
        r.title = title ? title.textContent.trim() : null;

        // Fixture details (nomes de jogadores)
        const names = document.querySelectorAll('.rcl-ParticipantFixtureDetailsTeam_TeamName');
        r.teamNames = Array.from(names).map(n => n.textContent.trim());

        // Odds clicáveis — múltiplos seletores para página de jogo
        const oddSels = [
            '.sgl-ParticipantOddsOnly80_Odds',
            '.gl-Participant_General',
            '.srb-ParticipantLabelWithOdds_Odds',
            '.srb-ParticipantLabelWithOdds',
            '.gl-ParticipantOddsOnly_Odds',
            '.sac-ParticipantOddsOnly50_Odds',
            '.gl-Participant_General-cn',
        ];
        for (const sel of oddSels) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                r.oddSelector = sel;
                r.oddCount = els.length;
                r.firstOdds = Array.from(els).slice(0, 10).map(e => ({
                    text: e.textContent.trim(),
                    classes: e.className,
                    parentClasses: e.parentElement ? e.parentElement.className.split(' ')[0] : '',
                }));
                break;
            }
        }

        // Market headers
        const headers = document.querySelectorAll('.rcl-MarketColumnHeader, .rcl-MarketHeaderLabel-is498');
        r.headers = Array.from(headers).map(h => h.textContent.trim());

        // Seletores genéricos de participante (página de jogo expandida)
        const participants = document.querySelectorAll('[class*="Participant"][class*="Odds"]');
        r.participantOddsCount = participants.length;

        // Betslip status
        const betslip = document.querySelector('.bss-StandardBetslip, [class*="Betslip"]');
        r.betslipVisible = !!betslip;

        // Erros
        const genErr = document.querySelector('.bs-GeneralErrorMessage');
        r.generalError = genErr ? genErr.textContent.trim().substring(0, 200) : null;

        return r;
    }""", label)


async def dismiss_popups(page, label: str = "") -> int:
    """Fecha todos os popups conhecidos do Bet365. Retorna quantos fechou."""
    total = 0
    for _ in range(5):
        closed = await page.evaluate("""() => {
            let count = 0;

            // 1. Cookie popup
            const cookie = document.querySelector('#onetrust-accept-btn-handler');
            if (cookie && cookie.offsetParent !== null) { cookie.click(); count++; }

            // 2. Modal "Continuar" (login confirmation)
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

            // 3. Promo popups (App de Esportes, etc.) — close button (X)
            const closeBtns = document.querySelectorAll(
                '[class*="iip-IntroductoryPopup_Close"],' +
                '[class*="lp-UserNotificationsPopup_Close"],' +
                '[class*="pop-"][class*="_Close"],' +
                '[class*="Popup"][class*="Close"]'
            );
            for (const btn of closeBtns) {
                if (btn.getBoundingClientRect().width > 0) { btn.click(); count++; }
            }

            // 4. Generic overlay close — qualquer X visível em overlay/popup
            const overlays = document.querySelectorAll('[class*="Overlay"], [class*="overlay"], [class*="Modal"], [class*="Popup"]');
            for (const ov of overlays) {
                const xBtn = ov.querySelector('[class*="Close"], [class*="close"]');
                if (xBtn && xBtn.getBoundingClientRect().width > 0 && xBtn.getBoundingClientRect().height > 0) {
                    xBtn.click(); count++;
                }
            }

            return count;
        }""")
        if closed and closed > 0:
            total += closed
            await asyncio.sleep(1)
        else:
            break
    if total > 0:
        print(f"   [dismiss{' ' + label if label else ''}] Fechou {total} popup(s)")
    return total


async def click_first_odd(page) -> dict | None:
    """Clica na odd do Resultado Final usando Playwright nativo (anti-bot)."""
    # Localiza as odds do mercado "Resultado Final" (primeira seção, 3 odds: Home/Draw/Away)
    odds = page.locator(".gl-Participant_General")
    count = await odds.count()
    if count == 0:
        return None

    # Percorre as odds e clica na primeira com valor numérico válido
    for i in range(min(count, 20)):
        el = odds.nth(i)
        text = (await el.text_content() or "").strip()

        # Extrai só a parte numérica (odds como "Brighton3.20" → "3.20")
        import re
        m = re.search(r'(\d+[.,]\d+)', text)
        if not m:
            continue
        val_str = m.group(1)
        val = float(val_str.replace(",", "."))
        if val < 1.01:
            continue

        # Verifica se não está suspenso
        cls = await el.get_attribute("class") or ""
        if "Suspended" in cls:
            continue

        # Clique nativo do Playwright (gera eventos de mouse realistas)
        try:
            await el.click(timeout=5000)
            return {
                "found": True,
                "oddValue": val_str,
                "selector": ".gl-Participant_General",
                "label": text.replace(val_str, "").strip() or f"Sel@{val_str}",
            }
        except Exception as e:
            logger.warning(f"Falha ao clicar odd #{i}: {e}")
            continue

    return None


async def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    placer = BetPlacer(engine)

    print()
    print("=" * 60)
    print("  ⚠️  APOSTA DIRETA — R$1.00")
    print(f"  URL: {url[:70]}...")
    print("=" * 60)

    async with engine.launch() as context:
        await load_cookies(context)
        page = await engine.new_page(context)

        try:
            # 1. Navega direto para o jogo
            print("\n⏳ Navegando...")
            await page.goto(url, wait_until="domcontentloaded")
            await asyncio.sleep(5)

            # Dismiss initial popups (cookies, etc.)
            await dismiss_popups(page, "initial")

            # 2. Login check
            logged = await ensure_logged_in(page, context)
            if not logged:
                print("\n❌ Não logado! Execute: python scripts/manual_login.py")
                return
            print("🔐 Login: ✅")

            # 2b. Geolocalização
            geo = await engine.check_geolocation(page)
            if geo:
                print(f"📍 Geo: lat={geo['latitude']:.4f} lon={geo['longitude']:.4f}")
            else:
                print("⚠️  Geo FALHOU")

            await engine.dismiss_geo_popup(page)
            await asyncio.sleep(1)

            # 2c. Fechar modal "Continuar" + quaisquer outros popups (espera até 8s)
            print("   Procurando popups...")
            for attempt in range(8):
                n = await dismiss_popups(page, f"round-{attempt}")
                if n > 0:
                    await asyncio.sleep(2)
                    continue  # tenta mais uma vez caso tenha popup cascata
                if attempt >= 2:
                    break  # já tentou 3x sem encontrar nada
                await asyncio.sleep(1)

            # 3. Diagnóstico da página
            diag = await dump_page(page, "initial")
            print(f"\n📋 Página: {diag.get('title', '?')}")
            print(f"   Times: {diag.get('teamNames', [])}")
            print(f"   Odds encontradas: {diag.get('oddCount', 0)} (seletor: {diag.get('oddSelector', 'nenhum')})")
            if diag.get("firstOdds"):
                for o in diag["firstOdds"][:5]:
                    print(f"     • {o['text']} ({o['parentClasses']})")

            if not diag.get("oddCount"):
                print("\n❌ Nenhuma odd encontrada na página!")
                # Espera mais e tenta novamente
                print("   Esperando 5s...")
                await asyncio.sleep(5)
                diag = await dump_page(page, "retry")
                print(f"   Odds agora: {diag.get('oddCount', 0)}")
                if not diag.get("oddCount"):
                    # Dump HTML para debug
                    html = await page.content()
                    Path("data/screenshots").mkdir(parents=True, exist_ok=True)
                    Path("data/screenshots/page_dump.html").write_text(html[:50000], encoding="utf-8")
                    await page.screenshot(path="data/screenshots/no_odds.png", full_page=True)
                    print("   📸 Screenshot e HTML salvos para debug")
                    return

            # 4. Clica na primeira odd
            await dismiss_popups(page, "pre-odd")
            print(f"\n📌 Clicando na primeira odd disponível...")
            click_result = await click_first_odd(page)
            if not click_result:
                print("❌ Nenhuma odd clicável encontrada!")
                return

            odd_str = click_result["oddValue"]
            try:
                odd_val = float(odd_str.replace(",", "."))
            except ValueError:
                print(f"❌ Odd inválida: {odd_str}")
                return

            print(f"✅ Odd clicada: {odd_val:.2f} ({click_result.get('label', '')})")
            print(f"   Seletor: {click_result['selector']}")

            # Espera betslip abrir e dismiss popups que surgem
            await asyncio.sleep(3)
            await dismiss_popups(page, "pre-stake")

            # 5. Screenshot pré-stake
            Path("data/screenshots").mkdir(parents=True, exist_ok=True)
            await placer.take_screenshot(page, "data/screenshots/pre_stake.png")

            # 6. Preenche stake
            print(f"\n💰 Preenchendo R${STAKE:.2f}...")
            filled = await placer.fill_stake(page, STAKE)
            if not filled:
                print("❌ Falha ao preencher stake!")
                await placer.take_screenshot(page, "data/screenshots/stake_failed.png")
                return
            print("✅ Stake preenchida")

            # 7. Screenshot pré-aposta
            await placer.take_screenshot(page, "data/screenshots/pre_bet.png")
            print("📸 Screenshot pré-aposta")

            # 8. COLOCA A APOSTA
            print(f"\n🎰 COLOCANDO APOSTA R${STAKE:.2f} @ {odd_val:.2f}...")
            await asyncio.sleep(1)
            status = await placer.place_bet(page)

            # 9. Screenshot pós-aposta
            await asyncio.sleep(2)
            await placer.take_screenshot(page, "data/screenshots/post_bet.png")

            if status == BetStatus.ACCEPTED:
                print(f"\n✅ APOSTA ACEITA! R${STAKE:.2f} @ {odd_val:.2f}")
            elif status == BetStatus.REJECTED:
                print(f"\n⚠️  APOSTA REJEITADA")
            else:
                print(f"\n❌ ERRO (status: {status})")

            await placer.close_betslip(page)
            await save_cookies(context)

        except Exception as e:
            logger.error("Erro: {}", e)
            import traceback
            traceback.print_exc()
        finally:
            await page.close()


if __name__ == "__main__":
    asyncio.run(main())
