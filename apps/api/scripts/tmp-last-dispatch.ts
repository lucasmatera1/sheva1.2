import { config } from "dotenv";
config({ path: "../../.env" });

const botToken = process.env.TELEGRAM_BOT_TOKEN!;
const chatId = process.env.TELEGRAM_DEFAULT_CHAT_IDS!;

// Simula o formato novo de mensagem futura de confrontação (2D+)
const testMessageFutureConfrontation = [
  `<b>GT LEAGUE | (2D+)</b>`,
  `<b>Confronto:</b> Razvan x Kevin`,
  `<b>APX:</b> 100.00%`,
  `<b>Ocorrencias:</b> 2`,
  `<b>Resultados ocorrencias:</b> W W`,
  `<b>Proximo jogo:</b> 20/03/2026, 20:15:00`,
  `<b>Resultado:</b> pendente`,
  `<b>Gatilho metodo:</b> L L`,
  `<b>Historico sequencia dia JOGADOR:</b> W L D W L L`,
  `<b>Historico sequencia dia CONFRONTO:</b> W W L L`,
  `<b>WR jogador (21d):</b> 52.38%`,
  `<b>WR oponente (21d):</b> 41.67%`,
  `<b>H2H (48j):</b> 62.50% (48j: 30W)`,
  `<b>H2H (24j):</b> 58.33% (24j: 14W)`,
  `<b>Delta H2H:</b> +4.2pp`,
  `<b>Janela:</b> ultimos 21 dias`,
].join("\n");

// Simula o formato novo de mensagem futura de player session (4W)
const testMessageFuturePlayerSession = [
  `<b>GT LEAGUE | 4W Jogador</b>`,
  `<b>Jogador:</b> Eros`,
  `<b>Oponente:</b> Crysis`,
  `<b>APX:</b> 85.71%`,
  `<b>Ocorrencias:</b> 7`,
  `<b>Resultados ocorrencias:</b> W W W L W W W`,
  `<b>Proximo jogo:</b> 20/03/2026, 21:30:00`,
  `<b>Resultado:</b> pendente`,
  `<b>Gatilho jogador:</b> W W W W`,
  `<b>Historico sequencia dia/sessao:</b> W W D W L W W W W`,
  `<b>WR jogador (21d):</b> 66.67%`,
  `<b>WR oponente (21d):</b> 33.33%`,
  `<b>H2H (48j):</b> 70.83% (48j: 34W)`,
  `<b>H2H (24j):</b> 75.00% (24j: 18W)`,
  `<b>Delta H2H:</b> -4.2pp`,
  `<b>Janela:</b> ultimos 21 dias`,
].join("\n");

// Simula o formato de resultado confirmado (confrontação)
const testMessageResolved = [
  `<b>Resultado confirmado</b>`,
  `<b>GT LEAGUE | (2D+)</b>`,
  `<b>Confronto:</b> Razvan x Kevin`,
  `<b>APX:</b> 100.00% → 85.71% | <b>Delta:</b> -14.29%`,
  `<b>Ocorrencias:</b> 2 → 3`,
  `<b>Resultados ocorrencias:</b> W W L`,
  `<b>Jogo realizado:</b> 20/03/2026, 20:15:00 | <b>Resultado:</b> L | <b>Placar:</b> 1-2`,
  `<b>Gatilho metodo:</b> L L`,
  `<b>Historico sequencia dia JOGADOR:</b> W L D W L L`,
  `<b>Historico sequencia dia CONFRONTO:</b> W W L L`,
  `<b>Alerta futuro original:</b> 20/03/2026, 18:00:00`,
  `<b>Janela:</b> ultimos 21 dias`,
].join("\n");

async function sendTest(label: string, message: string) {
  console.log(`\n--- Enviando: ${label} ---`);
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  console.log(res.ok ? "OK" : `ERRO: ${JSON.stringify(data)}`);
}

async function main() {
  await sendTest("Sinal futuro confrontacao (2D+)", testMessageFutureConfrontation);
  await sendTest("Sinal futuro player session (4W)", testMessageFuturePlayerSession);
  await sendTest("Resultado confirmado", testMessageResolved);
  console.log("\nTodos enviados!");
}

main();
