"""Find where the initial c= challenge value comes from in the traffic log."""
import json
from urllib.parse import unquote

# First, find the initial c= value from the first PlaceBet
first_c = None
first_placebet_ts = None

with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except:
            continue
        url = d.get("url", "")
        if "placebet" in url.lower() and "&c=" in url and d.get("method") == "POST":
            c_raw = url.split("&c=")[1].split("&")[0]
            first_c = unquote(c_raw)
            first_placebet_ts = d.get("_ts", "")
            break

if not first_c:
    print("ERRO: Nenhum PlaceBet com c= encontrado")
    exit()

print(f"Primeiro PlaceBet c= : {first_c}")
print(f"Timestamp: {first_placebet_ts}")
print()

# Now search for this value ANYWHERE in the log (before the first PlaceBet)
search = first_c[:20]  # Search for first 20 chars
print(f"Buscando '{search}' em todo o log...")
print()

found = 0
with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    for i, line in enumerate(f):
        line = line.strip()
        if not line:
            continue
        if search in line:
            found += 1
            try:
                d = json.loads(line)
                url = d.get("url", "")[:100]
                method = d.get("method", "?")
                ts = d.get("_ts", "?")
                body = str(d.get("body", ""))[:200]
                print(f"  Hit #{found} (line {i+1}) ts={ts} {method} {url}")
                print(f"    body: {body[:200]}")
                print(f"    keys: {sorted(d.keys())}")
            except:
                print(f"  Hit #{found} (line {i+1}): parse error")
                print(f"    raw: {line[:200]}")
            print()
            if found >= 10:
                break

print(f"Total hits: {found}")
print()

# Also look for responses with 'cc' field before the first PlaceBet
print("=" * 60)
print("Buscando responses com 'cc' antes do primeiro PlaceBet...")
print()

with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    cc_count = 0
    for i, line in enumerate(f):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except:
            continue
        url = d.get("url", "")
        if "placebet" in url.lower() and d.get("method") == "POST":
            print(f"Reached first PlaceBet at line {i+1}, stopping search")
            break
        
        # Check body for cc field
        body = d.get("body", "")
        if isinstance(body, str) and '"cc"' in body:
            cc_count += 1
            print(f"  cc found at line {i+1}: url={url[:100]}")
            # Extract cc value
            try:
                bj = json.loads(body)
                cc_val = bj.get("cc", "")
                print(f"    cc = {cc_val[:80]}")
            except:
                print(f"    body: {body[:150]}")
            print()
            if cc_count >= 5:
                break

if cc_count == 0:
    print("  Nenhum cc encontrado antes do primeiro PlaceBet")

# Also search for 'challenge' or 'nc' in any response body
print()
print("=" * 60)
print("Buscando 'challenge|nc=' em responses antes do PlaceBet...")
with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    for i, line in enumerate(f):
        if "placebet" in line.lower() and "POST" in line:
            print(f"Reached first PlaceBet at line {i+1}")
            break
        if "challenge" in line.lower() or "'nc'" in line.lower() or '"nc"' in line.lower():
            try:
                d = json.loads(line.strip())
                print(f"  line {i+1}: url={d.get('url','')[:100]}")
                print(f"    keys: {sorted(d.keys())}")
                print(f"    body: {str(d.get('body',''))[:200]}")
            except:
                pass
            print()
