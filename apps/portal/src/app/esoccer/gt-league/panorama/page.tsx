import { PortalShell } from "@/components/portal-shell";
import { getPortalGTPanorama } from "@/lib/portal-api";
import { GTPanoramaBoard } from "./gt-panorama-board";

export default async function GTLeaguePanoramaPage() {
  const panorama = await getPortalGTPanorama();

  return (
    <PortalShell hidePageHeader>
      <GTPanoramaBoard panorama={panorama} />
    </PortalShell>
  );
}
