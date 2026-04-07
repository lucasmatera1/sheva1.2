"""Configurações centralizadas do projeto via variáveis de ambiente."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)


def _int(key: str, default: int) -> int:
    return int(os.getenv(key, str(default)))


def _bool(key: str, default: bool) -> bool:
    return os.getenv(key, str(default)).lower() in ("true", "1", "yes")


def _str(key: str, default: str = "") -> str:
    return os.getenv(key, default)


@dataclass(frozen=True)
class BrowserSettings:
    headless: bool = field(default_factory=lambda: _bool("BROWSER_HEADLESS", True))
    proxy_server: str = field(default_factory=lambda: _str("PROXY_SERVER"))
    proxy_username: str = field(default_factory=lambda: _str("PROXY_USERNAME"))
    proxy_password: str = field(default_factory=lambda: _str("PROXY_PASSWORD"))
    humanize: bool = field(default_factory=lambda: _bool("BROWSER_HUMANIZE", True))
    page_timeout_ms: int = field(default_factory=lambda: _int("PAGE_TIMEOUT_MS", 60_000))
    viewport_width: int = field(default_factory=lambda: _int("VIEWPORT_WIDTH", 1920))
    viewport_height: int = field(default_factory=lambda: _int("VIEWPORT_HEIGHT", 1080))
    user_data_dir: str = field(
        default_factory=lambda: _str(
            "USER_DATA_DIR",
            str(Path(__file__).resolve().parent.parent / ".browser_data"),
        )
    )


@dataclass(frozen=True)
class TelegramSettings:
    bot_token: str = field(default_factory=lambda: _str("TELEGRAM_BOT_TOKEN"))
    chat_id: str = field(default_factory=lambda: _str("TELEGRAM_CHAT_ID"))
    send_photos: bool = field(default_factory=lambda: _bool("TELEGRAM_SEND_PHOTOS", False))


@dataclass(frozen=True)
class ScraperSettings:
    base_url: str = field(
        default_factory=lambda: _str("BET365_URL", "https://www.bet365.bet.br")
    )
    scan_interval_sec: int = field(default_factory=lambda: _int("SCAN_INTERVAL_SEC", 30))
    sports: list[str] = field(
        default_factory=lambda: _str("SPORTS", "soccer").split(",")
    )
    min_odd: float = field(
        default_factory=lambda: float(os.getenv("MIN_ODD", "1.01"))
    )
    max_odd: float = field(
        default_factory=lambda: float(os.getenv("MAX_ODD", "10.0"))
    )
    target_leagues: list[str] = field(
        default_factory=lambda: [
            l.strip()
            for l in _str("TARGET_LEAGUES", "").split(",")
            if l.strip()
        ]
    )


@dataclass(frozen=True)
class AutoBetSettings:
    enabled: bool = field(default_factory=lambda: _bool("AUTOBET_ENABLED", False))
    mode: str = field(default_factory=lambda: _str("AUTOBET_MODE", "semi"))  # semi | full
    default_stake: float = field(
        default_factory=lambda: float(os.getenv("AUTOBET_DEFAULT_STAKE", "1.00"))
    )
    max_stake: float = field(
        default_factory=lambda: float(os.getenv("AUTOBET_MAX_STAKE", "50.00"))
    )
    max_daily_loss: float = field(
        default_factory=lambda: float(os.getenv("AUTOBET_MAX_DAILY_LOSS", "100.00"))
    )
    max_bets_per_hour: int = field(default_factory=lambda: _int("AUTOBET_MAX_BETS_PER_HOUR", 5))
    confirm_timeout_sec: int = field(default_factory=lambda: _int("AUTOBET_CONFIRM_TIMEOUT", 30))
    odd_min: float = field(
        default_factory=lambda: float(os.getenv("AUTOBET_ODD_MIN", "1.30"))
    )
    odd_max: float = field(
        default_factory=lambda: float(os.getenv("AUTOBET_ODD_MAX", "5.00"))
    )
    sheva_poll_interval_sec: int = field(
        default_factory=lambda: _int("AUTOBET_SHEVA_POLL_SEC", 10)
    )


@dataclass(frozen=True)
class Settings:
    browser: BrowserSettings = field(default_factory=BrowserSettings)
    telegram: TelegramSettings = field(default_factory=TelegramSettings)
    scraper: ScraperSettings = field(default_factory=ScraperSettings)
    autobet: AutoBetSettings = field(default_factory=AutoBetSettings)
    log_level: str = field(default_factory=lambda: _str("LOG_LEVEL", "INFO"))
    debug: bool = field(default_factory=lambda: _bool("DEBUG", False))
    sheva_api_url: str = field(
        default_factory=lambda: _str("SHEVA_API_URL", "http://localhost:4013")
    )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
