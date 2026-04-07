"use client";

import { useEffect, useState } from "react";

type PortalTheme = "dark" | "light";

const STORAGE_KEY = "bdb-portal-theme";

function applyTheme(theme: PortalTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M12.9 2.85a6.9 6.9 0 1 0 4.25 10.9A7.6 7.6 0 0 1 12.9 2.85Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2.5v2.1M10 15.4v2.1M17.5 10h-2.1M4.6 10H2.5M15.3 4.7l-1.5 1.5M6.2 13.8l-1.5 1.5M15.3 15.3l-1.5-1.5M6.2 6.2 4.7 4.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PortalThemeToggle() {
  const [theme, setTheme] = useState<PortalTheme>("dark");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    const nextTheme: PortalTheme =
      storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  const handleSelectTheme = (nextTheme: PortalTheme) => {
    setTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  const activeLabel = theme === "light" ? "Claro" : "Escuro";

  return (
    <details className="group relative">
      <summary className="flex list-none cursor-pointer items-center gap-3 rounded-[0.65rem] border border-white/10 bg-white/5 px-3 py-2 text-mist transition hover:border-white/16 hover:bg-white/7 hover:text-ivory [&::-webkit-details-marker]:hidden">
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.65rem] bg-white/10">
          {theme === "light" ? <SunIcon /> : <MoonIcon />}
        </div>
        <div className="hidden min-w-0 text-left sm:block">
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
            Theme
          </div>
          <div className="text-sm font-semibold text-ivory">{activeLabel}</div>
        </div>
        <ChevronDownIcon />
      </summary>

      <div className="absolute right-0 top-[calc(100%+0.75rem)] w-52 overflow-hidden rounded-[0.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,26,22,0.96),rgba(7,18,16,0.94))] shadow-[0_24px_60px_rgba(3,10,8,0.42)] backdrop-blur-2xl">
        <div className="border-b border-white/8 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
            Theme
          </div>
          <div className="mt-1 text-sm font-semibold text-ivory">
            Escolha visual
          </div>
        </div>

        <div className="px-2 py-2">
          <button
            type="button"
            onClick={() => handleSelectTheme("dark")}
            className="flex w-full items-center gap-3 rounded-[0.6rem] px-3 py-3 text-left text-sm text-mist transition hover:bg-white/5 hover:text-ivory"
          >
            <MoonIcon />
            <span>Escuro</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectTheme("light")}
            className="flex w-full items-center gap-3 rounded-[0.6rem] px-3 py-3 text-left text-sm text-mist transition hover:bg-white/5 hover:text-ivory"
          >
            <SunIcon />
            <span>Claro</span>
          </button>
        </div>
      </div>
    </details>
  );
}
