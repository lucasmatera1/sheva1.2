import { NextResponse } from "next/server";
import { getPortalOpenSignals } from "@/lib/portal-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const signals = await getPortalOpenSignals({
    leagueTypes: searchParams.getAll("leagueType"),
  });

  return NextResponse.json(signals, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
