process.env.SHEVA_APP_SCOPE = "basket";
process.env.SHEVA_H2H_SOURCE = "ebasket";

const { basketApp } = await import("./app-basket");

const port = Number(process.env.BASKET_API_PORT || 4013);

const server = basketApp.listen(port);

server.once("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Porta ${port} ja esta em uso. Mantenha apenas uma instancia da Basket API rodando.`);
    process.exit(1);
  }

  console.error("Falha ao iniciar a Basket API", error);
  process.exit(1);
});

server.once("listening", () => {
  console.log(`Basket API online na porta ${port}`);
});