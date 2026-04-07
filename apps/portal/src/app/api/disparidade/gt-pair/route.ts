import { NextResponse } from "next/server";
import { getPortalGTDisparityPair } from "@/lib/portal-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerOne = searchParams.get("player1") ?? "";
  const playerTwo = searchParams.get("player2") ?? "";

  if (!playerOne || !playerTwo) {
    return NextResponse.json(
      { message: "player1 e player2 sao obrigatorios" },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const pairData = await getPortalGTDisparityPair(playerOne, playerTwo);

  if (!pairData) {
    return NextResponse.json(
      { message: "Confronto nao encontrado" },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  return NextResponse.json(pairData, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
