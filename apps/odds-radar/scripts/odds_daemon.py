"""Odds Daemon — monitor contínuo que captura odds automaticamente.

Mantém o browser aberto 24h na página de listagem do GT League (Bet365).
Faz polling na API Sheva a cada N segundos procurando dispatches que
ainda não receberam odds.  Quando encontra um, faz match pelo nome do
jogador na página e envia as odds de volta para a API (que edita a
mensagem no Telegram).

Usage:
    python scripts/odds_daemon.py [--interval 10] [--headless]
    python scripts/odds_daemon.py --url1 "<LINK1>" --url2 "<LINK2>"
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

logger = get_logger("odds-daemon")

# Duas URLs pré-definidas para o GT League no Bet365 (podem ser sobrescritas via --url1 / --url2)
# Link 1: Página de listagem (resultado final / 1X2) — visão por competição
DEFAULT_URL_1 = "https://www.bet365.bet.br/#/AC/B151/C71755867/D47/E40/F47/"
# Link 2: Página de listagem — visão por horário/ao-vivo
DEFAULT_URL_2 = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"

# JS que extrai TODOS os jogos visíveis na página de listagem
EXTRACT_ALL_JS = """
() => {
    const result = { matches: [] };
    const nameRe = /^(.+?)\\s*\\(([^)]+)\\)$/;
    const oddsRe = /^\\d{1,2}\\.\\d{2}$/;

    // Collect all participant names (leaf nodes matching "Team (Player)")
    const participants = [];
    for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        const m = t.match(nameRe);
        if (m) {
            participants.push({ team: m[1].trim(), player: m[2].trim(), el: el });
        }
    }

    // Collect all odds values
    const odds = [];
    for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        if (oddsRe.test(t)) {
            const v = parseFloat(t);
            if (v >= 1.01 && v <= 50.0) {
                odds.push(v);
            }
        }
    }

    // Group into matches (pairs of participants, triples of 1X2 odds)
    const matchCount = Math.floor(participants.length / 2);
    for (let i = 0; i < matchCount; i++) {
        const home = participants[i * 2];
        const away = participants[i * 2 + 1];
        const oi = i * 3;
        if (oi + 2 >= odds.length) continue;
        result.matches.push({
            homeTeam: home.team,
            homePlayer: home.player,
            awayTeam: away.team,
            awayPlayer: away.player,
            homeOdd: odds[oi],
            drawOdd: odds[oi + 1],
            awayOdd: odds[oi + 2],
        });
    }

    return result;
}
"""


async def fetch_pending_dispatches(api_url: str) -> list[dict]:
    """Busca dispatches que precisam de odds (pending_future ou sent, sem odds)."""
    url = f"{api_url.rstrip('/')}/api/alerts/dispatches?limit=50"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning("API retornou {}", resp.status_code)
            return []
        all_dispatches = resp.json()
        if not isinstance(all_dispatches, list):
            return []

    pending = []
    now_ms = time.time() * 1000
    for d in all_dispatches:
        # Só considera dispatches enviados que são futuros (não resolvidos)
        event_type = d.get("eventType", "")
        status = d.get("transportStatus", "")
        if event_type == "result_followup":
            continue
        if status not in ("sent", "skipped"):
            continue

        # Verifica se já tem odds no payload
        payload_text = d.get("payloadText", "")
        if payload_text:
            try:
                payload = json.loads(payload_text)
                signal = payload.get("signal", {})
                if signal.get("odds"):
                    continue  # Já tem odds aplicadas
            except (json.JSONDecodeError, TypeError):
                pass

        # Extrai nomes dos jogadores do confrontationLabel "Player1 x Player2"
        label = d.get("confrontationLabel", "")
        if " x " not in label:
            continue
        parts = label.split(" x ", 1)
        pending.append({
            "id": d["id"],
            "player1": parts[0].strip(),
            "player2": parts[1].strip(),
            "confrontationLabel": label,
            "occurrencePlayedAt": d.get("occurrencePlayedAt", ""),
        })

    return pending


def match_dispatch_to_page(dispatch: dict, page_matches: list[dict]) -> dict | None:
    """Encontra o jogo na página que corresponde ao dispatch."""
    p1 = dispatch["player1"].lower()
    p2 = dispatch["player2"].lower()

    for m in page_matches:
        hp = m["homePlayer"].lower()
        ap = m["awayPlayer"].lower()
        # Match se ambos jogadores estão presentes (em qualquer ordem)
        if (p1 in hp or p1 in ap) and (p2 in hp or p2 in ap):
            return m
        if (hp in p1 or hp in p2) and (ap in p1 or ap in p2):
            return m

    return None


async def send_odds(api_url: str, match: dict, link: str) -> dict:
    """Envia odds para a API Sheva."""
    url = f"{api_url.rstrip('/')}/api/alerts/dispatches/odds"
    payload = {
        "homePlayer": match["homePlayer"],
        "awayPlayer": match["awayPlayer"],
        "homeOdd": match["homeOdd"],
        "awayOdd": match["awayOdd"],
        "link": link,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload)
        return resp.json()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Odds Daemon — monitor contínuo")
    parser.add_argument(
        "--interval", type=int, default=10,
        help="Intervalo de polling em segundos (default: 10)",
    )
    parser.add_argument(
        "--headless", action="store_true",
        help="Rodar browser em modo headless",
    )
    parser.add_argument(
        "--url1", type=str, default=None,
        help="URL da página 1 do Bet365 (sobrescreve o padrão)",
    )
    parser.add_argument(
        "--url2", type=str, default=None,
        help="URL da página 2 do Bet365 (sobrescreve o padrão)",
    )
    args = parser.parse_args()

    settings = get_settings()
    api_url = settings.sheva_api_url

    url1 = args.url1 or DEFAULT_URL_1
    url2 = args.url2 or DEFAULT_URL_2
    link = url1  # link principal que vai na mensagem do Telegram

    # Configura headless se solicitado
    if args.headless:
        import os
        os.environ["BROWSER_HEADLESS"] = "true"
        settings = get_settings()

    engine = BrowserEngine(settings.browser)
    processed_ids: set[str] = set()

    logger.info("=== Odds Daemon iniciando ===")
    logger.info("API: {} | Intervalo: {}s", api_url, args.interval)

    async with engine.launch() as ctx:
        # Abre duas páginas (abas) — uma para cada link
        page1 = await engine.new_page(ctx)
        page2 = await engine.new_page(ctx)

        logger.info("Abrindo Link 1: {}", url1[:80])
        await page1.goto(url1, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(6)

        logger.info("Abrindo Link 2: {}", url2[:80])
        await page2.goto(url2, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(6)

        # Tenta fechar popups de geolocalização
        for p in (page1, page2):
            try:
                await engine.dismiss_geo_popup(p)
            except Exception:
                pass

        logger.info("Duas páginas carregadas. Iniciando loop de monitoramento...")

        cycle = 0
        consecutive_errors = 0

        while True:
            cycle += 1

            try:
                # 1. Buscar dispatches pendentes na API
                pending = await fetch_pending_dispatches(api_url)
                # Filtra os já processados
                new_pending = [d for d in pending if d["id"] not in processed_ids]

                if new_pending:
                    logger.info(
                        "Ciclo #{}: {} dispatch(es) pendente(s) de odds",
                        cycle, len(new_pending),
                    )

                    # 2. Extrair jogos de AMBAS as páginas Bet365
                    page_matches: list[dict] = []
                    for idx, pg in enumerate((page1, page2), 1):
                        try:
                            data = await pg.evaluate(EXTRACT_ALL_JS)
                            matches = data.get("matches", [])
                            if matches:
                                logger.debug("Link {}: {} jogos encontrados", idx, len(matches))
                                page_matches.extend(matches)
                        except Exception as e:
                            logger.warning("Erro ao extrair do Link {}: {}", idx, e)
                            try:
                                await pg.reload(wait_until="domcontentloaded", timeout=30000)
                                await asyncio.sleep(5)
                            except Exception:
                                pass

                    # Deduplicar por par de jogadores
                    seen_keys: set[str] = set()
                    unique_matches: list[dict] = []
                    for m in page_matches:
                        key = f"{m['homePlayer'].lower()}|{m['awayPlayer'].lower()}"
                        if key not in seen_keys:
                            seen_keys.add(key)
                            unique_matches.append(m)
                    page_matches = unique_matches

                    if page_matches:
                        logger.debug(
                            "Página tem {} jogos: {}",
                            len(page_matches),
                            [(m["homePlayer"], m["awayPlayer"]) for m in page_matches[:5]],
                        )

                    # 3. Para cada dispatch, tentar match na página
                    for dispatch in new_pending:
                        matched = match_dispatch_to_page(dispatch, page_matches)
                        if matched:
                            logger.info(
                                "MATCH! {} → {} {:.2f} vs {} {:.2f}",
                                dispatch["confrontationLabel"],
                                matched["homePlayer"], matched["homeOdd"],
                                matched["awayPlayer"], matched["awayOdd"],
                            )

                            result = await send_odds(api_url, matched, link)
                            api_matched = result.get("matched", 0)
                            logger.info("API → matched={}", api_matched)

                            if api_matched > 0:
                                processed_ids.add(dispatch["id"])
                                logger.info(
                                    "✓ Odds aplicadas para {} (dispatch #{})",
                                    dispatch["confrontationLabel"],
                                    dispatch["id"],
                                )
                        else:
                            logger.debug(
                                "Jogo {} ainda não aparece na página",
                                dispatch["confrontationLabel"],
                            )

                elif cycle % 30 == 0:
                    # Log heartbeat a cada ~5min (30 * 10s)
                    logger.info("Ciclo #{}: sem dispatches pendentes de odds", cycle)

                consecutive_errors = 0

            except Exception as e:
                consecutive_errors += 1
                logger.error("Erro no ciclo #{}: {}", cycle, e)

                # Se muitos erros seguidos, tenta recarregar as páginas
                if consecutive_errors >= 5:
                    logger.warning("Muitos erros seguidos, recarregando páginas...")
                    for idx, (pg, rurl) in enumerate(
                        ((page1, url1), (page2, url2)), 1
                    ):
                        try:
                            await pg.goto(rurl, wait_until="domcontentloaded", timeout=60000)
                            await asyncio.sleep(6)
                        except Exception as reload_err:
                            logger.error("Falha ao recarregar Link {}: {}", idx, reload_err)
                    consecutive_errors = 0

            await asyncio.sleep(args.interval)


if __name__ == "__main__":
    asyncio.run(main())
