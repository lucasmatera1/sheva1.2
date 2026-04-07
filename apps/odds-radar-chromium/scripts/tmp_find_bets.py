"""Quick script to find accepted bets in traffic log."""
import json

with open("logs/bet365_api_traffic.jsonl", encoding="utf-8") as f:
    for line in f:
        try:
            d = json.loads(line.strip())
            # Find PlaceBet requests
            if d.get("type") == "request" and "placebet" in d.get("url", "").lower():
                print("=== PLACEBET REQUEST ===")
                url = d.get("url", "")
                print(f"URL: {url[:250]}")
                body = d.get("body", "")
                if body:
                    print(f"Body: {str(body)[:300]}")
                headers = d.get("headers", {})
                print(f"x-net-sync-term: {'present' if headers.get('x-net-sync-term') else 'MISSING'}")
                print(f"x-request-id: {headers.get('x-request-id', 'MISSING')}")
                print()

            # Find PlaceBet responses
            if d.get("type") == "response" and "placebet" in d.get("url", "").lower():
                body = d.get("body", {})
                cs = body.get("cs", -1) if isinstance(body, dict) else -1
                mi = body.get("mi", "") if isinstance(body, dict) else ""
                sr = body.get("sr", "") if isinstance(body, dict) else ""
                print(f"=== PLACEBET RESPONSE: cs={cs} sr={sr} mi={mi} ===")
                url = d.get("url", "")
                print(f"URL: {url[:250]}")
                if isinstance(body, dict):
                    print(f"Body keys: {list(body.keys())}")
                    if cs == 3:
                        print(f"ACCEPTED! Full: {json.dumps(body)[:400]}")
                print()

        except Exception as e:
            pass
