import { PortalShell } from "@/components/portal-shell";
import { getPortalGTPastMethods } from "@/lib/portal-api";
import { GTPastMethodsBoard } from "./gt-past-methods-board";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GTLeagueMetodosPage() {
  const { rows, lastSuccessfulSyncAt, lastPublishedAt } =
    await getPortalGTPastMethods();

  return (
    <PortalShell title="Metodos" eyebrow="GT League" hidePageHeader>
      <GTPastMethodsBoard
        rows={rows}
        lastSuccessfulSyncAt={lastSuccessfulSyncAt}
        lastPublishedAt={lastPublishedAt}
      />
    </PortalShell>
  );
}
