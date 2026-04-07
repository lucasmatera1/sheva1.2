"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { portalSectionGroups } from "@/lib/portal-sections";

function HomeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m3.75 9.25 6.25-5 6.25 5v6a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1v-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 16.25v-4h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function LiveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="2.1" fill="currentColor" />
      <path d="M5.75 6.25a5.5 5.5 0 0 0 0 7.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M14.25 6.25a5.5 5.5 0 0 1 0 7.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M3.5 4a8.75 8.75 0 0 0 0 12" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M16.5 4a8.75 8.75 0 0 1 0 12" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  );
}

function BasketballIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.45" />
      <path d="M10 3.75c1.9 1.55 2.85 3.64 2.85 6.25 0 2.6-.95 4.69-2.85 6.25" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M10 3.75c-1.9 1.55-2.85 3.64-2.85 6.25 0 2.6.95 4.69 2.85 6.25" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M4 8.25h12M4 11.75h12" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  );
}

function SoccerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4.25 15.25V6.5M15.75 15.25V6.5"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M4.25 6.5h11.5"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M1.75 15.25h16.5"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

function MonogramIcon({
  label,
  wide = false,
}: {
  label: string;
  wide?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "inline-flex h-5 items-center justify-center rounded-[0.45rem] border border-current/18 bg-current/8 px-1.5 text-[10px] font-semibold uppercase leading-none tracking-[0.08em]",
        wide ? "min-w-[1.95rem]" : "min-w-[1.3rem]",
      )}
    >
      {label}
    </span>
  );
}

function GTLeagueIcon() {
  return <MonogramIcon label="GT" wide />;
}

function VoltaSixIcon() {
  return <MonogramIcon label="6'" />;
}

function BattleEightIcon() {
  return <MonogramIcon label="8'" />;
}

function AdriaticIcon() {
  return <MonogramIcon label="A" />;
}

function PanoramaIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="3.25" y="4.5" width="13.5" height="11.25" rx="2.2" stroke="currentColor" strokeWidth="1.45" />
      <path d="M6.25 3.25v2.5M13.75 3.25v2.5M3.25 8.25h13.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M6.1 10.8h2.15M9.95 10.8h3.95M6.1 13.15h4.1M11.55 13.15h2.35" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

function RadarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="6.2" stroke="currentColor" strokeWidth="1.45" />
      <circle cx="10" cy="10" r="3.1" stroke="currentColor" strokeWidth="1.2" opacity="0.75" />
      <path d="M10 10 14.4 5.9" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M10 10h4.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <circle cx="10" cy="10" r="1.15" fill="currentColor" />
    </svg>
  );
}

function DisparityIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M4 6.5h4.2l1.45 1.45L7.2 10.4H4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 13.5h-4.2l-1.45-1.45 2.45-2.45H16" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.85 9.15 10 8l1.15 1.15L10 10.3 8.85 9.15ZM8.85 10.85 10 9.7l1.15 1.15L10 12l-1.15-1.15Z" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={clsx("h-4 w-4 transition", open ? "rotate-180" : "rotate-0")}
    >
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type PortalNavProps = {
  collapsed?: boolean;
};

export function PortalNav({ collapsed = false }: PortalNavProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries([
      ...portalSectionGroups.map((group) => [
        group.key,
        pathname.startsWith(`/${group.key}/`),
      ]),
      ...portalSectionGroups.flatMap((group) =>
        group.items
          .filter((item) => item.children?.length)
          .map((item) => [
            item.path,
            pathname === item.path || pathname.startsWith(`${item.path}/`),
          ]),
      ),
    ]),
  );
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);

  useEffect(() => {
    setOpenGroups((current) => {
      const next = { ...current };

      for (const group of portalSectionGroups) {
        if (pathname.startsWith(`/${group.key}/`)) {
          next[group.key] = true;
        }

        for (const item of group.items) {
          if (
            item.children?.length &&
            (pathname === item.path || pathname.startsWith(`${item.path}/`))
          ) {
            next[item.path] = true;
          }
        }
      }

      return next;
    });

    setOpenFlyout(null);
  }, [pathname]);

  useEffect(() => {
    if (!collapsed) {
      setOpenFlyout(null);
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!navRef.current) {
        return;
      }

      if (!navRef.current.contains(event.target as Node)) {
        setOpenFlyout(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [collapsed]);

  function toggleGroup(groupKey: string) {
    setOpenGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }

  function toggleFlyout(groupKey: string) {
    setOpenFlyout((current) => (current === groupKey ? null : groupKey));
  }

  function getItemIcon(slug: string) {
    switch (slug) {
      case "battle-volta-6min":
        return VoltaSixIcon;
      case "battle-8min":
        return BattleEightIcon;
      case "eadriatic":
        return AdriaticIcon;
      case "gt-league":
        return GTLeagueIcon;
      default:
        return null;
    }
  }

  function getChildIcon(slug: string) {
    switch (slug) {
      case "panorama":
        return PanoramaIcon;
      case "raio-x":
        return RadarIcon;
      case "disparidade":
        return DisparityIcon;
      default:
        return null;
    }
  }

  if (collapsed) {
    return (
      <nav ref={navRef} className="relative space-y-3">
        <div className="flex flex-col items-center gap-3">
          <Link
            href="/inicio"
            title="Inicio"
            aria-label="Inicio"
            className={clsx(
              "flex h-12 w-12 items-center justify-center rounded-[0.65rem] border transition",
              pathname === "/inicio"
                ? "border-white/12 bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                : "border-white/8 bg-white/[0.03] text-mist hover:border-white/12 hover:bg-white/6 hover:text-ivory",
            )}
          >
            <HomeIcon />
          </Link>

          <Link
            href="/ao-vivo"
            title="Ao Vivo"
            aria-label="Ao Vivo"
            className={clsx(
              "flex h-12 w-12 items-center justify-center rounded-[0.65rem] border transition",
              pathname === "/ao-vivo"
                ? "border-white/12 bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                : "border-white/8 bg-white/[0.03] text-mist hover:border-white/12 hover:bg-white/6 hover:text-ivory",
            )}
          >
            <LiveIcon />
          </Link>

          {portalSectionGroups.map((group) => {
            const isGroupActive = group.items.some(
              (item) =>
                pathname === item.path || pathname.startsWith(`${item.path}/`),
            );
            const isOpen = openFlyout === group.key;
            const Icon =
              group.key === "ebasketball" ? BasketballIcon : SoccerIcon;

            return (
              <div key={group.key} className="relative">
                <button
                  type="button"
                  title={group.label}
                  aria-label={group.label}
                  onClick={() => toggleFlyout(group.key)}
                  className={clsx(
                    "flex h-12 w-12 items-center justify-center rounded-[0.65rem] border transition",
                    isGroupActive || isOpen
                      ? "border-white/12 bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                      : "border-white/8 bg-white/[0.03] text-mist hover:border-white/12 hover:bg-white/6 hover:text-ivory",
                  )}
                >
                  <Icon />
                </button>

                {isOpen ? (
                  <div className="absolute left-[calc(100%+0.9rem)] top-0 z-30 w-64 overflow-hidden rounded-[0.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,26,22,0.96),rgba(7,18,16,0.94))] shadow-[0_24px_60px_rgba(3,10,8,0.42)] backdrop-blur-2xl">
                    <div className="border-b border-white/8 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
                        {group.label}
                      </div>
                    </div>

                    <div className="space-y-1 px-2 py-2">
                      {group.items.map((item) => {
                        const isActive =
                          pathname === item.path ||
                          pathname.startsWith(`${item.path}/`);
                        const isItemOpen = openGroups[item.path] ?? isActive;
                        const ItemIcon = getItemIcon(item.slug);

                        return (
                          <div key={item.path} className="space-y-1">
                            {item.children?.length ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1">
                                  <Link
                                    href={item.path}
                                    className={clsx(
                                      "flex min-w-0 flex-1 items-center gap-3 rounded-[0.6rem] px-3 py-2.5 text-sm transition",
                                      isActive
                                        ? "bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                                        : "text-mist hover:bg-white/5 hover:text-ivory",
                                    )}
                                  >
                                    {ItemIcon ? <ItemIcon /> : null}
                                    <span>{item.label}</span>
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => toggleGroup(item.path)}
                                    className={clsx(
                                      "inline-flex h-10 w-10 items-center justify-center rounded-[0.6rem] transition",
                                      isActive || isItemOpen
                                        ? "bg-white/10 text-ivory"
                                        : "text-mist hover:bg-white/5 hover:text-ivory",
                                    )}
                                    aria-label={
                                      isItemOpen
                                        ? `Minimizar ${item.label}`
                                        : `Expandir ${item.label}`
                                    }
                                    title={
                                      isItemOpen
                                        ? `Minimizar ${item.label}`
                                        : `Expandir ${item.label}`
                                    }
                                  >
                                    <ChevronIcon open={isItemOpen} />
                                  </button>
                                </div>

                                {isItemOpen ? (
                                  <div className="space-y-1 pl-3">
                                    {item.children.map((child) => {
                                      const isChildActive =
                                        pathname === child.path ||
                                        pathname.startsWith(`${child.path}/`);
                                      const ChildIcon = getChildIcon(child.slug);

                                      return (
                                        <Link
                                          key={child.path}
                                          href={child.path}
                                          className={clsx(
                                            "flex items-center gap-3 rounded-[0.55rem] px-3 py-2 text-sm transition",
                                            isChildActive
                                              ? "bg-white/10 text-ivory"
                                              : "text-mist/80 hover:bg-white/5 hover:text-ivory",
                                          )}
                                        >
                                          {ChildIcon ? <ChildIcon /> : null}
                                          {!ChildIcon && child.iconLabel ? (
                                            <MonogramIcon
                                              label={child.iconLabel}
                                              wide={child.iconWide}
                                            />
                                          ) : null}
                                          <span>{child.label}</span>
                                        </Link>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <Link
                                href={item.path}
                                className={clsx(
                                  "flex items-center gap-3 rounded-[0.6rem] px-3 py-2.5 text-sm transition",
                                  isActive
                                    ? "bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                                    : "text-mist hover:bg-white/5 hover:text-ivory",
                                )}
                              >
                                {ItemIcon ? <ItemIcon /> : null}
                                <span>{item.label}</span>
                              </Link>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav ref={navRef} className="space-y-3">
      <div className="px-2 text-[11px] uppercase tracking-[0.28em] text-sage">Navegacao</div>

      <Link
        href="/inicio"
        className={clsx(
          "flex items-center gap-3 rounded-[0.65rem] px-4 py-3 text-sm font-medium transition",
          pathname === "/inicio"
            ? "border border-white/12 bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
            : "border border-transparent text-mist hover:border-white/8 hover:bg-white/5 hover:text-ivory",
        )}
      >
        <HomeIcon />
        <span>Inicio</span>
      </Link>

      <Link
        href="/ao-vivo"
        className={clsx(
          "flex items-center gap-3 rounded-[0.65rem] px-4 py-3 text-sm font-medium transition",
          pathname === "/ao-vivo"
            ? "border border-white/12 bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
            : "border border-transparent text-mist hover:border-white/8 hover:bg-white/5 hover:text-ivory",
        )}
      >
        <LiveIcon />
        <span>Ao Vivo</span>
      </Link>

      {portalSectionGroups.map((group) => {
        const isGroupActive = group.items.some(
          (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
        );
        const isOpen = openGroups[group.key];
        const Icon = group.key === "ebasketball" ? BasketballIcon : SoccerIcon;

        return (
          <details
            key={group.key}
            open={isOpen}
            className="rounded-[0.7rem] border border-white/8 bg-white/[0.03]"
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                toggleGroup(group.key);
              }}
              className={clsx(
                "flex list-none items-center justify-between rounded-[0.65rem] px-4 py-3 text-sm font-medium transition [&::-webkit-details-marker]:hidden",
                isGroupActive
                  ? "border-b border-white/8 bg-white/8 text-ivory"
                  : "text-mist hover:bg-white/5 hover:text-ivory",
              )}
            >
              <span className="flex items-center gap-3">
                <Icon />
                <span>{group.label}</span>
              </span>
              <ChevronIcon open={isOpen} />
            </summary>

            <div className="space-y-1 px-2 py-2">
              {group.items.map((item) => {
                const isActive = pathname === item.path || pathname.startsWith(`${item.path}/`);
                const isItemOpen = openGroups[item.path] ?? isActive;
                const ItemIcon = getItemIcon(item.slug);

                return (
                  <div key={item.path} className="space-y-1">
                    {item.children?.length ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Link
                            href={item.path}
                            className={clsx(
                              "flex min-w-0 flex-1 items-center gap-3 rounded-[0.6rem] px-3 py-2.5 text-sm transition",
                              isActive
                                ? "bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                                : "text-mist hover:bg-white/5 hover:text-ivory",
                            )}
                          >
                            {ItemIcon ? <ItemIcon /> : null}
                            <span>{item.label}</span>
                          </Link>
                          <button
                            type="button"
                            onClick={() => toggleGroup(item.path)}
                            className={clsx(
                              "inline-flex h-10 w-10 items-center justify-center rounded-[0.6rem] transition",
                              isActive || isItemOpen
                                ? "bg-white/10 text-ivory"
                                : "text-mist hover:bg-white/5 hover:text-ivory",
                            )}
                            aria-label={
                              isItemOpen
                                ? `Minimizar ${item.label}`
                                : `Expandir ${item.label}`
                            }
                            title={
                              isItemOpen
                                ? `Minimizar ${item.label}`
                                : `Expandir ${item.label}`
                            }
                          >
                            <ChevronIcon open={isItemOpen} />
                          </button>
                        </div>

                        {isItemOpen ? (
                          <div className="space-y-1 pl-3">
                            {item.children.map((child) => {
                              const isChildActive =
                                pathname === child.path ||
                                pathname.startsWith(`${child.path}/`);
                              const ChildIcon = getChildIcon(child.slug);

                              return (
                                <Link
                                  key={child.path}
                                  href={child.path}
                                  className={clsx(
                                    "flex items-center gap-3 rounded-[0.55rem] px-3 py-2 text-sm transition",
                                    isChildActive
                                      ? "bg-white/10 text-ivory"
                                      : "text-mist/80 hover:bg-white/5 hover:text-ivory",
                                  )}
                                >
                                  {ChildIcon ? <ChildIcon /> : null}
                                  {!ChildIcon && child.iconLabel ? (
                                    <MonogramIcon
                                      label={child.iconLabel}
                                      wide={child.iconWide}
                                    />
                                  ) : null}
                                  <span>{child.label}</span>
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <Link
                        href={item.path}
                        className={clsx(
                          "flex items-center gap-3 rounded-[0.6rem] px-3 py-2.5 text-sm transition",
                          isActive
                            ? "bg-ivory text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                            : "text-mist hover:bg-white/5 hover:text-ivory",
                        )}
                      >
                        {ItemIcon ? <ItemIcon /> : null}
                        <span>{item.label}</span>
                      </Link>
                    )}

                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
