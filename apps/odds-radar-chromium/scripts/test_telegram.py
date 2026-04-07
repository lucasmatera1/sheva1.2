"""Script para testar a conexão com o Telegram."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.telegram.bot import TelegramNotifier


async def test_telegram() -> None:
    notifier = TelegramNotifier()
    sent = await notifier.send_status("Teste de conexão — Sheva Odds Radar 🏆")
    await notifier.close()
    if sent is not False:
        print("✅ Mensagem enviada com sucesso!")
    else:
        print("❌ Falha ao enviar. Verifique TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env")


if __name__ == "__main__":
    asyncio.run(test_telegram())
