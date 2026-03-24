import { DashboardLeaguePage } from "../dashboard-shared";

export const dynamic = "force-dynamic";

export default async function DashboardGtLeaguePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const refreshToken = typeof params?.ts === "string" ? params.ts : typeof params?.refresh === "string" ? params.refresh : undefined;
  const selectedGroup = typeof params?.group === "string" ? params.group : undefined;
  const selectedView = params?.view === "future" ? "future" : "recent";
  const selectedDayKey = typeof params?.day === "string" ? params.day : undefined;

  return DashboardLeaguePage({
    leagueType: "GT LEAGUE",
    activeRoutePath: "/dashboard/gtleague",
    title: "GT League",
    description: "Jogadores presentes na J atual do GT, com W/D/L do dia e fechamento final de aproveitamento.",
    refreshToken,
    selectedGroup,
    selectedView,
    selectedDayKey,
  });
}