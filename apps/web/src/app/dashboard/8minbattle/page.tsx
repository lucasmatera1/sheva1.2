import { DashboardLeaguePage } from "../dashboard-shared";

export const dynamic = "force-dynamic";

export default async function DashboardBattlePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const refreshToken = typeof params?.ts === "string" ? params.ts : typeof params?.refresh === "string" ? params.refresh : undefined;

  return DashboardLeaguePage({
    leagueType: "8MIN BATTLE",
    activeRoutePath: "/dashboard/8minbattle",
    title: "8min - Battle",
    description: "Painel dos jogadores ativos no Battle com recorte do dia, W/D/L por player e fechamento agregado no fim da pagina.",
    refreshToken,
  });
}