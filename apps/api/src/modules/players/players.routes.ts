import { Router } from "express";
import { PlayersService } from "./players.service";

const router = Router();
const service = new PlayersService();

router.get("/dashboard/rows", async (request, response, next) => {
  try {
    const { q, limit, minGames, leagueType } = request.query as {
      q?: string;
      limit?: string;
      minGames?: string;
      leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
    };

    response.json(
      await service.getDashboardRows({
        query: q,
        limit: limit ? Number(limit) : undefined,
        minGames: minGames ? Number(minGames) : undefined,
        leagueType,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/dashboard/methods", async (request, response, next) => {
  try {
    const { q, limit, minGames, leagueType } = request.query as {
      q?: string;
      limit?: string;
      minGames?: string;
      leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
    };

    response.json(
      await service.getMethodDashboardRows({
        query: q,
        limit: limit ? Number(limit) : undefined,
        minGames: minGames ? Number(minGames) : undefined,
        leagueType,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/methods/jogadores/audit", async (request, response, next) => {
  try {
    const { player, leagueType, startDay, endDay } = request.query as {
      player?: string;
      leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
      startDay?: string;
      endDay?: string;
    };

    if (!player) {
      response.status(400).json({ message: "Informe player" });
      return;
    }

    const result = await service.getMethodAudit({
      playerName: player,
      leagueType,
      startDayKey: startDay,
      endDayKey: endDay,
    });

    if (!result) {
      response.status(404).json({ message: "Auditoria nao encontrada" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/", async (_request, response, next) => {
  try {
    const { q, limit, minGames, activeWithinDays, leagueType, sortBy } = _request.query as {
      q?: string;
      limit?: string;
      minGames?: string;
      activeWithinDays?: string;
      leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
      sortBy?: "winRateDesc" | "winRateAsc" | "maxWinStreak" | "maxLossStreak" | "winRate" | "profit" | "games" | "goalsFor";
    };

    response.json(
      await service.listPlayers({
        query: q,
        limit: limit ? Number(limit) : undefined,
        minGames: minGames ? Number(minGames) : undefined,
        activeWithinDays: activeWithinDays ? Number(activeWithinDays) : undefined,
        leagueType,
        sortBy,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/search", async (request, response, next) => {
  try {
    const { q, limit, minGames, activeWithinDays, leagueType, sortBy } = request.query as {
      q?: string;
      limit?: string;
      minGames?: string;
      activeWithinDays?: string;
      leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
      sortBy?: "winRateDesc" | "winRateAsc" | "maxWinStreak" | "maxLossStreak" | "winRate" | "profit" | "games" | "goalsFor";
    };

    response.json(
      await service.listPlayers({
        query: q,
        limit: limit ? Number(limit) : 10,
        minGames: minGames ? Number(minGames) : 0,
        activeWithinDays: activeWithinDays ? Number(activeWithinDays) : undefined,
        leagueType,
        sortBy,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/:playerId", async (request, response, next) => {
  try {
    const { leagueType } = request.query as {
      leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
    };
    const result = await service.getPlayerStats(request.params.playerId, leagueType);

    if (!result) {
      response.status(404).json({ message: "Jogador nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as playersRouter };