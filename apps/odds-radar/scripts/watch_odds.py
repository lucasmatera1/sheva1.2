"""Watch a Bet365 match page for odds and push to Sheva API.

Two instances can race in parallel — a lock file guarantees only the first
one to find odds actually sends.  The other exits gracefully.

Usage:
    python scripts/watch_odds.py <URL> --link <PREFERRED_LINK> [--player Snail] [--interval 3]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.utils.logger import get_logger

logger = get_logger("watch-odds")

LOCK_FILE = Path(__file__).parent / ".odds_sent.lock"

# JS executed inside the page to extract participants + odds values.
EXTRACT_JS = """
() => {
    const result = { participants: [], odds: [] };
    const nameRe = /^(.+?)\\s*\\(([^)]+)\\)$/;
    const oddsRe = /^\\d{1,2}\\.\\d{2}$/;

    // Gather participant names  — leaf elements matching "Team (Player)"
    for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        const m = t.match(nameRe);
        if (m) {
            result.participants.push({ team: m[1].trim(), player: m[2].trim() });
        }
    }

    // Gather odds-like values — leaf elements with "N.NN"
    for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        if (oddsRe.test(t)) {
            const v = parseFloat(t);
            if (v >= 1.01 && v <= 50.0) {
                result.odds.push(v);
            }
        }
    }

    return result;
}
"""


async def extract_odds(page, player_filter: str | None = None) -> dict | None:
    """Return {homePlayer, awayPlayer, homeOdd, awayOdd} or None.

    When *player_filter* is set, the page may list several games; we pick
    the one whose participants include the given player (case-insensitive).
    Participants come in pairs and odds in triples (1X2 market).
    """
    data = await page.evaluate(EXTRACT_JS)
    participants = data.get("participants", [])
    odds = data.get("odds", [])

    if len(participants) < 2 or len(odds) < 2:
        return None

    # Group into matches: pairs of participants, triples of odds
    match_count = len(participants) // 2
    matches: list[dict] = []
    for i in range(match_count):
        home = participants[i * 2]
        away = participants[i * 2 + 1]
        odds_offset = i * 3
        if odds_offset + 2 < len(odds):
            h_odd, _, a_odd = odds[odds_offset], odds[odds_offset + 1], odds[odds_offset + 2]
        elif odds_offset + 1 < len(odds):
            h_odd, a_odd = odds[odds_offset], odds[odds_offset + 1]
        elif odds_offset < len(odds):
            continue
        else:
            continue
        matches.append({
            "homePlayer": home["player"],
            "awayPlayer": away["player"],
            "homeOdd": h_odd,
            "awayOdd": a_odd,
        })

    if not matches:
        return None

    # Filter by player name if requested
    if player_filter:
        pf = player_filter.strip().lower()
        filtered = [
            m for m in matches
            if pf in m["homePlayer"].lower() or pf in m["awayPlayer"].lower()
        ]
        if filtered:
            return filtered[0]
        logger.warning(
            "Player '{}' not found among {} matches: {}",
            player_filter,
            len(matches),
            [(m["homePlayer"], m["awayPlayer"]) for m in matches],
        )
        return None

    return matches[0]


async def send_to_sheva(payload: dict, api_url: str) -> dict:
    url = f"{api_url.rstrip('/')}/api/alerts/dispatches/odds"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload)
        return resp.json()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Watch Bet365 page for odds")
    parser.add_argument("url", help="Bet365 match page URL to poll")
    parser.add_argument("--link", help="Link to attach in the API payload (default: same as url)")
    parser.add_argument("--player", help="Filter by player name when page lists multiple games")
    parser.add_argument("--interval", type=int, default=3, help="Poll interval in seconds")
    parser.add_argument("--clear-lock", action="store_true", help="Remove stale lock file before starting")
    args = parser.parse_args()

    if args.clear_lock:
        LOCK_FILE.unlink(missing_ok=True)

    settings = get_settings()
    api_url = settings.sheva_api_url
    link = args.link or args.url

    engine = BrowserEngine(settings.browser)
    async with engine.launch() as ctx:
        page = await engine.new_page(ctx)
        logger.info("Navigating to {}", args.url[:80])
        await page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
        await asyncio.sleep(5)  # let SPA render

        cycle = 0
        while True:
            # Another instance already sent?
            if LOCK_FILE.exists():
                logger.info("Lock file found — another instance already sent odds. Exiting.")
                break

            cycle += 1
            logger.info("— Poll #{} —", cycle)

            try:
                odds = await extract_odds(page, args.player)
                if odds:
                    logger.info(
                        "FOUND: {} {:.2f} vs {} {:.2f}",
                        odds["homePlayer"], odds["homeOdd"],
                        odds["awayPlayer"], odds["awayOdd"],
                    )

                    payload = {**odds, "link": link}
                    result = await send_to_sheva(payload, api_url)
                    logger.info("Sheva API → {}", json.dumps(result))

                    matched = result.get("matched", 0)
                    if matched > 0:
                        # Only lock when API confirmed a dispatch was updated
                        LOCK_FILE.write_text(json.dumps({
                            "sentAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "source": args.url[:80],
                            **odds,
                        }, indent=2))
                        break
                    else:
                        logger.warning("API matched 0 dispatches — wrong game? Continuing to poll…")
                        await asyncio.sleep(args.interval)
                        continue
                else:
                    logger.debug("No odds yet (participants={}, odds={})",
                                 0, 0)
            except Exception as exc:
                logger.error("Error: {}", exc)

            await asyncio.sleep(args.interval)

    logger.info("Done.")


if __name__ == "__main__":
    asyncio.run(main())
