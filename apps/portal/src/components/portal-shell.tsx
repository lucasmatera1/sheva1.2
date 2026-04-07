import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { PortalSidebarLayout } from "@/components/portal-sidebar-layout";
import { PortalThemeToggle } from "@/components/portal-theme-toggle";
import { readPortalSession } from "@/lib/auth/session";

type PortalShellProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  hidePageHeader?: boolean;
  children: React.ReactNode;
};

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-mist">
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-mist">
      <path d="M10 10.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.75 16.25c1.15-2.15 3.03-3.25 5.25-3.25s4.1 1.1 5.25 3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-mist">
      <path d="M12.75 6.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11.75 9.5 4 4m0 0v-2m0 2h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-coral">
      <path d="M8 5.25H6.75A1.75 1.75 0 0 0 5 7v6a1.75 1.75 0 0 0 1.75 1.75H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m10.5 13.75 3.75-3.75-3.75-3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.25 10H8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export async function PortalShell({
  eyebrow,
  title,
  description,
  hidePageHeader = false,
  children,
}: PortalShellProps) {
  const session = await readPortalSession();

  if (!session) {
    redirect("/login");
  }

  const initials = session.username.slice(0, 2).toUpperCase();
  const pageHeader =
    !hidePageHeader && (eyebrow || title || description) ? (
      <header className="glass-panel rounded-[0.75rem] px-6 py-6">
        {eyebrow ? (
          <div className="text-xs uppercase tracking-[0.28em] text-sage">
            {eyebrow}
          </div>
        ) : null}
        {title ? (
          <h2 className="mt-3 font-display text-[2.85rem] leading-[0.95] text-ivory">
            {title}
          </h2>
        ) : null}
        {description ? (
          <p className="mt-4 max-w-3xl text-sm leading-7 text-mist sm:text-[0.95rem]">
            {description}
          </p>
        ) : null}
      </header>
    ) : null;

  return (
    <main className="min-h-screen px-0 py-0">
      <div className="w-full">
        <div className="glass-panel sticky top-0 z-40 mb-4 flex min-h-16 w-full items-center justify-between gap-4 rounded-none px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/inicio" className="shrink-0">
              <Image
                src="/brand/bdb-logo.png"
                alt="bDb Data Analysis"
                width={2964}
                height={1408}
                priority
                className="h-auto w-[7rem] object-contain sm:w-[7.75rem]"
              />
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <PortalThemeToggle />

            <details className="group relative">
              <summary className="flex list-none cursor-pointer items-center gap-3 rounded-[0.65rem] border border-white/10 bg-white/5 px-3 py-2 transition hover:border-white/16 hover:bg-white/7 [&::-webkit-details-marker]:hidden">
                <div className="flex h-10 w-10 items-center justify-center rounded-[0.65rem] bg-white/10 text-sm font-semibold uppercase tracking-[0.18em] text-ivory">
                  {initials}
                </div>
                <div className="hidden min-w-0 text-left sm:block">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Minha conta</div>
                  <div className="max-w-[10rem] truncate text-sm font-semibold text-ivory">{session.username}</div>
                </div>
                <ChevronDownIcon />
              </summary>

              <div className="absolute right-0 top-[calc(100%+0.75rem)] w-64 overflow-hidden rounded-[0.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,26,22,0.96),rgba(7,18,16,0.94))] shadow-[0_24px_60px_rgba(3,10,8,0.42)] backdrop-blur-2xl">
                <div className="border-b border-white/8 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Minha conta</div>
                  <div className="mt-1 text-sm font-semibold text-ivory">{session.username}</div>
                </div>

                <div className="px-2 py-2">
                  <Link
                    href="/account/password"
                    className="flex items-center gap-3 rounded-[0.6rem] px-3 py-3 text-sm text-mist transition hover:bg-white/5 hover:text-ivory"
                  >
                    <KeyIcon />
                    <span>Alterar senha</span>
                  </Link>
                  <Link
                    href="/account/profile"
                    className="flex items-center gap-3 rounded-[0.6rem] px-3 py-3 text-sm text-mist transition hover:bg-white/5 hover:text-ivory"
                  >
                    <UserIcon />
                    <span>Dados cadastrais</span>
                  </Link>
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      className="flex w-full items-center gap-3 rounded-[0.6rem] px-3 py-3 text-left text-sm text-coral transition hover:bg-coral/8"
                    >
                      <LogoutIcon />
                      <span>Sair da conta</span>
                    </button>
                  </form>
                </div>
              </div>
            </details>
          </div>
        </div>

        <PortalSidebarLayout pageHeader={pageHeader}>
          {children}
        </PortalSidebarLayout>
      </div>
    </main>
  );
}
