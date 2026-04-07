import Image from "next/image";
import { LoginForm } from "@/components/login-form";
import { readPortalSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await readPortalSession();

  if (session) {
    redirect("/");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const nextPath =
    resolvedSearchParams?.next && resolvedSearchParams.next.startsWith("/")
      ? resolvedSearchParams.next
      : "/";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <video
        className="login-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src="/media/login-background.mp4" type="video/mp4" />
      </video>
      <div className="login-backdrop" aria-hidden="true" />

      <div className="relative w-full max-w-[30rem]">
        <section className="login-card rounded-[0.85rem] px-6 py-8 sm:px-8 sm:py-10">
          <div className="space-y-8">
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center justify-center">
                <Image
                  src="/brand/bdb-logo.png"
                  alt="bDb Data Analysis"
                  width={2964}
                  height={1408}
                  priority
                  className="h-auto w-[10.5rem] object-contain sm:w-[11.75rem]"
                />
              </div>

              <div className="mt-6 space-y-3">
                <span className="inline-flex rounded-[0.7rem] border border-white/10 bg-white/5 px-4 py-1 text-[11px] uppercase tracking-[0.32em] text-sage">
                  Acesso privado
                </span>
                <h2 className="font-display text-5xl leading-none text-ivory">Entrar</h2>
                <p className="mx-auto max-w-sm text-sm leading-7 text-mist">
                  Use suas credenciais para acessar o portal.
                </p>
              </div>
            </div>

            <div className="login-inner-panel rounded-[0.85rem] p-4 sm:p-5">
              <LoginForm nextPath={nextPath} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
