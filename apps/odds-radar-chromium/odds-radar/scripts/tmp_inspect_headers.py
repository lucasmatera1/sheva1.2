"""Inspect full headers of PlaceBet requests in traffic log."""
import json

with open("logs/bet365_api_traffic.jsonl", encoding="utf-8") as f:
    count = 0
    for line in f:
        try:
            d = json.loads(line.strip())
            if d.get("type") == "request" and "placebet" in d.get("url", "").lower():
                count += 1
                url = d.get("url", "")
                method = d.get("method", "")
                headers = d.get("headers", {})
                body = d.get("body", "")
                
                print(f"=== REQUEST #{count} ===")
                print(f"Method: {method}")
                print(f"URL: {url}")
                print(f"Body: '{str(body)[:300]}'")
                print(f"\nHeaders ({len(headers)}):")
                for k, v in sorted(headers.items()):
                    # Truncate long values
                    if len(str(v)) > 100:
                        print(f"  {k}: {str(v)[:100]}... ({len(str(v))} chars)")
                    else:
                        print(f"  {k}: {v}")
                
                # Extract just cookie names
                cookie_val = headers.get("cookie", "")
                if cookie_val:
                    names = [c.split("=")[0].strip() for c in cookie_val.split(";")]
                    print(f"\nCookie names: {names}")
                    # Also show cookie values lengths
                    for c in cookie_val.split(";"):
                        parts = c.strip().split("=", 1)
                        if len(parts) == 2:
                            print(f"  {parts[0].strip()}: {len(parts[1])} chars")
                print()
                
                if count >= 2:
                    break
        except Exception as e:
            print(f"Error: {e}")
