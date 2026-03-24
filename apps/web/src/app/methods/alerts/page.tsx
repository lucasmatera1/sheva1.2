import { AppShell } from "../../../components/shell/app-shell";
import { MethodAlertsManager } from "./method-alerts-manager";

export const dynamic = "force-dynamic";

export default function MethodAlertsPage() {
  return (
    <AppShell
      eyebrow="Metodos"
      title="Alertas de Metodo"
      description="Cadastre regras por metodo, rode a avaliacao manual e acompanhe os disparos preparados para o webhook do WhatsApp."
    >
      <MethodAlertsManager />
    </AppShell>
  );
}