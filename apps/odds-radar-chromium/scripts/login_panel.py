"""Painel para login no Bet365 via Chromium.

O Bet365 bloqueia login com preenchimento automatizado. Este painel
abre o Chromium para o usuário logar manualmente (mouse/teclado reais)
e salva os cookies da sessão para uso futuro pelo auto-bet.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tkinter as tk
from pathlib import Path
from tkinter import messagebox

PROJECT_DIR = Path(__file__).resolve().parent.parent


class LoginPanel:
    """Janela Tkinter para gerenciar sessão Bet365."""

    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Sheva — Sessão Bet365")
        self.root.resizable(False, False)
        self.root.configure(bg="#1a1a2e")

        # Centraliza na tela
        w, h = 440, 320
        x = (self.root.winfo_screenwidth() - w) // 2
        y = (self.root.winfo_screenheight() - h) // 2
        self.root.geometry(f"{w}x{h}+{x}+{y}")

        self._build_ui()
        self._check_session()

    def _build_ui(self) -> None:
        bg = "#1a1a2e"
        fg = "#e0e0e0"
        accent = "#0f3460"
        btn_bg = "#e94560"

        # Título
        tk.Label(
            self.root, text="🔐 Sessão Bet365", font=("Segoe UI", 16, "bold"),
            bg=bg, fg="#e94560",
        ).pack(pady=(20, 5))

        tk.Label(
            self.root,
            text="O Bet365 bloqueia login automatizado.\n"
                 "Faça login manual dentro do Chromium.",
            font=("Segoe UI", 9), bg=bg, fg="#888", justify="center",
        ).pack(pady=(0, 15))

        # Info da sessão
        self.session_label = tk.Label(
            self.root, text="", font=("Segoe UI", 10), bg=bg, fg="#4ecca3",
        )
        self.session_label.pack(pady=(0, 15))

        # Botões
        btn_frame = tk.Frame(self.root, bg=bg)
        btn_frame.pack(padx=40, fill="x")

        self.login_btn = tk.Button(
            btn_frame, text="🌐  Abrir Chromium e Logar", font=("Segoe UI", 12, "bold"),
            bg=btn_bg, fg="white", relief="flat", bd=0, cursor="hand2",
            command=self._open_manual_login, activebackground="#c73e54",
        )
        self.login_btn.pack(fill="x", ipady=8, pady=(0, 10))

        self.check_btn = tk.Button(
            btn_frame, text="🔍  Verificar Sessão", font=("Segoe UI", 10),
            bg=accent, fg="white", relief="flat", bd=0, cursor="hand2",
            command=self._check_session, activebackground="#0a2647",
        )
        self.check_btn.pack(fill="x", ipady=4, pady=(0, 10))

        # Instruções
        instructions = tk.Label(
            self.root,
            text="1. Clique em 'Abrir Chromium e Logar'\n"
                 "2. No browser, clique Login e entre com suas credenciais\n"
                 "3. Quando logado, os cookies são salvos automaticamente\n"
                 "4. O browser fecha e a sessão fica ativa",
            font=("Segoe UI", 8), bg=bg, fg="#666", justify="left",
        )
        instructions.pack(pady=(5, 0), padx=40, anchor="w")

        # Status
        self.status_label = tk.Label(
            self.root, text="", font=("Segoe UI", 9), bg=bg, fg="#f0c040",
        )
        self.status_label.pack(pady=(8, 0))

    def _check_session(self) -> None:
        """Verifica se há cookies salvos."""
        cookies_file = PROJECT_DIR / ".browser_data" / "cookies.json"
        if cookies_file.exists():
            import json
            try:
                cookies = json.loads(cookies_file.read_text(encoding="utf-8"))
                # Procura cookies do bet365
                b365_cookies = [c for c in cookies if "bet365" in c.get("domain", "")]
                if b365_cookies:
                    self.session_label.config(
                        text=f"✅ Sessão encontrada ({len(b365_cookies)} cookies Bet365)",
                        fg="#4ecca3",
                    )
                    return
            except Exception:
                pass

        self.session_label.config(
            text="❌ Sem sessão ativa — faça login manual",
            fg="#e94560",
        )

    def _open_manual_login(self) -> None:
        """Abre o script de login manual em processo separado."""
        self.status_label.config(text="⏳ Abrindo Chromium...", fg="#f0c040")
        self.login_btn.config(state="disabled")
        self.root.update()

        python = sys.executable
        script = str(PROJECT_DIR / "scripts" / "manual_login.py")

        try:
            result = subprocess.run(
                [python, script],
                capture_output=True, text=True, timeout=600,  # 10 min max
                cwd=str(PROJECT_DIR),
            )
            output = result.stdout + result.stderr

            if "LOGIN DETECTADO" in output:
                self.status_label.config(text="✅ Login realizado com sucesso!", fg="#4ecca3")
                messagebox.showinfo(
                    "Sucesso",
                    "Login no Bet365 realizado!\nCookies salvos para uso automático.",
                )
            elif "JÁ está logado" in output:
                self.status_label.config(text="✅ Já estava logado!", fg="#4ecca3")
                messagebox.showinfo("Info", "Você já estava logado. Cookies atualizados.")
            else:
                self.status_label.config(text="⚠️ Login não detectado", fg="#f0c040")
                messagebox.showwarning(
                    "Atenção",
                    "Login não foi detectado.\nTente novamente.",
                )
        except subprocess.TimeoutExpired:
            self.status_label.config(text="⏱️ Timeout", fg="#f0c040")
            messagebox.showwarning("Timeout", "O tempo expirou. Tente novamente.")
        except Exception as e:
            self.status_label.config(text=f"❌ Erro: {e}", fg="#e94560")
        finally:
            self.login_btn.config(state="normal")
            self._check_session()

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    panel = LoginPanel()
    panel.run()
