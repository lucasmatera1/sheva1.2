import Link from "next/link";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { fetchApi } from "../../../lib/api";
import { FixtureLeagueNav, formatFixtureDate, getUpcomingFixturesData, type UpcomingLeagueFixture } from "../fixture-shared";

export const dynamic = "force-dynamic";

type VoltaFixtureViewMode = "today" | "next";
type VoltaFixtureSlotMode = "all" | "J1" | "J2" | "J3";

type VoltaCurrentSnapshotResponse = {
  warning?: string;
  fixtures: Array<{
    id: string;
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    seasonId: number | null;
  }>;
};

type VoltaConfrontationHistoryEntry = {
  id: string;
  playedAt: string;
  homePlayer: string;
  awayPlayer: string;
  seasonId: number | null;
  groupLabel: string | null;
};

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getSaoPauloDateParts(value: string | Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(typeof value === "string" ? new Date(value) : value);
  const getPart = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
  };
}

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatOperationalDayKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatFixtureTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function getPairKey(playerA: string, playerB: string) {
  return [playerA, playerB].sort((left, right) => left.localeCompare(right, "pt-BR")).join("::");
}

function getVoltaFixtureMeta(fixture: UpcomingLeagueFixture) {
  const parts = getSaoPauloDateParts(fixture.playedAt);
  const totalMinutes = parts.hour * 60 + parts.minute;
  const dayKey = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const operationalDayKey = totalMinutes < 113 ? shiftDateKey(dayKey, -1) : dayKey;
  const slot = totalMinutes < 113 ? "J3" : totalMinutes < 630 ? "J1" : totalMinutes < 1045 ? "J2" : "J3";

  return {
    operationalDayKey,
    slot,
  } as const;
}

function buildVoltaFilterHref(view: VoltaFixtureViewMode, slot: VoltaFixtureSlotMode) {
  return slot === "all" ? `/fixture/volta?view=${view}` : `/fixture/volta?view=${view}&slot=${slot}`;
}

export default async function FixtureVoltaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const { data, leagueMap } = await getUpcomingFixturesData();
  const rawView = getSearchParamValue(resolvedSearchParams.view);
  const rawSlot = getSearchParamValue(resolvedSearchParams.slot);
  const view: VoltaFixtureViewMode = rawView === "next" ? "next" : "today";
  const slot: VoltaFixtureSlotMode = rawSlot === "J1" || rawSlot === "J2" || rawSlot === "J3" ? rawSlot : "all";
  const currentOperationalDayKey = getVoltaFixtureMeta({
    id: "now",
    seasonId: null,
    playedAt: new Date().toISOString(),
    homePlayer: "",
    awayPlayer: "",
    groupLabel: null,
  }).operationalDayKey;
  const currentSnapshot = view === "today"
    ? await fetchApi<VoltaCurrentSnapshotResponse>("/dashboard/current-j?league=6MIN%20VOLTA&refresh=1", { revalidate: false, cache: "no-store" })
    : null;
  const voltaLeague = leagueMap.get("6MIN VOLTA") ?? { leagueType: "6MIN VOLTA", totalFixtures: 0, fixtures: [] };
  const filteredFixtures = voltaLeague.fixtures.filter((fixture) => {
    const meta = getVoltaFixtureMeta(fixture);
    const matchesView = view === "today" ? meta.operationalDayKey === currentOperationalDayKey : meta.operationalDayKey > currentOperationalDayKey;
    const matchesSlot = slot === "all" ? true : meta.slot === slot;

    return matchesView && matchesSlot;
  });
  const currentDayHistoryFixtures = (currentSnapshot?.fixtures ?? []).map((fixture) => ({
    id: fixture.id,
    seasonId: fixture.seasonId,
    playedAt: fixture.playedAt,
    homePlayer: fixture.homePlayer,
    awayPlayer: fixture.awayPlayer,
    groupLabel: null,
  }));
  const confrontationHistoryMap = view === "today" && filteredFixtures.length > 0
    ? new Map(
        (
          await Promise.all(
            Array.from(
              new Map(filteredFixtures.map((fixture) => [getPairKey(fixture.homePlayer, fixture.awayPlayer), fixture])).values(),
            ).map(async (fixture) => {
              const history = await fetchApi<VoltaConfrontationHistoryEntry[]>(
                `/dashboard/confrontation-history?league=6MIN%20VOLTA&player=${encodeURIComponent(fixture.homePlayer)}&opponent=${encodeURIComponent(fixture.awayPlayer)}`,
                { revalidate: false, cache: "no-store" },
              );

              return [getPairKey(fixture.homePlayer, fixture.awayPlayer), history ?? []] as const;
            }),
          )
        ).map(([pairKey, history]) => [pairKey, history]),
      )
    : new Map<string, VoltaConfrontationHistoryEntry[]>();
  const availableDays = Array.from(new Set(voltaLeague.fixtures.map((fixture) => getVoltaFixtureMeta(fixture).operationalDayKey))).sort();
  const visibleDays = Array.from(new Set(filteredFixtures.map((fixture) => getVoltaFixtureMeta(fixture).operationalDayKey))).sort();
  const dayLabel = view === "today"
    ? `Hoje operacional: ${formatOperationalDayKey(currentOperationalDayKey)}`
    : visibleDays.length > 0
      ? `Proximos dias operacionais: ${visibleDays.map((day) => formatOperationalDayKey(day)).join(", ")}`
      : "Proximos dias operacionais: nenhum dia encontrado";

  return (
    <AppShell
      eyebrow="Fixture"
      title="6min - Volta"
      description="Leitura dedicada dos futurematches de 6MIN VOLTA, separada das outras categorias."
    >
      <FixtureLeagueNav leagueMap={leagueMap} activeRoutePath="/fixture/volta" />
      <SurfaceCard>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Categoria isolada</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Fixtures apenas de 6min - Volta</h2>
          </div>
          <Link href="/fixture" className="rounded-full border border-ink/10 bg-white px-5 py-2 text-sm font-semibold text-ink/72 transition hover:border-ink/20 hover:text-ink">
            Ver todas
          </Link>
        </div>

        {data?.warning ? (
          <div className="mt-5 rounded-[1.1rem] border border-amber-400/25 bg-amber-50/70 px-4 py-4 text-sm text-ink/72">
            {data.warning}
          </div>
        ) : null}

        {view === "today" && currentSnapshot?.warning ? (
          <div className="mt-5 rounded-[1.1rem] border border-amber-400/25 bg-amber-50/70 px-4 py-4 text-sm text-ink/72">
            {currentSnapshot.warning}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Janela de datas</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href={buildVoltaFilterHref("today", slot)} className={`rounded-full px-5 py-2 text-sm font-semibold transition ${view === "today" ? "bg-[#7a3f34] text-white" : "border border-ink/10 bg-white text-ink/72 hover:border-ink/20 hover:text-ink"}`}>
                Hoje operacional
              </Link>
              <Link href={buildVoltaFilterHref("next", slot)} className={`rounded-full px-5 py-2 text-sm font-semibold transition ${view === "next" ? "bg-[#7a3f34] text-white" : "border border-ink/10 bg-white text-ink/72 hover:border-ink/20 hover:text-ink"}`}>
                Proximos dias operacionais
              </Link>
            </div>
            <p className="mt-3 text-sm text-ink/68">{dayLabel}. Total de dias disponiveis na fila: {availableDays.length}.</p>
          </div>

          <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Filtro por janela</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {(["all", "J1", "J2", "J3"] as const).map((slotOption) => (
                <Link
                  key={slotOption}
                  href={buildVoltaFilterHref(view, slotOption)}
                  className={`rounded-full px-5 py-2 text-sm font-semibold transition ${slot === slotOption ? "bg-[#7a3f34] text-white" : "border border-ink/10 bg-white text-ink/72 hover:border-ink/20 hover:text-ink"}`}
                >
                  {slotOption === "all" ? "Todos" : slotOption}
                </Link>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink/68">Escolha para ver apenas partidas de J1, J2 ou J3 dentro do recorte atual.</p>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Liga</p>
            <h2 className="mt-2 font-display text-3xl text-ink">6min - Volta</h2>
            <p className="mt-2 text-sm text-ink/68">{filteredFixtures.length} fixture(s) futuro(s) encontrado(s).</p>
          </div>
          <span className="rounded-full bg-[#7a3f34] px-3 py-2 text-xs font-semibold text-white">V6</span>
        </div>

        {filteredFixtures.length === 0 ? (
          <div className="mt-5 rounded-[1.1rem] border border-dashed border-ink/15 bg-white/45 px-4 py-6 text-sm text-ink/58">
            Nenhum fixture encontrado para este filtro.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {filteredFixtures.map((fixture) => {
              const meta = getVoltaFixtureMeta(fixture);
              const pairKey = getPairKey(fixture.homePlayer, fixture.awayPlayer);
              const sameDayHistorySource = view === "today"
                ? Array.from(
                    new Map(
                      [...(confrontationHistoryMap.get(pairKey) ?? []), ...currentDayHistoryFixtures].map((match) => [match.id, match]),
                    ).values(),
                  )
                : voltaLeague.fixtures;
              const previousSameDayMatches = sameDayHistorySource
                .filter((candidate) => getPairKey(candidate.homePlayer, candidate.awayPlayer) === pairKey)
                .filter((candidate) => getVoltaFixtureMeta(candidate).operationalDayKey === meta.operationalDayKey)
                .filter((candidate) => candidate.seasonId === fixture.seasonId)
                .filter((candidate) => new Date(candidate.playedAt).getTime() < new Date(fixture.playedAt).getTime())
                .sort((left, right) => new Date(right.playedAt).getTime() - new Date(left.playedAt).getTime());

              return (
                <article key={fixture.id} className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4 shadow-[0_1px_0_rgba(32,31,27,0.04)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">{formatFixtureDate(fixture.playedAt)}</p>
                        <p className="text-base font-semibold text-ink">{formatFixtureTime(fixture.playedAt)} · {fixture.homePlayer} x {fixture.awayPlayer}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink/70">
                        <span className="rounded-full border border-ink/10 bg-white px-3 py-1 font-semibold">Dia operacional {formatOperationalDayKey(meta.operationalDayKey)}</span>
                        <span className="rounded-full border border-ink/10 bg-white px-3 py-1 font-semibold">{previousSameDayMatches.length} confronto(s) anteriores no dia</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="rounded-full bg-[#7a3f34] px-3 py-1 text-xs font-semibold text-white">{meta.slot}</span>
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink/72">{formatOperationalDayKey(meta.operationalDayKey)}</span>
                    </div>
                  </div>

                  <details className="mt-4 group rounded-[1rem] border border-ink/10 bg-white/68">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                      <span>Ver confrontos anteriores do mesmo dia</span>
                      <span className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-brand-strong">
                        <span>{previousSameDayMatches.length}</span>
                        <span className="inline-block transition-transform duration-200 group-open:rotate-180">▾</span>
                      </span>
                    </summary>
                    <div className="border-t border-ink/10 px-4 py-4">
                      {previousSameDayMatches.length === 0 ? (
                        <p className="text-sm text-ink/58">Sem confrontos anteriores entre esses jogadores neste mesmo dia operacional.</p>
                      ) : (
                        <div className="space-y-3">
                          {previousSameDayMatches.map((match) => (
                            <div key={match.id} className="rounded-[0.95rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink/78">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">{formatFixtureDate(match.playedAt)}</p>
                                <p className="font-semibold text-ink">{match.homePlayer} x {match.awayPlayer}</p>
                                <p className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink/72">{getVoltaFixtureMeta(match).slot}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-4">
                        <Link
                          href={`/fixture/volta?view=${view}&slot=${slot === "all" ? "all" : slot}`}
                          className="inline-flex rounded-full border border-ink/10 bg-white px-5 py-2 text-sm font-semibold text-ink/72 transition hover:border-ink/20 hover:text-ink"
                        >
                          Voltar ao filtro atual
                        </Link>
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </SurfaceCard>
    </AppShell>
  );
}