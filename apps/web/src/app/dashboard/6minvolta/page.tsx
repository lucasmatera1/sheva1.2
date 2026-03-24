import { DashboardLeaguePage } from "../dashboard-shared";

export const dynamic = "force-dynamic";

export default async function DashboardVoltaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const refreshToken = typeof params?.ts === "string" ? params.ts : typeof params?.refresh === "string" ? params.refresh : undefined;

  return DashboardLeaguePage({
    leagueType: "6MIN VOLTA",
    activeRoutePath: "/dashboard/6minvolta",
    title: "6min - Volta",
    description: "Leitura da J operacional atual do Volta, listando os players da janela com W/D/L do dia e resumo final de aproveitamento.",
    refreshToken,
  });
}