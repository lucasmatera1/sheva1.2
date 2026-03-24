"""Abre o Camoufox para login manual no Bet365.

O Bet365 bloqueia login automatizado (detecta preenchimento por script
como "senha incorreta"). A solução é você logar manualmente dentro do
Camoufox — mouse e teclado reais — e este script salva os cookies da
sessão para uso futuro pelo auto-bet.

Uso:
    python scripts/manual_login.py

O browser abre, você loga, pressiona ENTER e os cookies são salvos.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
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
    engine = BrowserEngine(settings.browser)

    print()
    print("=" * 55)
    print("  SHEVA — Login Manual no Bet365 via Camoufox")
    print("=" * 55)
    print()
    print("  O browser vai abrir. Faça o login manualmente:")
    print("  1. Clique em 'Login' no header")
    print("  2. Digite seu usuário e senha")
    print("  3. Clique em 'Login' para entrar")
    print("  4. Volte aqui e pressione ENTER para salvar")
    print()

    async with engine.launch() as context:
        # NÃO carrega cookies expirados — eles podem causar redirect loop
        # O usuário vai fazer login do zero.

        # Cria página SEM stealth scripts — eles causam reload loop no Bet365
        page = await context.new_page()
        page.set_default_timeout(30_000)

        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(5)

        # Fecha popup de cookies se existir (pode estar cobrindo o botão Login)
        try:
            cookie_btn = await page.query_selector("#onetrust-accept-btn-handler")
            if cookie_btn:
                await cookie_btn.click()
                print("  [*] Popup de cookies fechado")
                await asyncio.sleep(1)
        except Exception:
            pass

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

        print("  [*] Browser aberto. Faça login agora...")
        print()

        # Espera o usuário pressionar ENTER no terminal
        await _wait_enter()

        # Captura info do header (para diagnóstico e validação)
        header = await _dump_header(page)

        # Verifica se há indício de login
        btn_texts = [b["text"] for b in header.get("buttons", [])]
        has_login_btn = "Login" in btn_texts or "Entrar" in btn_texts
        has_hm = len(header.get("hmElements", [])) > 0

        if has_hm or not has_login_btn:
            # Provavelmente logado — salva cookies
            await save_cookies(context)
            cookie_count = len(await context.cookies())
            print()
            print(f"  ✅ {cookie_count} cookies salvos!")
            print("     Sessão será reutilizada nas próximas execuções.")
        else:
            print()
            print("  ⚠️ Parece que o login não foi feito.")
            print("     Os cookies serão salvos assim mesmo.")
            await save_cookies(context)

        # Diagnóstico do header
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
