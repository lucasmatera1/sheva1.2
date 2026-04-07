import { Router } from "express";
import { createLogger } from "../../core/logger";
import { DisparityService } from "./disparity.service";

const log = createLogger("panorama");

const router = Router();
const service = new DisparityService();

router.get("/:mode", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response
        .status(404)
        .json({ message: "Modo de disparidade nao encontrado" });
      return;
    }

    response.json(
      await service.listPlayers(
        mode,
        typeof request.query.q === "string" ? request.query.q : undefined,
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/:mode/options", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response
        .status(404)
        .json({ message: "Modo de disparidade nao encontrado" });
      return;
    }

    response.json(
      await service.listPlayerOptions(
        mode,
        typeof request.query.q === "string" ? request.query.q : undefined,
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/:mode/pair", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response
        .status(404)
        .json({ message: "Modo de disparidade nao encontrado" });
      return;
    }

    const playerOne =
      typeof request.query.player1 === "string" ? request.query.player1 : "";
    const playerTwo =
      typeof request.query.player2 === "string" ? request.query.player2 : "";

    if (!playerOne || !playerTwo) {
      response
        .status(400)
        .json({ message: "player1 e player2 sao obrigatorios" });
      return;
    }

    const result = await service.getPair(mode, playerOne, playerTwo);

    if (!result) {
      response.status(404).json({ message: "Confronto nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:mode/panorama", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response
        .status(404)
        .json({ message: "Modo de disparidade nao encontrado" });
      return;
    }

    const dayKey =
      typeof request.query.dayKey === "string"
        ? request.query.dayKey
        : undefined;

    log.debug({ mode, dayKey: dayKey ?? "(hoje)" }, "panorama iniciando");
    const start = Date.now();
    const result = await service.getPanorama(mode, dayKey);
    log.debug(
      {
        mode,
        dayKey: dayKey ?? "(hoje)",
        elapsedMs: Date.now() - start,
        matches: (result as Record<string, unknown>)?.totalMatches ?? 0,
      },
      "panorama concluido",
    );

    if (!result) {
      response
        .status(404)
        .json({ message: "Panorama nao disponivel para esse modo" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:mode/xray", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response
        .status(404)
        .json({ message: "Modo de disparidade nao encontrado" });
      return;
    }

    const result = await service.getRaioX(mode);

    if (!result) {
      response
        .status(404)
        .json({ message: "Raio X nao disponivel para esse modo" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:mode/:playerId", async (request, response, next) => {
  try {
    const mode = request.params.mode as "GT" | "Volta" | "Basket";

    if (mode !== "GT" && mode !== "Volta" && mode !== "Basket") {
      response
        .status(404)
        .json({ message: "Modo de disparidade nao encontrado" });
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
