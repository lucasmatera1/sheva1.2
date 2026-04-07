"""Check Camoufox cookies for GeoComply tokens."""
import json
from pathlib import Path

cookies_file = Path("d:/Sheva/apps/odds-radar/.browser_data/cookies.json")
if not cookies_file.exists():
    print("Camoufox cookies.json not found")
    # Check what's in .browser_data
    bd = Path("d:/Sheva/apps/odds-radar/.browser_data")
    if bd.exists():
        for f in bd.iterdir():
            print(f"  {f.name} ({f.stat().st_size} bytes)")
    else:
        print("No .browser_data dir")
    exit()

cookies = json.loads(cookies_file.read_text(encoding="utf-8"))
print(f"Total: {len(cookies)} cookies\n")

# Find interesting cookies
for c in cookies:
    name = c.get("name", "")
    if any(k in name.lower() for k in ["gwt", "geo", "pstk", "comply", "session", "auth", "token"]):
        print(f"  {name}: {str(c.get('value', ''))[:60]}... expires={c.get('expires', -1)}")

print("\n--- All cookie names ---")
for c in cookies:
    print(f"  {c['name']}")
