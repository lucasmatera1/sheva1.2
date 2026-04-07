import { LiveSignalsBoard } from "@/components/live-signals-board";
import { PortalShell } from "@/components/portal-shell";
import { getPortalInitialOpenSignals } from "@/lib/portal-api";

const DEFAULT_PORTAL_LIVE_LEAGUES = [
  "GT LEAGUE",
  "8MIN BATTLE",
  "6MIN VOLTA",
  "H2H",
];

export default async function AoVivoPage() {
  const initialSignals = await getPortalInitialOpenSignals({
    leagueTypes: DEFAULT_PORTAL_LIVE_LEAGUES,
  });

  return (
    <PortalShell title="Ao Vivo" eyebrow="Sinais ativos" hidePageHeader>
      <LiveSignalsBoard signals={initialSignals} />
    </PortalShell>
  );
}
