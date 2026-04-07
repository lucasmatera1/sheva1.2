"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { PortalNav } from "@/components/portal-nav";

type PortalSidebarLayoutProps = {
  pageHeader?: React.ReactNode;
  children: React.ReactNode;
};

const PORTAL_SIDEBAR_STATE_KEY = "portal-sidebar-collapsed";

function SidebarChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={clsx(
        "h-4 w-4 transition-transform",
        collapsed ? "rotate-180" : "rotate-0",
      )}
    >
      <path
        d="M12.5 4.75 7.25 10l5.25 5.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PortalSidebarLayout({
  pageHeader,
  children,
}: PortalSidebarLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const storedValue =
      typeof window !== "undefined"
        ? window.localStorage.getItem(PORTAL_SIDEBAR_STATE_KEY)
        : null;

    if (storedValue === "true") {
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          PORTAL_SIDEBAR_STATE_KEY,
          String(next),
        );
      }

      return next;
    });
  };

  return (
    <div
      className={clsx(
        "grid min-h-[calc(100vh-6rem)] gap-4 px-2 sm:px-3 lg:px-4",
        collapsed
          ? "lg:grid-cols-[84px_minmax(0,1fr)]"
          : "lg:grid-cols-[248px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={clsx(
          "glass-panel h-fit rounded-[0.75rem] py-5 lg:sticky lg:top-[5.75rem]",
          collapsed ? "px-3" : "px-4",
        )}
      >
        <div
          className={clsx(
            "mb-4 flex",
            collapsed ? "justify-center" : "justify-end",
          )}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expandir menu" : "Minimizar menu"}
            aria-label={collapsed ? "Expandir menu" : "Minimizar menu"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[0.65rem] border border-white/10 bg-white/5 text-mist transition hover:border-white/16 hover:bg-white/8 hover:text-ivory"
          >
            <SidebarChevronIcon collapsed={collapsed} />
          </button>
        </div>

        <PortalNav collapsed={collapsed} />
      </aside>

      <section className="space-y-4">
        {pageHeader ? pageHeader : null}
        <div className="space-y-4">{children}</div>
      </section>
    </div>
  );
}
