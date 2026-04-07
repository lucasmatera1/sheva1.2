import { PortalShell } from "@/components/portal-shell";
import { getPortalGTLiveTable } from "@/lib/portal-api";
import { GTLeagueLiveBoard } from "./gt-league-live-board";

export default async function GTLeaguePage() {
  const liveTable = await getPortalGTLiveTable({
    timeoutMs: 5_000,
    historyDays: 30,
  });

  return (
    <PortalShell
      eyebrow="GT League"
      title="GT League"
      description="Leitura dos confrontos do dia operacional atual, com distribuicao historica de placares, over, ambos marcam e sequencia recente. Os placares corretos e o historico recente seguem a perspectiva do jogador 1."
    >
      <GTLeagueLiveBoard liveTable={liveTable} />
    </PortalShell>
  );
}
