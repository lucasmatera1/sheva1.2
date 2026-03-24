// Script para verificação de sinais abertos após queda do app
// Local: apps/api/scripts/check-missing-signals.ts

import { AlertsService } from '../src/modules/alerts/alerts.service.ts';
import { prisma } from '../src/core/prisma.ts';

async function main() {
  const service = new AlertsService();
  // Executa dry-run para avaliar todos os sinais que deveriam existir
  const dryRunResult = await service.runRules({ dryRun: true, onlyActive: true, source: 'recovery-check' });

  // Busca todos os dispatches já enviados ou pendentes
  const allDispatches = await prisma.alert_method_dispatches.findMany({});
  const sentKeys = new Set(allDispatches.map(d => d.signalKey));

  // Filtra sinais que deveriam existir mas não têm dispatch
  const missingSignals = dryRunResult.signals.filter(sig => !sentKeys.has(sig.signalKey));

  if (missingSignals.length === 0) {
    console.log('Nenhum sinal aberto/pendente encontrado.');
    return;
  }

  console.log('Sinais abertos/pendentes detectados:');
  for (const sig of missingSignals) {
    console.log(`- ${sig.confrontationLabel} | ${sig.methodCode} | ${sig.occurrencePlayedAt}`);
  }

  // Opcional: aqui pode-se disparar novamente, ou só logar/alertar
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
