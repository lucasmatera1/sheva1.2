import { NextResponse } from "next/server";
import { getPortalGTDisparityPlayers } from "@/lib/portal-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const players = await getPortalGTDisparityPlayers();

  return NextResponse.json(players, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
