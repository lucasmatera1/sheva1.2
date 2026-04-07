"""Entry point para o Auto-Bet."""

from __future__ import annotations

import asyncio
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.betting.orchestrator import AutoBetOrchestrator
from src.utils.logger import get_logger

logger = get_logger("autobet_main")


async def main() -> None:
    orchestrator = AutoBetOrchestrator()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(orchestrator.stop()))
        except NotImplementedError:
            pass  # Windows

    try:
        await orchestrator.start()
    except KeyboardInterrupt:
        pass
    finally:
        await orchestrator.stop()
        logger.info("Auto-Bet encerrado")


if __name__ == "__main__":
    asyncio.run(main())
