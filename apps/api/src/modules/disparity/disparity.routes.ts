import { Router } from "express";
import { DisparityService } from "./disparity.service";

const router = Router();
const service = new DisparityService();

router.get("/:mode", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response.status(404).json({ message: "Modo de disparidade nao encontrado" });
      return;
    }

    response.json(await service.listPlayers(mode, typeof request.query.q === "string" ? request.query.q : undefined));
  } catch (error) {
    next(error);
  }
});

router.get("/:mode/:playerId", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response.status(404).json({ message: "Modo de disparidade nao encontrado" });
      return;
    }

    const result = await service.getPlayer(mode, request.params.playerId, {
      forceRefresh: request.query.forceRefresh === "1",
    });

    if (!result) {
      response.status(404).json({ message: "Jogador nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as disparityRouter };