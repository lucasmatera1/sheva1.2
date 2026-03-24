import { MetricBarChart } from "../../../components/charts/metric-bar-chart";
import { H2HSearchForm } from "../../../components/h2h/h2h-search-form";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { basketApiUrl, fetchApiFromBase } from "../../../lib/api";
import { formatDate, formatNumber, formatPercent } from "../../../lib/format";

export const dynamic = "force-dynamic";

type PlayerSuggestion = {
  id: string;
  name: string;
  totalGames: number;
};

type H2HResponse = {
  playerA: string;
  playerB: string;
  totalMatches: number;
  winsA: number;
  winsB: number;
  draws: number;
  goalsA: number;
  goalsB: number;
  averageGoals: number;
  averageGoalsA: number;
  averageGoalsB: number;
  over25Rate: number;
  bttsRate: number;
  dominance: number;
  goalBands: { over15Rate: number; over25Rate: number; over35Rate: number };
  leagueBreakdown: Array<{ leagueType: string; totalMatches: number; winsA: number; winsB: number; draws: number }>;
  recentForm: {
    playerA: { last5: { winRate: number }; last10: { winRate: number } };
    playerB: { last5: { winRate: number }; last10: { winRate: number } };
  };
  scorelines: Array<{ score: string; count: number }>;
  recentMatches: Array<{ matchId: string; playedAt: string; leagueType: string; homePlayer: string; awayPlayer: string; playerAScore: number; playerBScore: number; totalGoals: number; winner: string }>;
};

type BasketOpponentRow = {
  opponent: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  lossRate: number;
  balance: number;
  currentStreak: { type: "W" | "D" | "L"; count: number } | null;
  recentSequence: Array<"W" | "D" | "L">;
  longestNegativeStreak: number;
  mostDangerousHour: number | null;
  mostDangerousLeague: string | null;
  relationshipLabel: string;
  opponentDangerScore: number;
  latestPlayedAt: string | null;
};

type BasketAnalyticsResponse = {
  filters: {
    playerName?: string;
    opponentName?: string;
    leagueTypes?: string[];
    startDate?: string;
    endDate?: string;
    minGames?: number;
  };
  meta: {
    generatedAt: string;
    totalMatchesLoaded: number;
    totalMatchesFiltered: number;
    notes: string[];
  };
  data: BasketOpponentRow[];
};

function getRelationshipBadgeClass(value: string) {
  switch (value) {
    case "fregues":
      return "bg-[#20352e] text-white";
    case "carrasco":
    case "muito-perigoso":
      return "bg-[#7a3f34] text-white";
    case "equilibrado":
      return "bg-[#d7b07a] text-[#5a3814]";
    default:
      return "bg-[#d9d4c7] text-ink";
  }
}

function formatSequence(sequence: Array<"W" | "D" | "L">) {
  return sequence.join(" ");
}

export default async function H2HBasketPage({
  searchParams,
}: {
  searchParams: Promise<{ playerAId?: string; playerBId?: string; playerName?: string; startDate?: string; endDate?: string; minGames?: string }>;
}) {
  const params = await searchParams;
  const players = await fetchApiFromBase<PlayerSuggestion[]>(
    basketApiUrl,
    "/players?leagueType=H2H&limit=120&minGames=5&activeWithinDays=90&sortBy=games",
    { cache: "no-store", revalidate: false, timeoutMs: 20000 },
  );
  const suggestions = (players ?? []).map((player) => player.name);
  const playerAId = params.playerAId ?? suggestions[0] ?? "Mexican";
  const playerBId = params.playerBId ?? suggestions[1] ?? "Bear";
  const playerName = params.playerName ?? playerAId;
  const startDate = params.startDate ?? "";
  const endDate = params.endDate ?? "";
  const minGames = Number(params.minGames ?? "5") || 5;
  const analyticsSearch = new URLSearchParams({
    playerName,
    leagueTypes: "H2H",
    minGames: String(minGames),
  });
  if (startDate) analyticsSearch.set("startDate", startDate);
  if (endDate) analyticsSearch.set("endDate", endDate);
  const h2h = playerAId && playerBId
    ? await fetchApiFromBase<H2HResponse>(basketApiUrl, `/h2h?playerAId=${encodeURIComponent(playerAId)}&playerBId=${encodeURIComponent(playerBId)}&leagueType=H2H`, {
        cache: "no-store",
        revalidate: false,
        timeoutMs: 20000,
      })
    : null;
  const analytics = playerName
    ? await fetchApiFromBase<BasketAnalyticsResponse>(basketApiUrl, `/analytics/h2h?${analyticsSearch.toString()}`, {
        cache: "no-store",
        revalidate: false,
        timeoutMs: 20000,
      })
    : null;
  const opponentRows = analytics?.data ?? [];
  const topWinRateRows = [...opponentRows].sort((left, right) => right.winRate - left.winRate || right.totalGames - left.totalGames).slice(0, 10);
  const topDangerRows = [...opponentRows].sort((left, right) => right.opponentDangerScore - left.opponentDangerScore || right.lossRate - left.lossRate).slice(0, 5);
  const strongestEdge = topWinRateRows[0] ?? null;
  const biggestDanger = topDangerRows[0] ?? null;
  const balancedMatchup = [...opponentRows]
    .filter((row) => row.totalGames >= Math.max(minGames, 3))
    .sort((left, right) => Math.abs(left.balance) - Math.abs(right.balance) || right.totalGames - left.totalGames)[0] ?? null;
  const watchAlert = [...opponentRows]
    .filter((row) => row.currentStreak?.type === "L")
    .sort((left, right) => (right.currentStreak?.count ?? 0) - (left.currentStreak?.count ?? 0) || right.totalGames - left.totalGames)[0] ?? null;

  return (
    <AppShell
      eyebrow="H2H Basket"
      title="Comparador H2H Basket"
      description="Analise confronto direto no basket usando somente a base H2H. Compare dois nomes, filtre periodo e minimo de jogos, e acompanhe ranking de adversarios com alertas de confronto."
    >
      <SurfaceCard>
        <H2HSearchForm
          action="/h2h/basket"
          initialPlayerA={playerAId}
          initialPlayerB={playerBId}
          initialSuggestions={suggestions}
          leagueType="H2H"
          apiBaseUrl={basketApiUrl}
          activeWithinDays={90}
        />
      </SurfaceCard>

      <SurfaceCard>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Painel Basket</p>
            <h2 className="mt-2 font-display text-2xl text-ink">Ranking e alertas por jogador</h2>
          </div>
          <a href="/Disparidade/Basket" className="rounded-full bg-[#214d66] px-5 py-3 text-sm font-semibold text-white">
            Abrir Disparidade Basket
          </a>
        </div>

        <form method="get" action="/h2h/basket" className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.6fr_auto]">
          <label className="text-sm text-ink/72">
            Jogador base
            <input
              name="playerName"
              defaultValue={playerName}
              list="h2h-basket-player-suggestions"
              className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none"
            />
          </label>

          <label className="text-sm text-ink/72">
            Data inicial
            <input name="startDate" type="date" defaultValue={startDate} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" />
          </label>

          <label className="text-sm text-ink/72">
            Data final
            <input name="endDate" type="date" defaultValue={endDate} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" />
          </label>

          <label className="text-sm text-ink/72">
            Min. jogos
            <input name="minGames" type="number" min="1" defaultValue={String(minGames)} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" />
          </label>

          <button type="submit" className="rounded-full bg-[#214d66] px-5 py-3 text-sm font-semibold text-white lg:self-end">
            Atualizar
          </button>

          <datalist id="h2h-basket-player-suggestions">
            {suggestions.map((name) => (
              <option key={`basket-${name}`} value={name} />
            ))}
          </datalist>
        </form>
      </SurfaceCard>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard className="p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Jogador analisado</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{playerName}</p>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Adversarios filtrados</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(opponentRows.length)}</p>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Jogos filtrados</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(analytics?.meta.totalMatchesFiltered ?? 0)}</p>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Minimo por confronto</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(minGames)}</p>
        </SurfaceCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Alerta principal</p>
          <h2 className="mt-2 font-display text-2xl text-ink">Melhor media de vitorias</h2>
          {strongestEdge ? (
            <div className="mt-4 rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4 text-sm text-ink/78">
              <p className="text-lg font-semibold text-ink">{strongestEdge.opponent}</p>
              <p className="mt-2">{formatPercent(strongestEdge.winRate)} de vitórias em {formatNumber(strongestEdge.totalGames)} confrontos.</p>
              <p className="mt-2">Sequencia recente: {formatSequence(strongestEdge.recentSequence)}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink/68">Sem amostra suficiente no filtro atual.</p>
          )}
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Alerta de risco</p>
          <h2 className="mt-2 font-display text-2xl text-ink">Carrasco atual</h2>
          {biggestDanger ? (
            <div className="mt-4 rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4 text-sm text-ink/78">
              <p className="text-lg font-semibold text-ink">{biggestDanger.opponent}</p>
              <p className="mt-2">Loss rate de {formatPercent(biggestDanger.lossRate)} e score de risco {formatNumber(biggestDanger.opponentDangerScore)}.</p>
              <p className="mt-2">Maior sequencia negativa: {formatNumber(biggestDanger.longestNegativeStreak)}.</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink/68">Sem alerta de risco com o recorte atual.</p>
          )}
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Leitura de confronto</p>
          <h2 className="mt-2 font-display text-2xl text-ink">Sinais secundarios</h2>
          <div className="mt-4 space-y-3 text-sm text-ink/78">
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
              <p className="font-semibold text-ink">Confronto equilibrado</p>
              <p className="mt-1">{balancedMatchup ? `${balancedMatchup.opponent} com balance ${formatNumber(balancedMatchup.balance)} em ${formatNumber(balancedMatchup.totalGames)} jogos.` : "Sem confronto equilibrado suficiente no recorte."}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
              <p className="font-semibold text-ink">Pressao recente</p>
              <p className="mt-1">{watchAlert ? `${watchAlert.opponent} vem de ${formatNumber(watchAlert.currentStreak?.count ?? 0)} resultados ${watchAlert.currentStreak?.type} contra ${playerName}.` : "Nenhuma sequencia recente de alerta no filtro atual."}</p>
            </div>
          </div>
        </SurfaceCard>
      </section>

      {h2h ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["Confrontos", formatNumber(h2h.totalMatches)],
              ["Vitorias A", formatNumber(h2h.winsA)],
              ["Vitorias B", formatNumber(h2h.winsB)],
              ["Dominancia", formatPercent(h2h.dominance)],
            ].map(([label, value]) => (
              <SurfaceCard key={label} className="p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
              </SurfaceCard>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <SurfaceCard>
              <h2 className="font-display text-3xl text-ink">Resumo do duelo</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ["Pontos A", formatNumber(h2h.goalsA)],
                  ["Pontos B", formatNumber(h2h.goalsB)],
                  ["Media total", formatNumber(Number(h2h.averageGoals.toFixed(2)))],
                  ["Ambos pontuam", formatPercent(h2h.bttsRate)],
                  ["Over 2.5", formatPercent(h2h.over25Rate)],
                  ["Over 3.5", formatPercent(h2h.goalBands.over35Rate)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{label}</p>
                    <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <h2 className="font-display text-3xl text-ink">Forma recente no basket</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{h2h.playerA}</p>
                  <p className="mt-2 text-lg font-semibold text-ink">Last 5: {formatPercent(h2h.recentForm.playerA.last5.winRate)}</p>
                  <p className="mt-1 text-sm text-ink/68">Last 10: {formatPercent(h2h.recentForm.playerA.last10.winRate)}</p>
                </div>
                <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{h2h.playerB}</p>
                  <p className="mt-2 text-lg font-semibold text-ink">Last 5: {formatPercent(h2h.recentForm.playerB.last5.winRate)}</p>
                  <p className="mt-1 text-sm text-ink/68">Last 10: {formatPercent(h2h.recentForm.playerB.last10.winRate)}</p>
                </div>
              </div>
              <div className="mt-5 rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4 text-sm text-ink/72">
                <p>Placares mais comuns no basket:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {h2h.scorelines.map((row) => (
                    <span key={row.score} className="rounded-full border border-ink/10 bg-[#edf3df] px-3 py-2 text-ink">{row.score} ({formatNumber(row.count)})</span>
                  ))}
                </div>
              </div>
            </SurfaceCard>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Placar mais frequente</h2>
              <div className="mt-4">
                <MetricBarChart
                  data={h2h.scorelines.map((row) => ({ label: row.score, value: row.count }))}
                  labelKey="label"
                  valueKey="value"
                />
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Base usada</h2>
              <div className="mt-4 space-y-3 text-sm text-ink/75">
                <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                  <p className="font-semibold text-ink">Liga filtrada</p>
                  <p className="mt-1">H2H Basket</p>
                </div>
                {h2h.leagueBreakdown.map((row) => (
                  <div key={row.leagueType} className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{row.leagueType}</span>
                      <span>{formatNumber(row.totalMatches)} jogos</span>
                    </div>
                    <p className="mt-1">A {formatNumber(row.winsA)} | Empates {formatNumber(row.draws)} | B {formatNumber(row.winsB)}</p>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </section>

          <section>
            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Confrontos recentes no basket</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-ink/78">
                  <thead>
                    <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.2em] text-brand-strong">
                      <th className="py-3 pr-4">Data</th>
                      <th className="py-3 pr-4">Liga</th>
                      <th className="py-3 pr-4">Placar</th>
                      <th className="py-3 pr-4">Vencedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2h.recentMatches.map((match) => (
                      <tr key={match.matchId} className="border-b border-ink/10 last:border-0">
                        <td className="py-3 pr-4">{formatDate(match.playedAt)}</td>
                        <td className="py-3 pr-4">{match.leagueType}</td>
                        <td className="py-3 pr-4">{match.playerAScore}-{match.playerBScore}</td>
                        <td className="py-3 pr-4">{match.winner}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SurfaceCard>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Ranking de media de vitorias por confronto</h2>
              <div className="mt-4 overflow-x-auto rounded-[1.35rem] border border-ink/10 bg-white/50">
                {topWinRateRows.length ? (
                  <table className="min-w-full text-left text-sm text-ink/80">
                    <thead>
                      <tr className="border-b border-ink/10 bg-white/65 text-xs uppercase tracking-[0.18em] text-brand-strong">
                        <th className="px-4 py-4">#</th>
                        <th className="px-4 py-4">Adversario</th>
                        <th className="px-4 py-4">Jogos</th>
                        <th className="px-4 py-4">V</th>
                        <th className="px-4 py-4">E</th>
                        <th className="px-4 py-4">D</th>
                        <th className="px-4 py-4">Win rate</th>
                        <th className="px-4 py-4">Rotulo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topWinRateRows.map((row, index) => (
                        <tr key={`${row.opponent}-${row.latestPlayedAt ?? index}`} className="border-b border-ink/10 transition hover:bg-[#edf3df]/45 last:border-0">
                          <td className="px-4 py-4">{formatNumber(index + 1)}</td>
                          <td className="px-4 py-4 font-semibold text-ink">{row.opponent}</td>
                          <td className="px-4 py-4">{formatNumber(row.totalGames)}</td>
                          <td className="px-4 py-4">{formatNumber(row.wins)}</td>
                          <td className="px-4 py-4">{formatNumber(row.draws)}</td>
                          <td className="px-4 py-4">{formatNumber(row.losses)}</td>
                          <td className="px-4 py-4 font-semibold text-ink">{formatPercent(row.winRate)}</td>
                          <td className="px-4 py-4">
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getRelationshipBadgeClass(row.relationshipLabel)}`}>
                              {row.relationshipLabel}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-5 py-8 text-sm text-ink/68">Nenhum confronto atingiu o filtro atual de periodo e minimo de jogos.</div>
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Top carrascos do basket</h2>
              <div className="mt-4 space-y-3 text-sm text-ink/78">
                {topDangerRows.length ? topDangerRows.map((row) => (
                  <div key={`danger-${row.opponent}-${row.latestPlayedAt ?? row.totalGames}`} className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-ink">{row.opponent}</p>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getRelationshipBadgeClass(row.relationshipLabel)}`}>
                        {row.relationshipLabel}
                      </span>
                    </div>
                    <p className="mt-2">Loss rate {formatPercent(row.lossRate)} em {formatNumber(row.totalGames)} jogos.</p>
                    <p className="mt-1">Sequencia recente: {formatSequence(row.recentSequence)}</p>
                  </div>
                )) : <p className="text-sm text-ink/68">Sem carrascos suficientes no recorte atual.</p>}
              </div>
            </SurfaceCard>
          </section>

          {analytics?.meta.notes?.length ? (
            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Notas da analise</h2>
              <div className="mt-4 space-y-2 text-sm text-ink/72">
                {analytics.meta.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </SurfaceCard>
          ) : null}
        </>
      ) : (
        <SurfaceCard>
          <p className="text-sm text-ink/72">Nao foi possivel montar o comparativo com os nomes informados na base H2H.</p>
        </SurfaceCard>
      )}
    </AppShell>
  );
}