import { PortalShell } from "@/components/portal-shell";
import { getPortalGTRaioX } from "@/lib/portal-api";
import { GTRaioXBoard } from "./gt-raio-x-board";

export default async function GTLeagueRaioXPage() {
  const xray = await getPortalGTRaioX({ timeoutMs: 5_000 });

  return (
    <PortalShell
      eyebrow="GT League"
      title="Raio X"
      description="Mapa dos pares H2H com equilibrio recorrente de vitórias nos ultimos 10 dias operacionais."
    >
      <GTRaioXBoard xray={xray} />
    </PortalShell>
  );
}
