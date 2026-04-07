"""Scan traffic log for PlaceBet requests to compare formats."""
import json

with open("logs/bet365_api_traffic.jsonl", "r", encoding="utf-8", errors="replace") as f:
    count = 0
    for line in f:
        line = line.strip()
        if not line or "placebet" not in line.lower():
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        url = d.get("url", "")
        if "placebet" not in url.lower():
            continue
        count += 1
        
        # Show ALL keys in the entry
        if count <= 3:
            print(f"--- Entry #{count} keys: {sorted(d.keys())}")
        
        resp = d.get("response_body", "") or d.get("response", "")
        sr = "?"
        cs = "?"
        if isinstance(resp, str):
            try:
                rj = json.loads(resp)
                sr = rj.get("sr", "?")
                cs = rj.get("cs", "?")
            except Exception:
                pass
        
        hdrs = d.get("headers", {})
        body = d.get("body", "")
        req_body = d.get("request_body", "")
        post_data = d.get("post_data", "")
        data = d.get("data", "")
        method = d.get("method", "?")
        
        # Extract c= param from URL
        c_param = ""
        if "&c=" in url:
            c_param = url.split("&c=")[1].split("&")[0][:50]
        
        print(f"#{count} {method} cs={cs} sr={sr}")
        print(f"  url: {url[:200]}")
        print(f"  c_param: {c_param}")
        print(f"  x-request-id: {hdrs.get('x-request-id', hdrs.get('X-Request-Id', 'N/A'))}")
        print(f"  body: [{type(body).__name__}] {str(body)[:300]}")
        print(f"  request_body: [{type(req_body).__name__}] {str(req_body)[:300]}")
        print(f"  post_data: [{type(post_data).__name__}] {str(post_data)[:300]}")
        print(f"  data: [{type(data).__name__}] {str(data)[:300]}")
        print(f"  resp: {str(resp)[:250]}")
        print()
        if count >= 10:
            break

print(f"Total PlaceBet entries found: {count}")
