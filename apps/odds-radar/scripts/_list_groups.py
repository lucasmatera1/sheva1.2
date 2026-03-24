"""Lista grupos do Telegram que contenham palavras-chave no nome."""
import asyncio, json, os
from telethon import TelegramClient

BASE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(BASE)  # goes from scripts/ to odds-radar/
cfg = json.load(open(os.path.join(BASE, ".telegram_config.json")))
client = TelegramClient(os.path.join(BASE, ".telegram_session"), cfg["api_id"], cfg["api_hash"])

async def main():
    await client.start()
    print("=" * 70)
    print("  TODOS OS DIALOGOS DO TELEGRAM")
    print("=" * 70)
    count = 0
    async for dialog in client.iter_dialogs():
        eid = getattr(dialog.entity, "id", "?")
        tipo = type(dialog.entity).__name__
        marker = ""
        if dialog.is_group:
            marker = "[GRUPO]  "
        elif dialog.is_channel:
            marker = "[CANAL]  "
        else:
            marker = "[CHAT]   "
        username = getattr(dialog.entity, "username", None) or ""
        uname_str = f"  @{username}" if username else ""
        print(f"  {marker} ID: {eid:<15} | {dialog.name}{uname_str}")
        count += 1
    print("=" * 70)
    print(f"  Total: {count} dialogos")
    await client.disconnect()

asyncio.run(main())
