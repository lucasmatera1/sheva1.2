import { PortalShell } from "@/components/portal-shell";
import { getPortalGTDisparityPlayers } from "@/lib/portal-api";
import { GTDisparityBoard } from "./gt-disparity-board";

type GTLeagueDisparidadePageProps = {
  searchParams?: Promise<{
    player1?: string;
    player2?: string;
  }>;
};

export default async function GTLeagueDisparidadePage({
  searchParams,
}: GTLeagueDisparidadePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const playerOne =
    typeof resolvedSearchParams?.player1 === "string"
      ? resolvedSearchParams.player1
      : "";
  const playerTwo =
    typeof resolvedSearchParams?.player2 === "string"
      ? resolvedSearchParams.player2
      : "";

  const players = await getPortalGTDisparityPlayers();

  const sortedPlayers = [...players].sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
  );

  return (
    <PortalShell hidePageHeader>
      <GTDisparityBoard
        players={sortedPlayers}
        initialPlayerOne={playerOne}
        initialPlayerTwo={playerTwo}
      />
    </PortalShell>
  );
}
