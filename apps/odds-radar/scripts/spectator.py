"""
Spectator Mode — Assiste o browser headless em tempo real (read-only).

Abre uma janela web local (http://localhost:7777) que mostra screenshots
do browser atualizados a cada 1s. Só leitura — mouse/teclado não afetam o bot.

Uso:
    1. Em um terminal, rode o bot normalmente (test_multi_bet.py, etc)
    2. Em outro terminal: python scripts/spectator.py
    3. Abra http://localhost:7777 no navegador
"""

import http.server
import os
import threading
import time
from pathlib import Path

SCREENSHOT_DIR = Path(__file__).resolve().parent.parent / "tmp"
SCREENSHOT_FILE = SCREENSHOT_DIR / "spectator_live.png"
PORT = 7777

HTML_PAGE = """<!DOCTYPE html>
<html>
<head>
  <title>Sheva Spectator</title>
  <style>
    body { margin: 0; background: #111; display: flex; justify-content: center; min-height: 100vh; }
    img { max-width: 100vw; border: 1px solid #333; }
    #status { position: fixed; top: 8px; left: 12px; color: #0f0; font: 14px monospace; background: rgba(0,0,0,0.7); padding: 4px 8px; border-radius: 4px; z-index: 10; }
  </style>
</head>
<body>
  <div id="status">LIVE</div>
  <img id="screen" src="/screenshot?t=0" />
  <script>
    const img = document.getElementById('screen');
    const status = document.getElementById('status');
    let frame = 0;
    setInterval(() => {
      const newImg = new Image();
      newImg.onload = () => { img.src = newImg.src; frame++; status.textContent = 'LIVE | frame ' + frame; };
      newImg.onerror = () => { status.textContent = 'WAITING...'; };
      newImg.src = '/screenshot?t=' + Date.now();
    }, 300);
  </script>
</body>
</html>"""


class SpectatorHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/screenshot"):
            try:
                data = SCREENSHOT_FILE.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode())

    def log_message(self, format, *args):
        pass  # silencia logs HTTP


def main():
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"  Spectator Mode — http://localhost:{PORT}")
    print(f"  Screenshots: {SCREENSHOT_FILE}")
    print(f"  Pressione Ctrl+C para parar")
    print()

    server = http.server.HTTPServer(("127.0.0.1", PORT), SpectatorHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Spectator encerrado.")
        server.server_close()


if __name__ == "__main__":
    main()
