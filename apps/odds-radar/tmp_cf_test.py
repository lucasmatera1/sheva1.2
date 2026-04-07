import asyncio
from camoufox.async_api import AsyncCamoufox

async def test():
    async with AsyncCamoufox(headless=True, os="windows") as browser:
        page = await browser.new_page()
        r = await page.goto("https://www.bet365.bet.br/", wait_until="domcontentloaded", timeout=30000)
        title = await page.title()
        print(f"Status: {r.status}")
        print(f"Title: {title[:80]}")
        blocked = "blocked" in title.lower() or "sorry" in title.lower()
        print(f"Blocked: {blocked}")

asyncio.run(test())
