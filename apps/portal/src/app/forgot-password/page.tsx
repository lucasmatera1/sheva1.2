import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div className="login-backdrop" aria-hidden="true" />

      <div className="relative w-full max-w-[28rem]">
        <section className="login-card rounded-[0.85rem] px-6 py-8 sm:px-8 sm:py-10">
          <div className="space-y-5 text-center">
            <span className="inline-flex rounded-[0.7rem] border border-white/10 bg-white/5 px-4 py-1 text-[11px] uppercase tracking-[0.32em] text-sage">
              Recuperacao
            </span>
            <h1 className="font-display text-5xl leading-none text-ivory">Esqueceu a senha?</h1>
            <p className="mx-auto max-w-md text-sm leading-7 text-mist">
              Este fluxo ainda sera estruturado. Por enquanto, faça a redefinicao manual no ambiente do portal.
            </p>

            <div className="pt-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-[0.8rem] border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-ivory transition hover:border-gold/40 hover:text-gold"
              >
                Voltar para o login
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
