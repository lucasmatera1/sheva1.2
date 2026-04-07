"""Inspect actual PlaceBet response bodies in traffic log."""
import json

with open("logs/bet365_api_traffic.jsonl", encoding="utf-8") as f:
    count = 0
    for line in f:
        try:
            d = json.loads(line.strip())
            if d.get("type") == "response" and "placebet" in d.get("url", "").lower():
                count += 1
                body = d.get("body")
                print(f"--- Response #{count} ---")
                print(f"  URL: {d['url'][:120]}")
                print(f"  Body type: {type(body).__name__}")
                if isinstance(body, str):
                    print(f"  Body (str): {body[:500]}")
                elif isinstance(body, dict):
                    print(f"  Body (dict): {json.dumps(body)[:500]}")
                else:
                    print(f"  Body (other): {str(body)[:500]}")
                print()
                if count >= 5:
                    break
        except Exception as e:
            pass

# Also look for any response with cs=2 or cs=3
print("\n=== LOOKING FOR cs=2 or cs=3 ===")
with open("logs/bet365_api_traffic.jsonl", encoding="utf-8") as f:
    for line in f:
        try:
            d = json.loads(line.strip())
            if d.get("type") == "response" and "placebet" in d.get("url", "").lower():
                body = d.get("body")
                if isinstance(body, str) and ('"cs":2' in body or '"cs":3' in body or '"cs": 2' in body or '"cs": 3' in body):
                    print(f"  FOUND cs=2/3 in string body: {body[:300]}")
                elif isinstance(body, dict):
                    cs = body.get("cs", -99)
                    if cs in (2, 3):
                        print(f"  FOUND cs={cs}: {json.dumps(body)[:300]}")
        except:
            pass

# Now look for PlaceBet REQUEST bodies to see the exact format
print("\n=== PLACEBET REQUEST BODIES ===")
with open("logs/bet365_api_traffic.jsonl", encoding="utf-8") as f:
    count = 0
    for line in f:
        try:
            d = json.loads(line.strip())
            if d.get("type") == "request" and "placebet" in d.get("url", "").lower():
                count += 1
                body = d.get("body", "")
                method = d.get("method", "")
                headers = d.get("headers", {})
                print(f"--- Request #{count} ---")
                print(f"  Method: {method}")
                print(f"  Body type: {type(body).__name__}")
                if body:
                    print(f"  Body: {str(body)[:400]}")
                else:
                    print(f"  Body: EMPTY")
                # Check for cookies header
                cookie_h = headers.get("cookie", "")
                if cookie_h:
                    # Parse cookie names
                    names = [c.split("=")[0].strip() for c in cookie_h.split(";")]
                    print(f"  Cookie names: {names}")
                print()
                if count >= 3:
                    break
        except:
            pass
