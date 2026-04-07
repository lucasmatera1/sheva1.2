"""Logger centralizado com loguru."""

from __future__ import annotations

import sys

from loguru import logger as _loguru

from config.settings import get_settings

_configured = False


def _configure() -> None:
    global _configured
    if _configured:
        return

    settings = get_settings()
    _loguru.remove()  # Remove handler padrão

    # Console
    _loguru.add(
        sys.stderr,
        level=settings.log_level.upper(),
        format=(
            "<green>{time:HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        ),
        colorize=True,
    )

    # Arquivo rotativo
    _loguru.add(
        "logs/radar_{time:YYYY-MM-DD}.log",
        level="DEBUG",
        rotation="1 day",
        retention="7 days",
        compression="zip",
        encoding="utf-8",
    )

    _configured = True


def get_logger(name: str = __name__):
    _configure()
    return _loguru.bind(name=name)
