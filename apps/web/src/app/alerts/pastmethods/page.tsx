import Link from "next/link";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { apiUrl } from "../../../lib/api";
import { PastMethodsLogTable, type PastMethodLogRow } from "./past-methods-log-table";

export const dynamic = "force-dynamic";

type AlertDispatch = {
  id: string;
  methodCode: string | null;
  signalKey: string;
  confrontationLabel: string;
  occurrencePlayedAt: string;
  apx: number;
  totalOccurrences: number;
  eventType: "initial_signal" | "result_followup";
  payloadText: string;
};

type AlertDispatchPayload = {
  eventType?: "initial_signal" | "result_followup";
  signal?: {
    playerName?: string;
    groupLabel?: string | null;
    result?: string;
    fullTimeScore?: string;
    totalOccurrences?: number;
    apx?: number;
  };
};

export default async function PastMethodsPage() {
  const { data: dispatchesResponse, errorMessage } = await loadRecentDispatches();
  const rows = buildPastMethodRows(dispatchesResponse ?? []);
  const uniqueMethods = new Set(rows.map((row) => row.methodCode)).size;
  const uniqueConfrontations = new Set(rows.map((row) => row.confrontationLabel)).size;

  return (
    <AppShell
      eyebrow="Alertas"
      title="Metodos Recentes"
      description="Historico recente dos metodos finalizados, organizado em linhas simples e com filtros rapidos por metodo."
    >
      <div className="grid gap-5">
        <SurfaceCard>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Historico</p>
              <h2 className="mt-3 font-display text-3xl text-ink">Resultados recentes por metodo</h2>
              <p className="mt-3 text-sm leading-7 text-ink/68">Os filtros funcionam na propria tela, entao trocar de metodo fica instantaneo e sem nova chamada na API.</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/methods/alerts" className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20">
                Voltar para Alertas
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <MetricCard label="Registros" value={rows.length.toLocaleString("pt-BR")} />
            <MetricCard label="Metodos" value={uniqueMethods.toLocaleString("pt-BR")} />
            <MetricCard label="Confrontos" value={uniqueConfrontations.toLocaleString("pt-BR")} />
            <MetricCard label="Ultimo jogo" value={rows[0]?.playedAtLabel ?? "-"} />
          </div>
        </SurfaceCard>

        {dispatchesResponse === null ? (
          <SurfaceCard>
            <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-5 py-8 text-sm text-amber-900">
              Nao foi possivel carregar os logs recentes da API agora. {errorMessage ? `Detalhe: ${errorMessage}` : ""}
            </div>
          </SurfaceCard>
        ) : null}

        {rows.length ? (
          <PastMethodsLogTable rows={rows} />
        ) : (
          <SurfaceCard>
            <div className="rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
              Nenhum metodo finalizado foi persistido ainda.
            </div>
          </SurfaceCard>
        )}
      </div>
    </AppShell>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.1rem] border border-ink/10 bg-[#f7f4ec] px-4 py-4">
      <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">{label}</p>
      <p className="mt-2 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function buildPastMethodRows(dispatches: AlertDispatch[]): PastMethodLogRow[] {
  return dispatches
    .map((dispatch) => {
      const payload = parseDispatchPayload(dispatch.payloadText);
      const signal = payload?.signal;
      const normalizedResult = normalizeResult(signal?.result);
      if (!normalizedResult) {
        return null;
      }

      return {
        id: dispatch.id,
        methodCode: dispatch.methodCode?.trim() || "Sem metodo",
        playerName: normalizePlayerName(signal?.playerName, dispatch.confrontationLabel),
        series: normalizeSeries(signal?.groupLabel),
        playedAtIso: dispatch.occurrencePlayedAt,
        playedAtLabel: formatDateTime(dispatch.occurrencePlayedAt),
        confrontationLabel: dispatch.confrontationLabel,
        fullTimeScore: normalizeScore(signal?.fullTimeScore),
        apx: signal?.apx ?? dispatch.apx,
        totalOccurrences: signal?.totalOccurrences ?? dispatch.totalOccurrences,
        result: normalizedResult,
      };
    })
    .filter((row): row is PastMethodLogRow => row !== null)
    .sort((left, right) => new Date(right.playedAtIso).getTime() - new Date(left.playedAtIso).getTime());
}

async function loadRecentDispatches() {
  const firstAttempt = await requestRecentDispatches();
  if (firstAttempt.data) {
    return firstAttempt;
  }

  await wait(600);
  return requestRecentDispatches();
}

async function requestRecentDispatches(): Promise<{ data: AlertDispatch[] | null; errorMessage: string | null }> {
  try {
    const response = await fetch(`${apiUrl}/alerts/dispatches?limit=200`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return {
        data: null,
        errorMessage: `falha HTTP ${response.status}`,
      };
    }

    return {
      data: (await response.json()) as AlertDispatch[],
      errorMessage: null,
    };
  } catch (error) {
    return {
      data: null,
      errorMessage: error instanceof Error ? error.message : "falha de comunicacao com a API",
    };
  }
}

function parseDispatchPayload(value: string | null | undefined): AlertDispatchPayload | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as AlertDispatchPayload;
  } catch {
    return null;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function normalizeResult(value: string | undefined) {
  if (value === "W" || value === "D" || value === "L" || value === "E") {
    return value;
  }

  return null;
}

function normalizeScore(value: string | undefined) {
  if (value && /^\d+x\d+$/i.test(value.trim())) {
    return value.trim();
  }

  return "-";
}

function normalizePlayerName(value: string | undefined, confrontationLabel: string) {
  if (value?.trim()) {
    return value.trim();
  }

  const [playerName] = confrontationLabel.split(" x ");
  return playerName?.trim() || "Sem jogador";
}

function normalizeSeries(value: string | null | undefined) {
  if (!value?.trim()) {
    return "-";
  }

  const normalized = value.trim();
  const match = normalized.match(/group\s+([a-z0-9]+)/i);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }

  return normalized.replace(/^serie\s+/i, "").trim().toUpperCase();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
