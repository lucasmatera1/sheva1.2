"""Analyze all traffic before first PlaceBet + check sessionStorage betstring."""
import json
from urllib.parse import unquote

# Show all entries before first PlaceBet to understand initialization
print("=== Entries before first PlaceBet (lines 1-57) ===\n")
with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    for i, line in enumerate(f):
        line = line.strip()
        if not line:
            continue
        if i >= 57:
            break
        try:
            d = json.loads(line)
        except:
            continue
        url = d.get("url", "")[:120]
        method = d.get("method", "resp")
        ts = d.get("_ts", "")
        typ = d.get("type", "")
        body_preview = str(d.get("body", d.get("post_data", "")))[:80]
        
        print(f"  {i+1:3d} {method:4s} [{typ}] {url}")
        if body_preview and body_preview != "":
            print(f"      body: {body_preview}")

# Specifically look at the sessionStorage betstring from the log
# Also look for URLs that have ?nc= or ?c= or ?cc= 
print("\n\n=== URLs with c=, nc=, cc= parameters (all log) ===\n")
with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    found = 0
    for i, line in enumerate(f):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except:
            continue
        url = d.get("url", "")
        if "placebet" in url.lower():
            continue  # Skip placebet (already know about those)
        # Check for c=, nc=, cc= in URL (but not common params like classificationCodes=)
        import re
        if re.search(r'[?&](nc|cc|c)=', url):
            found += 1
            print(f"  {i+1:3d}: {url[:200]}")
            if found >= 10:
                break
    print(f"  Total: {found}")

# Search for base64 hash-like values in responses (32 bytes = 44 chars base64)
print("\n\n=== Base64 hash values in responses before PlaceBet ===\n")
import re
b64_pattern = re.compile(r'[A-Za-z0-9+/_-]{40,50}=')
with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    found = 0
    for i, line in enumerate(f):
        if i >= 57:
            break
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except:
            continue
        body = str(d.get("body", ""))
        if len(body) < 10:
            continue
        matches = b64_pattern.findall(body)
        if matches:
            url = d.get("url", "")[:80]
            for m in matches[:3]:
                found += 1
                print(f"  {i+1:3d}: {url}")
                print(f"      match: {m}")
            if found >= 20:
                break
    print(f"  Total base64 matches: {found}")
