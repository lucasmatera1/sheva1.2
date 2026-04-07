import { notFound } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { getPortalSection } from "@/lib/portal-sections";

type SectionPageProps = {
  params: Promise<{
    league: string;
  }>;
};

export default async function EBasketballLeaguePage({ params }: SectionPageProps) {
  const { league } = await params;
  const section = getPortalSection("ebasketball", league);

  if (!section) {
    notFound();
  }

  return (
    <PortalShell eyebrow={section.group.label} title={section.item.label}>
      <section />
    </PortalShell>
  );
}
