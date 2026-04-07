"""Listener Telegram para apostar direto na tela live já aberta do Bet365.

Fluxo:
1. Abre o browser e mantém a sessão logada.
2. O usuário deixa a grade ao vivo de handicap aberta.
3. Quando chega um sinal no Telegram, o script:
   - encontra o confronto na página atual,
   - identifica se a seleção é a linha de cima ou de baixo pelo time do sinal,
   - clica no handicap correto,
   - preenche stake,
   - confirma a aposta.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import random
import re
import sys
import time
from dataclasses import replace
from pathlib import Path

from loguru import logger as _loguru
from telethon import TelegramClient, events

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

os.environ["PYTHONUNBUFFERED"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"
sys.stdout = io.TextIOWrapper(
    sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
)
sys.stderr = io.TextIOWrapper(
    sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
)

from config.settings import get_settings
from src.betting import BetPlacer
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in, is_logged_in
from src.browser.session import load_cookies, save_cookies
from src.models.odds import BetStatus
from src.utils.logger import get_logger

logger = get_logger("bet_telegram_live_page")

PROJECT_DIR = Path(__file__).resolve().parent.parent
CONFIG_FILE = PROJECT_DIR / ".telegram_config.json"
SESSION_FILE = PROJECT_DIR / ".telegram_session"
LISTENER_LOG_FILE = PROJECT_DIR / "logs" / "bet_telegram_live_page.log"
ERROR_SCREENSHOT_DIR = (
    PROJECT_DIR / "data" / "screenshots" / "bet_telegram_live_page_errors"
)
FAVORITES_URL = "https://www.bet365.bet.br/#/IP/FAV"
MAX_ODD_DROP = 0.20
MAX_LINE_DROP = 2.0
MIN_INTERACTION_DELAY_SEC = 0.12
POST_BET_COOLDOWN_SEC = 2.0
POST_ACCEPT_CLEAR_DELAY_SEC = 1.0
KEEPALIVE_SEC = 25
SESSION_GUARD_SEC = 15
WEIRD_PAGE_THRESHOLD = 2
AUTO_LOGIN_RETRY_SEC = 45
BET365_USER = os.getenv("BET365_USER", "").strip()
BET365_PASS = os.getenv("BET365_PASS", "").strip()
_listener_log_configured = False


def configure_listener_logging() -> None:
    global _listener_log_configured
    if _listener_log_configured:
        return

    LISTENER_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    _loguru.add(
        str(LISTENER_LOG_FILE),
        level="DEBUG",
        rotation="10 MB",
        retention="10 days",
        encoding="utf-8",
        enqueue=True,
        format=(
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | "
            "{level: <8} | "
            "{name}:{function}:{line} | "
            "{message}"
        ),
    )
    _listener_log_configured = True


def slugify(value: str, *, fallback: str = "item") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    cleaned = cleaned.strip("._-")
    return cleaned[:64] or fallback


async def save_error_screenshot(page, signal: dict, reason: str) -> str:
    ERROR_SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    team = slugify(signal.get("selection_team", "signal"), fallback="signal")
    line_value = str(signal.get("line", "line")).replace("+", "plus").replace("-", "minus")
    line = slugify(line_value.replace(".", "_"), fallback="line")
    reason_slug = slugify(reason, fallback="error")
    screenshot_path = ERROR_SCREENSHOT_DIR / f"{timestamp}_{team}_{line}_{reason_slug}.png"

    try:
        await page.screenshot(path=str(screenshot_path), full_page=True)
        logger.warning("Screenshot de erro salvo: {}", screenshot_path)
        return str(screenshot_path)
    except Exception as exc:
        logger.error("Falha ao salvar screenshot de erro: {}", exc)
        return ""


configure_listener_logging()


def signal_signature(signal: dict) -> tuple:
    return (
        signal["selection_team"].strip().lower(),
        tuple(part.strip().lower() for part in signal["participants"]),
        round(float(signal["line"]), 2),
        round(float(signal["odd"]), 2),
    )


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def normalize_selection_team_label(value: str) -> str:
    cleaned = (value or "").strip()
    cleaned = re.sub(r"^(?:hc|handicap)\s+[:\-]?\s*", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def parse_signal(text: str) -> dict | None:
    """Extrai seleção, linha, odd e participantes do formato novo do Telegram."""
    if not text:
        return None

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in normalized.split("\n") if line.strip()]
    if not lines:
        return None

    selection_line = ""
    matchup_line = ""

    for line in lines:
        cleaned = re.sub(r"^[^\w(+-]+", "", line).strip()
        if "@" in cleaned and not selection_line:
            selection_line = cleaned
            continue
        if re.search(r"\b(?:vs|x|v)\b", cleaned, re.IGNORECASE) and not matchup_line:
            matchup_line = cleaned

    if not selection_line or not matchup_line:
        return None

    selection_match = re.match(
        r"(?P<team>.+?)\s+(?P<line>[+-]?\d+(?:[.,]\d+)?)\s*@\s*(?P<odd>\d+[.,]\d+)\s*$",
        selection_line,
    )
    matchup_match = re.match(
        r"(?P<left>.+?)\s+(?:vs|x|v)\s+(?P<right>.+)$",
        matchup_line,
        re.IGNORECASE,
    )

    if not selection_match or not matchup_match:
        return None

    raw_selection_team = selection_match.group("team").strip()
    selection_team = normalize_selection_team_label(raw_selection_team)
    participants = [
        matchup_match.group("left").strip(),
        matchup_match.group("right").strip(),
    ]

    if not selection_team or not all(participants):
        return None

    return {
        "selection_team": selection_team,
        "raw_selection_team": raw_selection_team,
        "participants": participants,
        "line": float(selection_match.group("line").replace(",", ".")),
        "odd": float(selection_match.group("odd").replace(",", ".")),
        "raw": text,
    }


async def dismiss_popups(page) -> int:
    total = 0
    for _ in range(4):
        closed = await page.evaluate(
            """() => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 8 && rect.height > 8;
                };

                let count = 0;
                const cookie = document.querySelector('#onetrust-accept-btn-handler');
                if (cookie && cookie.offsetParent !== null) {
                    cookie.click();
                    count++;
                }

                const closeBtns = document.querySelectorAll(
                    '[class*="IntroductoryPopup_Close"],' +
                    '[class*="NotificationsPopup_Close"],' +
                    '[class*="Popup"][class*="Close"]'
                );
                for (const btn of closeBtns) {
                    if (btn.getBoundingClientRect().width > 0) {
                        btn.click();
                        count++;
                    }
                }

                const overlay = Array.from(document.querySelectorAll('div, section, article'))
                    .filter(visible)
                    .find((el) => {
                        const text = (el.textContent || '').toLowerCase();
                        return (
                            text.includes('ultimo login') ||
                            text.includes('último login') ||
                            text.includes('jogue com responsabilidade')
                        );
                    });

                const continueCandidates = Array.from(
                    (overlay || document).querySelectorAll('button, [role="button"], div, span')
                )
                    .filter(visible)
                    .map((el) => ({
                        el,
                        text: (el.textContent || '').trim().toLowerCase(),
                        rect: el.getBoundingClientRect(),
                    }))
                    .filter((item) => item.text === 'continuar' || item.text === 'continue')
                    .sort((a, b) =>
                        (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
                    );

                if (continueCandidates.length) {
                    const btn = continueCandidates[0].el;
                    btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    btn.click();
                    count++;
                }

                return count;
            }"""
        )
        if not closed:
            break
        total += closed
        await asyncio.sleep(0.4)
    return total


async def keep_current_page_alive(page) -> None:
    while True:
        try:
            await dismiss_popups(page)
            await page.evaluate(
                """() => {
                    const y = window.scrollY || 0;
                    window.scrollTo(0, y + 1);
                    window.scrollTo(0, y);
                }"""
            )
        except Exception:
            pass
        await asyncio.sleep(KEEPALIVE_SEC)


async def reset_page_to_favorites(page) -> None:
    try:
        await page.goto(FAVORITES_URL, wait_until="domcontentloaded")
        await asyncio.sleep(1.5)
        await dismiss_popups(page)
        logger.info("Página resetada para favoritos após processamento do sinal")
    except Exception as exc:
        logger.warning("Falha ao resetar página para favoritos: {}", exc)


async def wait_for_favorites_market(page, timeout_sec: float = 8.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        state = await inspect_page_runtime(page)
        if state.get("onFavorites") and state.get("hasMarket"):
            return True
        await asyncio.sleep(0.5)
    return False


async def inspect_page_runtime(page) -> dict:
    try:
        state = await page.evaluate(
            """(favoritesUrl) => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 6 && rect.height > 6;
                };

                const buttonTexts = Array.from(document.querySelectorAll('button'))
                    .map((b) => (b.textContent || '').trim())
                    .filter(Boolean);

                const hasLoginButton = buttonTexts.includes('Login');
                const hasLoggedHeader =
                    buttonTexts.includes('Minhas Apostas') ||
                    buttonTexts.some((text) => /^R\\$/.test(text));

                const hasMarket =
                    Array.from(document.querySelectorAll(
                        '.gl-Participant_General, .ovm-ParticipantStackedCentered, .srb-ParticipantLabelWithOdds'
                    )).some(visible);

                const hasBetslip =
                    Array.from(document.querySelectorAll(
                        '.bs-Receipt, .bsf-ReceiptContent, .bss-ReceiptContent, .bss-StandardBetslip, .bsf-StakeBox_StakeValue-input'
                    )).some(visible);

                const weirdOverlay =
                    Array.from(document.querySelectorAll('[class*="Overlay"], [class*="Backdrop"], [class*="Mask"]'))
                        .filter(visible)
                        .some((el) => {
                            const rect = el.getBoundingClientRect();
                            return rect.width >= window.innerWidth * 0.65 && rect.height >= window.innerHeight * 0.65;
                        });

                return {
                    url: window.location.href,
                    onFavorites: window.location.href.includes('/#/IP/FAV') || window.location.href === favoritesUrl,
                    hasLoginButton,
                    hasLoggedHeader,
                    hasMarket,
                    hasBetslip,
                    weirdOverlay,
                    readyState: document.readyState,
                };
            }""",
            FAVORITES_URL,
        )
    except Exception as exc:
        return {
            "url": getattr(page, "url", ""),
            "onFavorites": False,
            "hasLoginButton": False,
            "hasLoggedHeader": False,
            "hasMarket": False,
            "hasBetslip": False,
            "weirdOverlay": False,
            "readyState": "error",
            "error": str(exc),
            "logged_in": False,
            "looks_weird": True,
        }

    state["logged_in"] = bool(state.get("hasLoggedHeader")) and not bool(state.get("hasLoginButton"))
    state["looks_weird"] = (
        not state.get("onFavorites")
        and not state.get("hasMarket")
        and not state.get("hasBetslip")
    ) or bool(state.get("weirdOverlay"))
    return state


async def attempt_auto_login(page, context, *, reason: str) -> bool:
    if not BET365_USER or not BET365_PASS:
        logger.warning("Relogin automático indisponível: BET365_USER/BET365_PASS não configurados")
        return False

    logger.warning("Tentando relogin automático no Bet365 | motivo={}", reason)

    try:
        await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded")
        await asyncio.sleep(3)
        await dismiss_popups(page)

        login_clicked = False
        for selector in [
            'button:has-text("Login")',
            'button:has-text("Entrar")',
            '[role="button"]:has-text("Login")',
            '[role="button"]:has-text("Entrar")',
        ]:
            try:
                btn = page.locator(selector).first
                await btn.click(timeout=1500)
                login_clicked = True
                break
            except Exception:
                pass

        if not login_clicked:
            logger.warning("Relogin automático: botão de login não encontrado")
            return False

        await asyncio.sleep(1.2)
        await dismiss_popups(page)

        user_locators = [
            'input[type="email"]',
            'input[name*="user" i]',
            'input[name*="login" i]',
            'input[type="text"]',
        ]
        pass_locators = [
            'input[type="password"]',
            'input[name*="pass" i]',
        ]

        user_field = None
        for selector in user_locators:
            try:
                locator = page.locator(selector).first
                await locator.wait_for(state="visible", timeout=1500)
                user_field = locator
                break
            except Exception:
                pass

        pass_field = None
        for selector in pass_locators:
            try:
                locator = page.locator(selector).first
                await locator.wait_for(state="visible", timeout=1500)
                pass_field = locator
                break
            except Exception:
                pass

        if user_field is None or pass_field is None:
            logger.warning("Relogin automático: campos de usuário/senha não encontrados")
            return False

        await user_field.click(timeout=1000)
        await user_field.fill(BET365_USER, timeout=2000)
        await asyncio.sleep(0.2)
        await pass_field.click(timeout=1000)
        await pass_field.fill(BET365_PASS, timeout=2000)
        await asyncio.sleep(0.25)

        submitted = False
        for selector in [
            'button[type="submit"]',
            'button:has-text("Login")',
            'button:has-text("Entrar")',
            '[role="button"]:has-text("Login")',
            '[role="button"]:has-text("Entrar")',
        ]:
            try:
                btn = page.locator(selector).last
                await btn.click(timeout=1500)
                submitted = True
                break
            except Exception:
                pass

        if not submitted:
            logger.warning("Relogin automático: botão de envio não encontrado")
            return False

        await asyncio.sleep(5)
        await dismiss_popups(page)
        logged = await ensure_logged_in(page, context)
        if not logged:
            logger.warning("Relogin automático não confirmou sessão logada")
            return False

        continued = await click_continue_after_login(page)
        if not continued:
            logger.warning("Relogin automático: modal Continuar não fechou antes de abrir favoritos")
        await page.goto(FAVORITES_URL, wait_until="domcontentloaded")
        await asyncio.sleep(2.5)
        continued = await click_continue_after_login(page)
        if not continued:
            logger.warning("Relogin automático: modal Continuar ainda permaneceu aberto em favoritos")
        await dismiss_popups(page)
        await save_cookies(context)
        logger.info("Relogin automático concluído com sucesso e favoritos restaurados")
        return True

    except Exception as exc:
        logger.warning("Relogin automático falhou: {}", exc)
        return False


async def human_click_locator(page, locator) -> bool:
    try:
        await locator.scroll_into_view_if_needed()
    except Exception:
        pass

    try:
        box = await locator.bounding_box()
        if box:
            x = box["x"] + (box["width"] * random.uniform(0.35, 0.65))
            y = box["y"] + (box["height"] * random.uniform(0.35, 0.65))
            await page.mouse.move(x, y, steps=max(6, int(box["width"] // 20) or 6))
            await asyncio.sleep(random.uniform(0.10, 0.22))
            await page.mouse.down()
            await asyncio.sleep(random.uniform(0.07, 0.14))
            await page.mouse.up()
            await asyncio.sleep(random.uniform(0.12, 0.24))
            return True
    except Exception:
        pass

    try:
        await asyncio.sleep(random.uniform(0.10, 0.22))
        await locator.click(timeout=1800)
        await asyncio.sleep(random.uniform(0.12, 0.24))
        return True
    except Exception:
        return False


async def human_type_locator(page, locator, value: str) -> bool:
    try:
        await locator.scroll_into_view_if_needed()
    except Exception:
        pass

    try:
        await locator.click(timeout=1800)
        await asyncio.sleep(random.uniform(0.10, 0.20))
        await page.keyboard.press("Control+a")
        await asyncio.sleep(random.uniform(0.05, 0.10))
        await page.keyboard.press("Backspace")
        await asyncio.sleep(random.uniform(0.10, 0.18))

        for ch in value:
            await page.keyboard.type(ch)
            await asyncio.sleep(random.uniform(0.04, 0.10))

        await asyncio.sleep(random.uniform(0.16, 0.30))
        current = await locator.evaluate(
            """el => {
                if ('value' in el) return (el.value || '').trim();
                return (el.textContent || '').trim();
            }"""
        )
        return current == value
    except Exception:
        return False


async def mark_login_modal_targets(page) -> dict:
    try:
        return await page.evaluate(
            """() => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 20 && rect.height > 20;
                };

                for (const attr of [
                    'data-sheva-login-header',
                    'data-sheva-login-user',
                    'data-sheva-login-pass',
                    'data-sheva-login-submit',
                ]) {
                    document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
                }

                const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
                    .filter(visible);
                const headerBtn = buttons.find((el) => /^login$/i.test((el.textContent || '').trim()))
                    || buttons.find((el) => /^entrar$/i.test((el.textContent || '').trim()));
                if (headerBtn) {
                    headerBtn.setAttribute('data-sheva-login-header', 'true');
                }

                const password = Array.from(document.querySelectorAll('input[type="password"], input[name*="pass" i]'))
                    .find(visible);
                const user = Array.from(document.querySelectorAll(
                    'input[type="email"], input[name*="user" i], input[name*="login" i], input[type="text"]'
                )).find((el) => visible(el) && el !== password);

                if (!user || !password) {
                    return { header: !!headerBtn, user: false, password: false, submit: false };
                }

                user.setAttribute('data-sheva-login-user', 'true');
                password.setAttribute('data-sheva-login-pass', 'true');

                const pwRect = password.getBoundingClientRect();
                const submitCandidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
                    .filter(visible)
                    .map((el) => ({
                        el,
                        text: (el.textContent || '').trim(),
                        rect: el.getBoundingClientRect(),
                    }))
                    .filter((item) => /^login$/i.test(item.text) || /^entrar$/i.test(item.text))
                    .filter((item) => item.rect.top >= pwRect.bottom - 20)
                    .sort((a, b) =>
                        (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
                        || a.rect.top - b.rect.top
                    );

                const submitBtn = submitCandidates[0]?.el || null;
                if (submitBtn) {
                    submitBtn.setAttribute('data-sheva-login-submit', 'true');
                }

                return {
                    header: !!headerBtn,
                    user: true,
                    password: true,
                    submit: !!submitBtn,
                };
            }"""
        )
    except Exception:
        return {"header": False, "user": False, "password": False, "submit": False}


async def attempt_auto_login_modal(page, context, *, reason: str) -> bool:
    if not BET365_USER or not BET365_PASS:
        logger.warning("Relogin automático indisponível: BET365_USER/BET365_PASS não configurados")
        return False

    logger.warning("Tentando relogin automático no Bet365 | motivo={}", reason)

    try:
        await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded")
        await asyncio.sleep(3)
        await dismiss_popups(page)

        login_clicked = await page.evaluate(
            """() => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 20 && rect.height > 20;
                };

                const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
                    .filter(visible);
                const btn = buttons.find((el) => /^login$/i.test((el.textContent || '').trim()))
                    || buttons.find((el) => /^entrar$/i.test((el.textContent || '').trim()));
                if (!btn) return false;

                btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                btn.click();
                return true;
            }"""
        )
        if not login_clicked:
            logger.warning("Relogin automático: botão Login do header não encontrado")
            return False

        await asyncio.sleep(1.4)
        await dismiss_popups(page)

        modal_ready = False
        for _ in range(8):
            modal_ready = await page.evaluate(
                """() => {
                    const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 20 && rect.height > 20;
                    };
                    const password = Array.from(document.querySelectorAll('input[type="password"], input[name*="pass" i]'))
                        .find(visible);
                    return !!password;
                }"""
            )
            if modal_ready:
                break
            await asyncio.sleep(0.4)

        if not modal_ready:
            logger.warning("Relogin automático: modal de login não apareceu")
            return False

        filled = await page.evaluate(
            """(creds) => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 20 && rect.height > 20;
                };

                const password = Array.from(document.querySelectorAll('input[type="password"], input[name*="pass" i]'))
                    .find(visible);
                const user = Array.from(document.querySelectorAll(
                    'input[type="email"], input[name*="user" i], input[name*="login" i], input[type="text"]'
                )).find((el) => visible(el) && el !== password);

                if (!user || !password) return { ok: false };

                const setValue = (el, value) => {
                    el.focus();
                    el.value = '';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.value = value;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                };

                setValue(user, creds.user);
                setValue(password, creds.password);
                return { ok: true };
            }""",
            {"user": BET365_USER, "password": BET365_PASS},
        )
        if not filled.get("ok"):
            logger.warning("Relogin automático: campos de email/senha não encontrados")
            return False

        await asyncio.sleep(0.25)

        submitted = await page.evaluate(
            """() => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 20 && rect.height > 20;
                };

                const password = Array.from(document.querySelectorAll('input[type="password"], input[name*="pass" i]'))
                    .find(visible);
                if (!password) return false;

                const pwRect = password.getBoundingClientRect();
                const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
                    .filter(visible)
                    .map((el) => ({
                        el,
                        text: (el.textContent || '').trim(),
                        rect: el.getBoundingClientRect(),
                    }))
                    .filter((item) => /^login$/i.test(item.text) || /^entrar$/i.test(item.text))
                    .filter((item) => item.rect.top >= pwRect.bottom - 20)
                    .sort((a, b) =>
                        (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
                        || a.rect.top - b.rect.top
                    );

                const btn = (candidates[0] && candidates[0].el)
                    || Array.from(document.querySelectorAll('button, [role="button"]'))
                        .filter(visible)
                        .find((el) => {
                            const text = (el.textContent || '').trim();
                            const rect = el.getBoundingClientRect();
                            return (/^login$/i.test(text) || /^entrar$/i.test(text)) && rect.top > 80;
                        });
                if (!btn) return false;

                btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                btn.click();
                return true;
            }"""
        )
        if not submitted:
            logger.warning("Relogin automático: botão Login do modal não encontrado")
            return False

        await asyncio.sleep(5)
        await dismiss_popups(page)

        logged = False
        for _ in range(4):
            logged = await ensure_logged_in(page, context)
            if logged:
                break
            await asyncio.sleep(2)
            await dismiss_popups(page)

        if not logged:
            screenshot = await save_error_screenshot(
                page,
                {"selection_team": "auto_login", "line": 0},
                "auto_login_failed",
            )
            logger.warning("Relogin automático não confirmou sessão logada | screenshot={}", screenshot)
            return False

        await click_continue_after_login(page)
        await page.goto(FAVORITES_URL, wait_until="domcontentloaded")
        await asyncio.sleep(2)
        await click_continue_after_login(page, wait_for_appearance=False)
        await dismiss_popups(page)
        await save_cookies(context)
        logger.info("Relogin automático concluído com sucesso e favoritos restaurados")
        return True

    except Exception as exc:
        logger.warning("Relogin automático falhou: {}", exc)
        return False


async def attempt_auto_login_modal_humanized(page, context, *, reason: str) -> bool:
    if not BET365_USER or not BET365_PASS:
        logger.warning("Relogin automático indisponível: BET365_USER/BET365_PASS não configurados")
        return False

    logger.warning("Tentando relogin automático no Bet365 | motivo={}", reason)

    try:
        await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded")
        await asyncio.sleep(3)
        await dismiss_popups(page)

        targets = await mark_login_modal_targets(page)
        if not targets.get("header"):
            logger.warning("Relogin automático: botão Login do header não encontrado")
            return False

        logger.info("Relogin automático: header login com clique humanizado")
        if not await human_click_locator(page, page.locator('[data-sheva-login-header="true"]').first):
            logger.warning("Relogin automático: falha ao clicar no Login do header")
            return False

        await asyncio.sleep(random.uniform(1.2, 1.8))
        await dismiss_popups(page)

        modal_ready = False
        targets = {"user": False, "password": False, "submit": False}
        for _ in range(10):
            targets = await mark_login_modal_targets(page)
            if targets.get("user") and targets.get("password"):
                modal_ready = True
                break
            await asyncio.sleep(0.35)

        if not modal_ready:
            logger.warning("Relogin automático: modal de login não apareceu")
            return False

        logger.info("Relogin automático: preenchendo modal com digitação humanizada")
        user_field = page.locator('[data-sheva-login-user="true"]').first
        pass_field = page.locator('[data-sheva-login-pass="true"]').first

        email_ok = await human_type_locator(page, user_field, BET365_USER)
        await asyncio.sleep(random.uniform(0.25, 0.45))
        password_ok = await human_type_locator(page, pass_field, BET365_PASS)
        if not email_ok or not password_ok:
            logger.warning("Relogin automático: falha ao digitar email/senha no modal")
            return False

        await asyncio.sleep(random.uniform(0.35, 0.65))
        targets = await mark_login_modal_targets(page)
        if not targets.get("submit"):
            logger.warning("Relogin automático: botão Login do modal não encontrado")
            return False

        logger.info("Relogin automático: submit do modal com clique humanizado")
        if not await human_click_locator(page, page.locator('[data-sheva-login-submit="true"]').first):
            logger.warning("Relogin automático: falha ao clicar no Login do modal")
            return False

        await asyncio.sleep(5)
        await dismiss_popups(page)

        logged = False
        for _ in range(4):
            logged = await ensure_logged_in(page, context)
            if logged:
                break
            await asyncio.sleep(2)
            await dismiss_popups(page)

        if not logged:
            screenshot = await save_error_screenshot(
                page,
                {"selection_team": "auto_login", "line": 0},
                "auto_login_failed",
            )
            logger.warning("Relogin automático não confirmou sessão logada | screenshot={}", screenshot)
            return False

        await click_continue_after_login(page, wait_for_appearance=False)
        await page.goto(FAVORITES_URL, wait_until="domcontentloaded")
        await asyncio.sleep(2)
        await click_continue_after_login(page, wait_for_appearance=False)
        await dismiss_popups(page)
        await save_cookies(context)
        logger.info("Relogin automático concluído com sucesso e favoritos restaurados")
        return True

    except Exception as exc:
        logger.warning("Relogin automático falhou: {}", exc)
        return False


async def click_continue_after_login(page, wait_for_appearance: bool = True) -> bool:
    for _ in range(6):
        try:
            clicked = await page.evaluate(
                """() => {
                    const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 12 && rect.height > 12;
                    };

                    const overlays = Array.from(document.querySelectorAll('div, section, article, form'))
                        .filter(visible)
                        .filter((el) => {
                            const text = (el.textContent || '').toLowerCase();
                            return (
                                text.includes('ultimo login') ||
                                text.includes('último login') ||
                                text.includes('jogue com responsabilidade')
                            );
                        });

                    const root = overlays[0] || document;
                    const buttons = Array.from(root.querySelectorAll('button, [role="button"], div, span'))
                        .filter(visible)
                        .map((el) => ({
                            el,
                            text: (el.textContent || '').trim().toLowerCase(),
                            rect: el.getBoundingClientRect(),
                        }))
                        .filter((item) => item.text === 'continuar' || item.text === 'continue')
                        .sort((a, b) =>
                            (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
                        );

                    if (!buttons.length) return false;

                    const btn = buttons[0].el;
                    btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    btn.click();
                    return true;
                }"""
            )
            if clicked:
                logger.info("Modal pós-login fechado via botão Continuar")
                await asyncio.sleep(0.5)
                return True
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return False


async def click_continue_after_login(page) -> bool:
    for _ in range(8):
        try:
            marked = await page.evaluate(
                """() => {
                    const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 12 && rect.height > 12;
                    };

                    document
                        .querySelectorAll('[data-sheva-login-continue]')
                        .forEach((el) => el.removeAttribute('data-sheva-login-continue'));

                    const overlays = Array.from(document.querySelectorAll('div, section, article, form'))
                        .filter(visible)
                        .filter((el) => {
                            const text = (el.textContent || '').toLowerCase();
                            return (
                                text.includes('ultimo login') ||
                                text.includes('Ãºltimo login') ||
                                text.includes('jogue com responsabilidade')
                            );
                        });

                    const root = overlays[0] || document;
                    const buttons = Array.from(root.querySelectorAll('button, [role="button"], div, span'))
                        .filter(visible)
                        .map((el) => ({
                            el,
                            text: (el.textContent || '').trim().toLowerCase(),
                            rect: el.getBoundingClientRect(),
                        }))
                        .filter((item) => item.text === 'continuar' || item.text === 'continue')
                        .sort((a, b) =>
                            (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
                        );

                    if (!buttons.length) return false;
                    buttons[0].el.setAttribute('data-sheva-login-continue', 'true');
                    return true;
                }"""
            )
            if marked:
                logger.info("Modal pÃ³s-login: tentando Continuar com clique humanizado")
                clicked = await human_click_locator(
                    page,
                    page.locator('[data-sheva-login-continue=\"true\"]').first,
                )
                if clicked:
                    logger.info("Modal pÃ³s-login fechado via botÃ£o Continuar")
                    await asyncio.sleep(random.uniform(0.35, 0.70))
                    return True
        except Exception:
            pass
        await asyncio.sleep(0.6)
    return False


async def click_continue_after_login(page) -> bool:
    for attempt in range(12):
        try:
            candidate = await page.evaluate(
                """() => {
                    const normalize = (value) =>
                        (value || '')
                            .toLowerCase()
                            .normalize('NFD')
                            .replace(/[\\u0300-\\u036f]/g, '')
                            .replace(/\\s+/g, ' ')
                            .trim();

                    const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 20 && rect.height > 18;
                    };

                    const isModalRoot = (el) => {
                        const text = normalize(el.textContent);
                        return (
                            text.includes('login foi no dia') ||
                            text.includes('ultimo login') ||
                            text.includes('jogue com responsabilidade') ||
                            (text.includes('continuar') && text.includes('depositar'))
                        );
                    };

                    const roots = Array.from(document.querySelectorAll('div, section, article, form'))
                        .filter(visible)
                        .filter(isModalRoot)
                        .sort((a, b) => {
                            const ra = a.getBoundingClientRect();
                            const rb = b.getBoundingClientRect();
                            return (rb.width * rb.height) - (ra.width * ra.height);
                        });

                    const collectButtons = (root) =>
                        Array.from(root.querySelectorAll('button, [role="button"], a, div, span'))
                            .filter(visible)
                            .map((el) => {
                                const rect = el.getBoundingClientRect();
                                return {
                                    text: normalize(el.textContent),
                                    x: rect.x,
                                    y: rect.y,
                                    width: rect.width,
                                    height: rect.height,
                                };
                            })
                            .filter((item) =>
                                item.text === 'continuar' ||
                                item.text === 'continue' ||
                                item.text.startsWith('continuar ') ||
                                item.text.endsWith(' continuar')
                            )
                            .sort((a, b) => {
                                const areaDiff = (b.width * b.height) - (a.width * a.height);
                                if (areaDiff !== 0) return areaDiff;
                                return a.y - b.y;
                            });

                    const modalButtons = roots.length ? collectButtons(roots[0]) : [];
                    const fallbackButtons = modalButtons.length ? [] : collectButtons(document);
                    const best = modalButtons[0] || fallbackButtons[0];
                    if (!best) return null;

                    return {
                        x: best.x,
                        y: best.y,
                        width: best.width,
                        height: best.height,
                        text: best.text,
                    };
                }"""
            )
            if candidate:
                x = candidate["x"] + (candidate["width"] * random.uniform(0.35, 0.65))
                y = candidate["y"] + (candidate["height"] * random.uniform(0.35, 0.65))
                logger.info(
                    "Modal pós-login: Continuar encontrado na tentativa {} em ({:.0f}, {:.0f}) {}x{}",
                    attempt + 1,
                    candidate["x"],
                    candidate["y"],
                    round(candidate["width"]),
                    round(candidate["height"]),
                )
                await page.mouse.move(x, y, steps=max(8, int(candidate["width"] // 18) or 8))
                await asyncio.sleep(random.uniform(0.12, 0.22))
                await page.mouse.down()
                await asyncio.sleep(random.uniform(0.08, 0.16))
                await page.mouse.up()
                await asyncio.sleep(random.uniform(0.55, 0.90))

                still_visible = await page.evaluate(
                    """() => {
                        const normalize = (value) =>
                            (value || '')
                                .toLowerCase()
                                .normalize('NFD')
                                .replace(/[\\u0300-\\u036f]/g, '')
                                .replace(/\\s+/g, ' ')
                                .trim();
                        const text = normalize(document.body ? document.body.innerText : '');
                        const hasModal =
                            text.includes('login foi no dia') ||
                            text.includes('ultimo login') ||
                            (text.includes('continuar') && text.includes('jogue com responsabilidade'));
                        return hasModal;
                    }"""
                )
                if not still_visible:
                    logger.info("Modal pós-login fechado via botão Continuar")
                    return True
            else:
                logger.debug("Modal pós-login: botão Continuar ainda não apareceu (tentativa {})", attempt + 1)
        except Exception as exc:
            logger.debug("Modal pós-login: falha ao tentar clicar em Continuar: {}", exc)
        await asyncio.sleep(0.8)

    logger.debug("Modal pós-login: nenhum botão Continuar visível nesta checagem")
    return False


async def click_continue_after_login(page) -> bool:
    detect_js = """() => {
        const normalize = (value) =>
            (value || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\\u0300-\\u036f]/g, '')
                .replace(/\\s+/g, ' ')
                .trim();

        const visible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 20 && rect.height > 18;
        };

        const isModalRoot = (el) => {
            const text = normalize(el.textContent);
            return (
                text.includes('login foi no dia') ||
                text.includes('ultimo login') ||
                text.includes('jogue com responsabilidade') ||
                (text.includes('continuar') && text.includes('depositar'))
            );
        };

        const collectButtons = (root) =>
            Array.from(root.querySelectorAll('button, [role="button"], a, div, span'))
                .filter(visible)
                .map((el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        text: normalize(el.textContent),
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    };
                })
                .filter((item) =>
                    item.text === 'continuar' ||
                    item.text === 'continue' ||
                    item.text.startsWith('continuar ') ||
                    item.text.endsWith(' continuar')
                )
                .sort((a, b) => {
                    const areaDiff = (b.width * b.height) - (a.width * a.height);
                    if (areaDiff !== 0) return areaDiff;
                    return a.y - b.y;
                });

        const roots = Array.from(document.querySelectorAll('div, section, article, form'))
            .filter(visible)
            .filter(isModalRoot)
            .sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                return (rb.width * rb.height) - (ra.width * ra.height);
            });

        const modalButtons = roots.length ? collectButtons(roots[0]) : [];
        const fallbackButtons = modalButtons.length ? [] : collectButtons(document);
        const best = modalButtons[0] || fallbackButtons[0];
        return best || null;
    }"""

    clicked_once = False
    max_attempts = 12 if wait_for_appearance else 2
    retry_sleep = 0.8 if wait_for_appearance else 0.6

    for attempt in range(max_attempts):
        try:
            candidate = await page.evaluate(detect_js)
            if not candidate:
                if clicked_once:
                    logger.info("Modal pós-login fechado via botão Continuar")
                    return True
                logger.debug("Modal pós-login: botão Continuar ainda não apareceu (tentativa {})", attempt + 1)
                await asyncio.sleep(retry_sleep)
                continue

            logger.info(
                "Modal pós-login: Continuar encontrado na tentativa {} em ({:.0f}, {:.0f}) {}x{}",
                attempt + 1,
                candidate["x"],
                candidate["y"],
                round(candidate["width"]),
                round(candidate["height"]),
            )

            x = candidate["x"] + (candidate["width"] * random.uniform(0.35, 0.65))
            y = candidate["y"] + (candidate["height"] * random.uniform(0.35, 0.65))
            await page.mouse.move(x, y, steps=max(8, int(candidate["width"] // 18) or 8))
            await asyncio.sleep(random.uniform(0.12, 0.22))
            await page.mouse.down()
            await asyncio.sleep(random.uniform(0.08, 0.16))
            await page.mouse.up()
            clicked_once = True
            await asyncio.sleep(random.uniform(0.55, 0.90))

            candidate_after = await page.evaluate(detect_js)
            if not candidate_after:
                logger.info("Modal pós-login fechado via botão Continuar")
                return True
        except Exception as exc:
            logger.debug("Modal pós-login: falha ao tentar clicar em Continuar: {}", exc)
        await asyncio.sleep(retry_sleep)

    if clicked_once:
        logger.info("Modal pós-login: botão Continuar não reapareceu após clique; assumindo popup fechado")
        return True

    logger.debug("Modal pós-login: nenhum botão Continuar visível nesta checagem")
    return False


async def click_continue_after_login(page, wait_for_appearance: bool = True) -> bool:
    detect_js = """() => {
        const normalize = (value) =>
            (value || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\\u0300-\\u036f]/g, '')
                .replace(/\\s+/g, ' ')
                .trim();

        const visible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 20 && rect.height > 18;
        };

        const isModalRoot = (el) => {
            const text = normalize(el.textContent);
            return (
                text.includes('login foi no dia') ||
                text.includes('ultimo login') ||
                text.includes('jogue com responsabilidade') ||
                (text.includes('continuar') && text.includes('depositar'))
            );
        };

        const collectButtons = (root) =>
            Array.from(root.querySelectorAll('button, [role="button"], a, div, span'))
                .filter(visible)
                .map((el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        text: normalize(el.textContent),
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    };
                })
                .filter((item) =>
                    item.text === 'continuar' ||
                    item.text === 'continue' ||
                    item.text.startsWith('continuar ') ||
                    item.text.endsWith(' continuar')
                )
                .sort((a, b) => {
                    const areaDiff = (b.width * b.height) - (a.width * a.height);
                    if (areaDiff !== 0) return areaDiff;
                    return a.y - b.y;
                });

        const roots = Array.from(document.querySelectorAll('div, section, article, form'))
            .filter(visible)
            .filter(isModalRoot)
            .sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                return (rb.width * rb.height) - (ra.width * ra.height);
            });

        const modalButtons = roots.length ? collectButtons(roots[0]) : [];
        const fallbackButtons = modalButtons.length ? [] : collectButtons(document);
        const best = modalButtons[0] || fallbackButtons[0];
        return best || null;
    }"""

    clicked_once = False
    max_attempts = 12 if wait_for_appearance else 2
    retry_sleep = 0.8 if wait_for_appearance else 0.6

    for attempt in range(max_attempts):
        try:
            candidate = await page.evaluate(detect_js)
            if not candidate:
                if clicked_once:
                    logger.info("Modal pós-login fechado via botão Continuar")
                    return True
                logger.debug("Modal pós-login: botão Continuar ainda não apareceu (tentativa {})", attempt + 1)
                await asyncio.sleep(retry_sleep)
                continue

            logger.info(
                "Modal pós-login: Continuar encontrado na tentativa {} em ({:.0f}, {:.0f}) {}x{}",
                attempt + 1,
                candidate["x"],
                candidate["y"],
                round(candidate["width"]),
                round(candidate["height"]),
            )

            x = candidate["x"] + (candidate["width"] * random.uniform(0.35, 0.65))
            y = candidate["y"] + (candidate["height"] * random.uniform(0.35, 0.65))
            await page.mouse.move(x, y, steps=max(8, int(candidate["width"] // 18) or 8))
            await asyncio.sleep(random.uniform(0.12, 0.22))
            await page.mouse.down()
            await asyncio.sleep(random.uniform(0.08, 0.16))
            await page.mouse.up()
            clicked_once = True
            await asyncio.sleep(random.uniform(0.55, 0.90))

            candidate_after = await page.evaluate(detect_js)
            if not candidate_after:
                logger.info("Modal pós-login fechado via botão Continuar")
                return True
        except Exception as exc:
            logger.debug("Modal pós-login: falha ao tentar clicar em Continuar: {}", exc)
        await asyncio.sleep(retry_sleep)

    if clicked_once:
        logger.info("Modal pós-login: botão Continuar não reapareceu após clique; assumindo popup fechado")
        return True

    logger.debug("Modal pós-login: nenhum botão Continuar visível nesta checagem")
    return False


async def session_guard(page, context, processing_lock: asyncio.Lock, placer: BetPlacer, stake: float) -> None:
    logged_out_alerted = False
    weird_count = 0
    last_auto_login_attempt = 0.0

    while True:
        try:
            if processing_lock.locked():
                await asyncio.sleep(SESSION_GUARD_SEC)
                continue

            await dismiss_popups(page)
            state = await inspect_page_runtime(page)
            logged_now = state.get("logged_in", False) or await is_logged_in(page)

            if not logged_now:
                if not logged_out_alerted:
                    logger.error(
                        "ALERTA: sessao do Bet365 aparenta ter saído da conta | url={} readyState={}",
                        state.get("url", ""),
                        state.get("readyState", ""),
                    )
                    logger.error("Acao necessaria: refazer login manual se a tela continuar deslogada")
                    logged_out_alerted = True
                now = time.time()
                if now - last_auto_login_attempt >= AUTO_LOGIN_RETRY_SEC:
                    last_auto_login_attempt = now
                    relogged = await attempt_auto_login_modal_humanized(
                        page, context, reason="session_guard_logout"
                    )
                    if relogged:
                        async with processing_lock:
                            continued = await click_continue_after_login(page, wait_for_appearance=False)
                            if not continued:
                                logger.warning("Guarda de sessão: modal Continuar ainda aberto antes do warmup")
                            await warmup_betslip_robust(page, placer, stake)
                            logger.info("Sessao recuperada automaticamente pela guarda e warmup reaplicado")
                        logged_out_alerted = False
                        weird_count = 0
                        await asyncio.sleep(SESSION_GUARD_SEC)
                        continue
                weird_count = 0
                await asyncio.sleep(SESSION_GUARD_SEC)
                continue

            if logged_out_alerted:
                logger.info("Sessao do Bet365 voltou a responder como logada")
                try:
                    await save_cookies(context)
                except Exception:
                    pass
                logged_out_alerted = False

            if state.get("looks_weird"):
                weird_count += 1
                logger.warning(
                    "Pagina em estado estranho detectada ({}/{}): url={} favorites={} market={} betslip={} overlay={}",
                    weird_count,
                    WEIRD_PAGE_THRESHOLD,
                    state.get("url", ""),
                    state.get("onFavorites"),
                    state.get("hasMarket"),
                    state.get("hasBetslip"),
                    state.get("weirdOverlay"),
                )
                if weird_count >= WEIRD_PAGE_THRESHOLD:
                    logger.warning("Reload automatico para favoritos acionado por estado estranho da pagina")
                    await reset_page_to_favorites(page)
                    weird_count = 0
                    try:
                        await save_cookies(context)
                    except Exception:
                        pass
            else:
                weird_count = 0

        except Exception as exc:
            logger.warning("Falha na guarda de sessao: {}", exc)

        await asyncio.sleep(SESSION_GUARD_SEC)


async def click_neutral_browser_area(page) -> bool:
    try:
        point = await page.evaluate(
            """() => {
                const isSafe = (el) => {
                    let cur = el;
                    while (cur) {
                        const tag = (cur.tagName || '').toLowerCase();
                        const cls = String(cur.className || '');
                        if (['button', 'a', 'input', 'textarea', 'select'].includes(tag)) return false;
                        if (/(Odds|Participant|Market|Stake|PlaceBet|Receipt|Delete|Remove|Done|Button|Link)/i.test(cls)) {
                            return false;
                        }
                        cur = cur.parentElement;
                    }
                    return true;
                };

                const receipt = Array.from(document.querySelectorAll(
                    '.bs-Receipt, .bsf-ReceiptContent, .bss-ReceiptContent, .bss-StandardBetslip'
                )).find((el) => {
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 60 && rect.height > 60;
                });

                const points = [];
                if (receipt) {
                    const rect = receipt.getBoundingClientRect();
                    points.push(
                        { x: Math.max(40, rect.left - 80), y: Math.max(140, rect.top - 40) },
                        { x: Math.max(40, rect.left - 40), y: Math.min(window.innerHeight - 40, rect.bottom + 30) }
                    );
                }

                points.push(
                    { x: 40, y: 160 },
                    { x: 80, y: Math.max(220, window.innerHeight - 140) },
                    { x: Math.max(100, Math.round(window.innerWidth * 0.2)), y: 160 }
                );

                for (const point of points) {
                    const x = Math.min(window.innerWidth - 10, Math.max(10, Math.round(point.x)));
                    const y = Math.min(window.innerHeight - 10, Math.max(10, Math.round(point.y)));
                    const el = document.elementFromPoint(x, y);
                    if (isSafe(el)) {
                        return { x, y, tag: el ? el.tagName : '', cls: String(el?.className || '') };
                    }
                }

                return { x: 40, y: 160, tag: '', cls: '' };
            }"""
        )
        await page.mouse.click(point["x"], point["y"])
        logger.info(
            "Clique neutro pÃ³s-aposta em ({}, {}) tag={} cls={}",
            point["x"],
            point["y"],
            point.get("tag", ""),
            point.get("cls", ""),
        )
        return True
    except Exception as exc:
        logger.warning("Falha no clique neutro pÃ³s-aposta: {}", exc)
        return False


async def install_manual_reload_shortcut(page) -> None:
    script = f"""
        (() => {{
            const url = {FAVORITES_URL!r};
            if (window.__shevaReloadInstalled) return;
            window.__shevaReloadInstalled = true;

            const go = () => {{
                window.location.href = url;
            }};
            window.__shevaReloadFavorites = go;

            window.addEventListener('keydown', (event) => {{
                const isF8 = event.key === 'F8';
                const isCombo = event.altKey && event.shiftKey && event.key.toLowerCase() === 'r';
                if (!isF8 && !isCombo) return;
                event.preventDefault();
                event.stopPropagation();
                go();
            }}, true);
        }})();
    """
    try:
        await page.add_init_script(script)
        await page.evaluate(script)
        logger.info("Atalho manual de reload instalado: F8 ou Alt+Shift+R")
    except Exception as exc:
        logger.warning("Falha ao instalar atalho manual de reload: {}", exc)


async def ensure_remember_stake_active(page) -> bool:
    try:
        state = await page.evaluate(
            """() => {
                const root = document.querySelector('.bsf-RememberStakeButtonNonTouch');
                if (!root || !root.offsetParent) return { found: false, active: false };
                return {
                    found: true,
                    active: root.className.includes('bsf-RememberStakeButtonNonTouch-active'),
                };
            }"""
        )
    except Exception:
        return False

    if not state.get("found"):
        return False
    if state.get("active"):
        return True

    try:
        await page.locator(".bsf-RememberStakeButtonNonTouch_HitArea").first.click(
            timeout=800
        )
        await asyncio.sleep(MIN_INTERACTION_DELAY_SEC)
        confirmed = await page.evaluate(
            """() => {
                const root = document.querySelector('.bsf-RememberStakeButtonNonTouch');
                return !!(root && root.className.includes('bsf-RememberStakeButtonNonTouch-active'));
            }"""
        )
        if confirmed:
            logger.info("Toggle 'Lembrar' ativado no betslip")
        return bool(confirmed)
    except Exception:
        return False


async def ensure_remember_stake_active_robust(page) -> bool:
    async def read_state() -> dict:
        try:
            return await page.evaluate(
                """() => {
                    const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 8 && rect.height > 8;
                    };

                    const root = Array.from(document.querySelectorAll('.bsf-RememberStakeButtonNonTouch'))
                        .find(visible);
                    if (!root) return { found: false, active: false };
                    return {
                        found: true,
                        active: root.className.includes('bsf-RememberStakeButtonNonTouch-active'),
                    };
                }"""
            )
        except Exception:
            return {"found": False, "active": False}

    state = await read_state()
    if not state.get("found"):
        return False
    if state.get("active"):
        return True

    selectors = [
        ".bsf-RememberStakeButtonNonTouch_HitArea",
        ".bsf-RememberStakeButtonNonTouch",
    ]

    for selector in selectors:
        try:
            await page.locator(selector).first.click(timeout=500, force=True)
            await asyncio.sleep(MIN_INTERACTION_DELAY_SEC)
            if (await read_state()).get("active"):
                logger.info("Toggle 'Lembrar' ativado no betslip")
                return True
        except Exception:
            pass

        try:
            clicked = await page.evaluate(
                """(sel) => {
                    const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 8 && rect.height > 8;
                    };

                    const el = Array.from(document.querySelectorAll(sel)).find(visible);
                    if (!el) return false;
                    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    el.click();
                    return true;
                }""",
                selector,
            )
            if clicked:
                await asyncio.sleep(MIN_INTERACTION_DELAY_SEC)
                if (await read_state()).get("active"):
                    logger.info("Toggle 'Lembrar' ativado no betslip")
                    return True
        except Exception:
            pass

    return False


async def click_any_warmup_selection(page) -> bool:
    try:
        clicked = await page.evaluate(
            """() => {
                const visible = (el) => {
                    if (!el || !el.offsetParent) return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 40 && r.height > 18;
                };

                const nodes = Array.from(document.querySelectorAll(
                    '.gl-Participant_General, .ovm-ParticipantStackedCentered, .srb-ParticipantLabelWithOdds'
                ))
                    .filter(visible)
                    .filter((el) => !/Suspended|Locked/i.test(el.className));

                for (const el of nodes) {
                    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
                    if (!/[+-]\\d+(?:[.,]\\d+)?/.test(text)) continue;
                    if (!/\\d+[.,]\\d+/.test(text)) continue;
                    el.click();
                    return true;
                }
                return false;
            }"""
        )
        return bool(clicked)
    except Exception:
        return False


async def fast_fill_stake(page, stake: float) -> bool:
    """Preenche stake com menos delay que o fluxo padrão."""
    try:
        loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
        await loc.wait_for(state="attached", timeout=3000)
    except Exception:
        loc = page.locator('[class*="StakeBox"] [contenteditable="true"]').first
        try:
            await loc.wait_for(state="attached", timeout=2000)
        except Exception:
            return False

    stake_value = f"{stake:.2f}"

    async def current_value() -> str:
        try:
            text = await loc.text_content()
        except Exception:
            return ""
        return re.sub(r"\s+", "", text or "").replace(",", ".")

    async def is_expected_value() -> bool:
        text = await current_value()
        return text in {stake_value, stake_value.rstrip("0").rstrip(".")}

    await ensure_remember_stake_active_robust(page)
    await asyncio.sleep(MIN_INTERACTION_DELAY_SEC)

    try:
        await loc.fill(stake_value, timeout=700)
        await asyncio.sleep(0.08)
        if await is_expected_value():
            return True
    except Exception:
        pass

    try:
        await loc.click(timeout=800)
    except Exception:
        await loc.evaluate("el => { el.focus(); el.click(); }")

    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.insert_text(stake_value)
    await asyncio.sleep(0.08)
    if await is_expected_value():
        return True

    try:
        await loc.evaluate(
            """(el, value) => {
                el.focus();
                el.textContent = '';
                const inserted = document.execCommand('insertText', false, value);
                if (!inserted) {
                    el.textContent = value;
                }
                el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.blur();
            }""",
            stake_value,
        )
    except Exception:
        return False

    await asyncio.sleep(0.08)
    return await is_expected_value()


async def warmup_betslip(page, placer: BetPlacer, stake: float) -> None:
    try:
        await dismiss_popups(page)
        await click_continue_after_login(page, wait_for_appearance=False)
        if not await click_any_warmup_selection(page):
            logger.warning("Warmup: nenhuma seleção ativa encontrada para preparar stake")
            return

        await asyncio.sleep(0.5)
        remember_ok = await ensure_remember_stake_active(page)
        stake_ok = await fast_fill_stake(page, stake)

        logger.info(
            "Warmup betslip concluído: remember={} stake_ok={} stake={:.2f}",
            remember_ok,
            stake_ok,
            stake,
        )
    except Exception as exc:
        logger.warning("Warmup do betslip falhou: {}", exc)
    finally:
        await placer.close_betslip_fast(page)
        await dismiss_popups(page)
        await reset_page_to_favorites(page)


async def warmup_betslip_robust(page, placer: BetPlacer, stake: float) -> None:
    remember_ok = False
    stake_ok = False
    try:
        await dismiss_popups(page)
        await click_continue_after_login(page, wait_for_appearance=False)
        if not await wait_for_favorites_market(page, timeout_sec=10.0):
            logger.warning("Warmup: grade de favoritos ainda nao carregou totalmente; resetando antes do preparo")
            await reset_page_to_favorites(page)
            await wait_for_favorites_market(page, timeout_sec=6.0)
        for attempt in range(1, 4):
            if not await click_any_warmup_selection(page):
                logger.warning(
                    "Warmup tentativa {}: nenhuma selecao ativa encontrada para preparar stake",
                    attempt,
                )
                await reset_page_to_favorites(page)
                await wait_for_favorites_market(page, timeout_sec=4.0)
                await asyncio.sleep(1.0)
                await dismiss_popups(page)
                continue

            await asyncio.sleep(0.35)
            remember_ok = await ensure_remember_stake_active_robust(page)
            stake_ok = await fast_fill_stake(page, stake)
            remember_ok = remember_ok or await ensure_remember_stake_active_robust(page)

            logger.info(
                "Warmup tentativa {}: remember={} stake_ok={} stake={:.2f}",
                attempt,
                remember_ok,
                stake_ok,
                stake,
            )

            if remember_ok and stake_ok:
                logger.info(
                    "Warmup betslip concluido: remember={} stake_ok={} stake={:.2f}",
                    remember_ok,
                    stake_ok,
                    stake,
                )
                break

            await placer.close_betslip_fast(page)
            await asyncio.sleep(0.25)
            await dismiss_popups(page)

        if not (remember_ok and stake_ok):
            logger.warning(
                "Warmup incompleto: remember={} stake_ok={} stake={:.2f}",
                remember_ok,
                stake_ok,
                stake,
            )
    except Exception as exc:
        logger.warning("Warmup robusto do betslip falhou: {}", exc)
    finally:
        await placer.close_betslip_fast(page)
        await dismiss_popups(page)
        await reset_page_to_favorites(page)


async def is_place_bet_ready(page) -> bool:
    try:
        diag = await page.evaluate(
            """() => {
                const btn = document.querySelector('.bsf-PlaceBetButton');
                const stake = document.querySelector('.bsf-StakeBox_StakeValue-input');
                return {
                    btnClass: btn ? btn.className : '',
                    stakeText: stake ? (stake.textContent || '').trim() : '',
                };
            }"""
        )
    except Exception:
        return False

    btn_class = diag.get("btnClass", "")
    stake_text = re.sub(r"\s+", "", diag.get("stakeText", "")).replace(",", ".")
    if not stake_text:
        return False
    return "Disabled" not in btn_class and "Hidden" not in btn_class


async def mark_live_handicap_target(page, signal: dict) -> dict | None:
    """Marca no DOM o handicap correto da tela atual para o Playwright clicar."""
    return await page.evaluate(
        r"""(params) => {
            const normalize = (value) =>
                (value || "")
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

            const isVisible = (el) => {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 4 && rect.height > 4;
            };

            const textOf = (el) => (el?.innerText || el?.textContent || "").trim();

            const signedLineRegex = /([+-]\d+(?:[.,]\d+)?)/;
            const oddRegex = /(\d+[.,]\d+)/g;

            const targetLine = Number(params.line);
            const targetOdd = params.odd ?? null;
            const maxLineDrop = Number(params.maxLineDrop ?? 0);
            const selectionTeam = normalize(params.selectionTeam);
            const participants = (params.participants || []).map(normalize).filter(Boolean);

            document.querySelectorAll("[data-sheva-target]").forEach((el) => {
                el.removeAttribute("data-sheva-target");
            });

            const candidateSelectors = [
                ".srb-ParticipantCenteredStackedMarketRow",
                ".gl-Participant_General",
                '[class*="hashandicap"]',
            ];

            const rawCandidates = [];
            for (const selector of candidateSelectors) {
                document.querySelectorAll(selector).forEach((el) => rawCandidates.push(el));
            }

            const seen = new Set();
            const candidates = [];

            for (const el of rawCandidates) {
                if (!el || seen.has(el) || !isVisible(el)) continue;
                seen.add(el);

                const text = textOf(el);
                if (!text) continue;

                const lineMatch = text.match(signedLineRegex);
                if (!lineMatch) continue;

                const oddMatches = [...text.matchAll(oddRegex)];
                if (!oddMatches.length) continue;

                const lineVal = Number(lineMatch[1].replace(",", "."));
                if (Number.isNaN(lineVal)) continue;

                const lineDelta = lineVal - targetLine;
                if (lineDelta < 0 && Math.abs(lineDelta) - maxLineDrop > 0.05) continue;

                let oddVal = null;
                for (let i = oddMatches.length - 1; i >= 0; i--) {
                    const parsed = Number(oddMatches[i][1].replace(",", "."));
                    if (!Number.isNaN(parsed) && parsed >= 1.01) {
                        oddVal = parsed;
                        break;
                    }
                }
                if (oddVal === null) continue;

                let matchContainer = null;
                let probe = el;
                for (let depth = 0; depth < 12; depth++) {
                    probe = probe.parentElement;
                    if (!probe) break;
                    const probeText = normalize(textOf(probe));
                    if (participants.every((part) => probeText.includes(part))) {
                        matchContainer = probe;
                        break;
                    }
                }
                if (!matchContainer) continue;

                const selectionRect = el.getBoundingClientRect();
                const selectionY = selectionRect.top + selectionRect.height / 2;

                const participantHits = [];
                matchContainer.querySelectorAll("*").forEach((node) => {
                    if (!isVisible(node)) return;
                    const nodeText = normalize(textOf(node));
                    if (!nodeText) return;
                    if (nodeText.length > 80) return;

                    const rect = node.getBoundingClientRect();
                    if (rect.height > 40) return;
                    if (participants.every((part) => nodeText.includes(part))) return;

                    for (const part of participants) {
                        if (nodeText.includes(part)) {
                            participantHits.push({
                                participant: part,
                                text: textOf(node),
                                y: rect.top + rect.height / 2,
                            });
                        }
                    }
                });

                if (!participantHits.length) continue;

                participantHits.sort(
                    (a, b) => Math.abs(a.y - selectionY) - Math.abs(b.y - selectionY)
                );
                const owner = participantHits[0];
                if (owner.participant !== selectionTeam) continue;

                candidates.push({
                    el,
                    oddVal,
                    lineVal,
                    lineDelta,
                    owner: owner.text,
                    selectionText: text,
                    matchText: textOf(matchContainer).slice(0, 240),
                    lineDirectionPenalty: lineDelta >= 0 ? 0 : 1,
                    lineDistance: Math.abs(lineDelta),
                    oddDiff: targetOdd === null ? 0 : Math.abs(oddVal - Number(targetOdd)),
                });
            }

            if (!candidates.length) {
                return {
                    found: false,
                    reason: "Nenhum handicap correspondente encontrado na página atual",
                    selectionTeam,
                    participants,
                    targetLine,
                    targetOdd,
                };
            }

            candidates.sort((a, b) =>
                a.lineDirectionPenalty - b.lineDirectionPenalty ||
                a.lineDistance - b.lineDistance ||
                a.oddDiff - b.oddDiff
            );
            const chosen = candidates[0];
            chosen.el.setAttribute("data-sheva-target", "true");

            return {
                found: true,
                odd: chosen.oddVal,
                line: chosen.lineVal,
                lineDelta: chosen.lineDelta,
                owner: chosen.owner,
                selectionText: chosen.selectionText,
                matchText: chosen.matchText,
                candidates: candidates.length,
            };
        }""",
        {
            "selectionTeam": signal["selection_team"],
            "participants": signal["participants"],
            "line": signal["line"],
            "odd": signal["odd"],
            "maxLineDrop": MAX_LINE_DROP,
        },
    )


async def place_signal_on_current_page(page, placer: BetPlacer, stake: float, signal: dict) -> dict:
    t0 = time.perf_counter()
    timings: dict[str, float] = {}
    result = {
        "status": "error",
        "odd": 0.0,
        "line": signal["line"],
        "line_delta": 0.0,
        "time": 0.0,
        "msg": "",
        "screenshot": "",
        "timings": timings,
    }

    step_t0 = time.perf_counter()
    await dismiss_popups(page)
    timings["dismiss_popups"] = round(time.perf_counter() - step_t0, 3)

    step_t0 = time.perf_counter()
    await page.wait_for_selector(".gl-Participant_General", timeout=10000)
    timings["wait_market"] = round(time.perf_counter() - step_t0, 3)

    step_t0 = time.perf_counter()
    marked = await mark_live_handicap_target(page, signal)
    timings["mark_target"] = round(time.perf_counter() - step_t0, 3)
    if not marked or not marked.get("found"):
        result["msg"] = (
            marked.get("reason")
            if isinstance(marked, dict)
            else "Falha ao localizar handicap na tela atual"
        )
        result["time"] = time.perf_counter() - t0
        step_t0 = time.perf_counter()
        result["screenshot"] = await save_error_screenshot(page, signal, "target_not_found")
        timings["error_capture"] = round(time.perf_counter() - step_t0, 3)
        timings["total"] = round(time.perf_counter() - t0, 3)
        return result

    page_odd = float(marked["odd"])
    result["odd"] = page_odd
    result["line"] = float(marked["line"])
    result["line_delta"] = float(marked.get("lineDelta", 0.0))

    drop = signal["odd"] - page_odd
    if drop > MAX_ODD_DROP:
        await page.evaluate(
            """() => document.querySelector('[data-sheva-target="true"]')?.removeAttribute('data-sheva-target')"""
        )
        result["msg"] = (
            f"Odd desvalorizada: {signal['odd']:.2f} -> {page_odd:.2f} (queda {drop:.2f})"
        )
        result["time"] = time.perf_counter() - t0
        step_t0 = time.perf_counter()
        result["screenshot"] = await save_error_screenshot(page, signal, "odd_drop")
        timings["error_capture"] = round(time.perf_counter() - step_t0, 3)
        timings["total"] = round(time.perf_counter() - t0, 3)
        return result

    target_el = page.locator('[data-sheva-target="true"]').first
    step_t0 = time.perf_counter()
    try:
        await target_el.click(timeout=1200, force=True)
    except Exception as exc:
        timings["target_click"] = round(time.perf_counter() - step_t0, 3)
        result["msg"] = f"Falha ao clicar no handicap alvo: {exc}"
        result["time"] = time.perf_counter() - t0
        step_t0 = time.perf_counter()
        result["screenshot"] = await save_error_screenshot(page, signal, "target_click")
        timings["error_capture"] = round(time.perf_counter() - step_t0, 3)
        timings["total"] = round(time.perf_counter() - t0, 3)
        return result
    timings["target_click"] = round(time.perf_counter() - step_t0, 3)
    await asyncio.sleep(MIN_INTERACTION_DELAY_SEC)

    await page.evaluate(
        """() => document.querySelector('[data-sheva-target="true"]')?.removeAttribute('data-sheva-target')"""
    )

    step_t0 = time.perf_counter()
    if not await fast_fill_stake(page, stake):
        timings["fill_stake"] = round(time.perf_counter() - step_t0, 3)
        result["msg"] = "Falha ao preencher stake"
        result["time"] = time.perf_counter() - t0
        step_t0 = time.perf_counter()
        result["screenshot"] = await save_error_screenshot(page, signal, "stake_fill")
        timings["error_capture"] = round(time.perf_counter() - step_t0, 3)
        timings["total"] = round(time.perf_counter() - t0, 3)
        return result
    timings["fill_stake"] = round(time.perf_counter() - step_t0, 3)
    await asyncio.sleep(MIN_INTERACTION_DELAY_SEC)

    step_t0 = time.perf_counter()
    if not await is_place_bet_ready(page):
        timings["precheck_betslip"] = round(time.perf_counter() - step_t0, 3)
        result["msg"] = "Betslip nao habilitou depois de preencher stake"
        result["time"] = time.perf_counter() - t0
        step_t0 = time.perf_counter()
        result["screenshot"] = await save_error_screenshot(page, signal, "betslip_not_ready")
        timings["error_capture"] = round(time.perf_counter() - step_t0, 3)
        timings["total"] = round(time.perf_counter() - t0, 3)
        return result
    timings["precheck_betslip"] = round(time.perf_counter() - step_t0, 3)

    step_t0 = time.perf_counter()
    bet_status = await placer.place_bet(page)
    timings["place_bet"] = round(time.perf_counter() - step_t0, 3)
    result["time"] = time.perf_counter() - t0
    timings["total"] = round(result["time"], 3)

    if bet_status == BetStatus.ACCEPTED:
        result["status"] = "accepted"
        return result

    if bet_status == BetStatus.REJECTED:
        result["status"] = "rejected"
        result["msg"] = "Bet365 rejeitou a aposta"
        step_t0 = time.perf_counter()
        result["screenshot"] = await save_error_screenshot(page, signal, "bet_rejected")
        timings["error_capture"] = round(time.perf_counter() - step_t0, 3)
        timings["total"] = round(time.perf_counter() - t0, 3)
        return result

    result["msg"] = f"Status final: {bet_status.value}"
    step_t0 = time.perf_counter()
    result["screenshot"] = await save_error_screenshot(page, signal, f"bet_{bet_status.value}")
    timings["error_capture"] = round(time.perf_counter() - step_t0, 3)
    timings["total"] = round(time.perf_counter() - t0, 3)
    return result


async def list_groups(client: TelegramClient) -> int:
    print("\nSeus grupos/canais:")
    print("-" * 50)
    async for dialog in client.iter_dialogs():
        if dialog.is_group or dialog.is_channel:
            print(f"  ID: {dialog.id:>15}  |  {dialog.name}")
    print("-" * 50)
    return int(input("group_id: ").strip())


async def setup_browser(engine: BrowserEngine):
    context_manager = engine.launch()
    context = await context_manager.__aenter__()

    await load_cookies(context)
    page = await engine.new_page(context)

    await page.route(
        "**/*.{png,jpg,jpeg,gif,svg,webp,ico,woff,woff2,ttf,eot}",
        lambda route: route.abort(),
    )
    await page.route(
        "**/{analytics,tracking,beacon,pixel,telemetry,ads,doubleclick,googletag}**",
        lambda route: route.abort(),
    )
    await install_manual_reload_shortcut(page)

    await page.goto(FAVORITES_URL, wait_until="domcontentloaded")
    await asyncio.sleep(4)
    await dismiss_popups(page)

    logged = await ensure_logged_in(page, context)
    if not logged:
        logged = await attempt_auto_login_modal_humanized(
            page, context, reason="startup_cookie_expired"
        )
        if not logged:
            await page.close()
            await context_manager.__aexit__(None, None, None)
            return None, None, None

    if "/#/IP/FAV" not in page.url:
        await page.goto(FAVORITES_URL, wait_until="domcontentloaded")
        await asyncio.sleep(2)
        await dismiss_popups(page)

    logger.info("Página inicial fixada em favoritos: {}", FAVORITES_URL)
    return context_manager, context, page


async def main() -> None:
    settings = get_settings()
    stake = settings.autobet.default_stake
    browser_settings = replace(settings.browser, humanize=False)
    engine = BrowserEngine(browser_settings)
    placer = BetPlacer(engine)

    cfg = load_config()
    if not cfg.get("api_id") or not cfg.get("api_hash"):
        print("Config do Telegram não encontrada em .telegram_config.json")
        return

    client = TelegramClient(str(SESSION_FILE), cfg["api_id"], cfg["api_hash"])
    await client.start()

    group_ids = cfg.get("group_ids") or []
    if not group_ids:
        gid = await list_groups(client)
        group_ids = [gid]

    entities = []
    for gid in group_ids:
        try:
            entities.append(await client.get_entity(gid))
        except Exception as exc:
            logger.warning("Grupo {} não encontrado: {}", gid, exc)

    if not entities:
        print("Nenhum grupo válido configurado.")
        await client.disconnect()
        return

    setup = await setup_browser(engine)
    if setup == (None, None, None):
        print("Não logado. Rode python scripts/manual_login.py e depois tente novamente.")
        await client.disconnect()
        return

    context_manager, context, page = setup
    logger.info("Startup: iniciando warmup inicial do betslip")
    await warmup_betslip_robust(page, placer, stake)
    logger.info("Startup: warmup inicial concluido")

    processed_ids: set[int] = set()
    message_signatures: dict[int, tuple] = {}
    processing_lock = asyncio.Lock()
    keepalive_task = asyncio.create_task(keep_current_page_alive(page))
    session_guard_task = asyncio.create_task(
        session_guard(page, context, processing_lock, placer, stake)
    )
    group_names = ", ".join(getattr(entity, "title", str(entity.id)) for entity in entities)

    print("=" * 60)
    print("  TELEGRAM LIVE PAGE BETTER")
    print(f"  Stake: R${stake:.2f}")
    print(f"  Grupos: {group_names}")
    print("  Deixe a tela de handicap ao vivo aberta no browser.")
    print("=" * 60)

    async def handle_message(event, is_edit: bool = False) -> None:
        text = event.raw_text or ""
        if not text:
            return

        signal = parse_signal(text)
        if not signal:
            return

        message_id = int(event.message.id)
        if message_id in processed_ids and not is_edit:
            return
        processed_ids.add(message_id)

        sig_key = signal_signature(signal)
        previous_signature = message_signatures.get(message_id)
        if is_edit and previous_signature == sig_key:
            logger.info(
                "Edicao sem mudanca ignorada: team={} line={} odd={} participants={}",
                signal["selection_team"],
                signal["line"],
                signal["odd"],
                signal["participants"],
            )
            return
        message_signatures[message_id] = sig_key

        logger.info(
            "Sinal recebido: team={} line={} odd={} participants={}",
            signal["selection_team"],
            signal["line"],
            signal["odd"],
            signal["participants"],
        )

        if processing_lock.locked():
            logger.warning(
                "Outro sinal ainda esta em andamento; aguardando fila para {} {}",
                signal["selection_team"],
                signal["line"],
            )

        async with processing_lock:
            try:
                result = await place_signal_on_current_page(page, placer, stake, signal)
                if result["status"] == "accepted":
                    await asyncio.sleep(POST_ACCEPT_CLEAR_DELAY_SEC)
                    await placer.close_betslip_fast(page)
                    await click_neutral_browser_area(page)
                    await dismiss_popups(page)
                    logger.info(
                        "APOSTA ACEITA: {} sinal={} exec={} @ {:.2f} em {:.1f}s | tempos={}",
                        signal["selection_team"],
                        signal["line"],
                        result["line"],
                        result["odd"],
                        result["time"],
                        result["timings"],
                    )
                    logger.info(
                        "Cooldown pós-aposta de {:.1f}s antes do próximo sinal",
                        POST_BET_COOLDOWN_SEC,
                    )
                    await asyncio.sleep(POST_BET_COOLDOWN_SEC)
                else:
                    if result.get("screenshot"):
                        logger.warning(
                            "Sinal nao executado: {} | sinal_line={} exec_line={} exec_odd={:.2f} | tempos={} | screenshot={}",
                            result["msg"],
                            signal["line"],
                            result["line"],
                            result["odd"],
                            result["timings"],
                            result["screenshot"],
                        )
                    else:
                        logger.warning(
                            "Sinal nao executado: {} | sinal_line={} exec_line={} exec_odd={:.2f} | tempos={}",
                            result["msg"],
                            signal["line"],
                            result["line"],
                            result["odd"],
                            result["timings"],
                        )
            except Exception:
                screenshot = await save_error_screenshot(page, signal, "listener_exception")
                if screenshot:
                    logger.exception("Erro ao processar sinal | screenshot={}", screenshot)
                else:
                    logger.exception("Erro ao processar sinal")
            finally:
                await dismiss_popups(page)
                await reset_page_to_favorites(page)

    @client.on(events.NewMessage(chats=entities))
    async def on_new(event):
        await handle_message(event, is_edit=False)

    @client.on(events.MessageEdited(chats=entities))
    async def on_edit(event):
        await handle_message(event, is_edit=True)

    try:
        await client.run_until_disconnected()
    except KeyboardInterrupt:
        print("\nEncerrando...")
    finally:
        keepalive_task.cancel()
        try:
            await keepalive_task
        except asyncio.CancelledError:
            pass
        session_guard_task.cancel()
        try:
            await session_guard_task
        except asyncio.CancelledError:
            pass
        await save_cookies(context)
        await page.close()
        await context_manager.__aexit__(None, None, None)
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
