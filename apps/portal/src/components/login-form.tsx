"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { authenticateAction, type LoginActionState } from "@/app/login/actions";

const initialState: LoginActionState = {
  error: null,
};

function MailIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M4.25 5.25h11.5A1.25 1.25 0 0 1 17 6.5v7A1.25 1.25 0 0 1 15.75 14.75H4.25A1.25 1.25 0 0 1 3 13.5v-7a1.25 1.25 0 0 1 1.25-1.25Z" stroke="currentColor" strokeWidth="1.45" />
      <path d="m4 6 6 4.5L16 6" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M6.5 8V6.75a3.5 3.5 0 1 1 7 0V8" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <rect x="4.25" y="8" width="11.5" height="8.25" rx="1.5" stroke="currentColor" strokeWidth="1.45" />
      <path d="M10 11v2.25" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-[0.8rem] bg-gradient-to-r from-ivory via-sand to-gold px-4 py-3.5 text-sm font-semibold uppercase tracking-[0.24em] text-obsidian shadow-[0_10px_30px_rgba(6,12,10,0.18)] transition hover:from-[#edf2de] hover:via-[#bdf7d3] hover:to-[#6ff0a6] hover:shadow-[0_0_26px_rgba(111,240,166,0.34)] disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Validando..." : "Entrar"}
    </button>
  );
}

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction] = useActionState(authenticateAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={nextPath} />

      <label className="block space-y-2.5">
        <span className="text-[11px] uppercase tracking-[0.28em] text-sage">Email ou usuário</span>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sage/75">
            <MailIcon />
          </span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            className="w-full rounded-[0.8rem] border border-white/10 bg-black/20 px-12 py-3.5 text-sm text-ivory outline-none transition placeholder:text-mist/35 focus:border-gold/40 focus:bg-black/25"
            placeholder="Seu email ou usuário"
            required
          />
        </div>
      </label>

      <label className="block space-y-2.5">
        <span className="text-[11px] uppercase tracking-[0.28em] text-sage">Senha</span>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sage/75">
            <LockIcon />
          </span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            className="w-full rounded-[0.8rem] border border-white/10 bg-black/20 px-12 py-3.5 text-sm text-ivory outline-none transition placeholder:text-mist/35 focus:border-gold/40 focus:bg-black/25"
            placeholder="Sua senha"
            required
          />
        </div>
      </label>

      {state.error ? (
        <div className="rounded-[0.8rem] border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral">{state.error}</div>
      ) : null}

      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="flex items-center justify-between gap-4 text-sm">
        <label className="inline-flex items-center gap-2 text-mist">
          <input
            type="checkbox"
            name="remember"
            className="h-4 w-4 rounded border border-white/20 bg-transparent accent-[#7af1b0]"
          />
          <span>Lembre-me</span>
        </label>

        <Link href="/forgot-password" className="text-sage transition hover:text-gold">
          Esqueceu a senha?
        </Link>
      </div>

      <SubmitButton />
    </form>
  );
}
