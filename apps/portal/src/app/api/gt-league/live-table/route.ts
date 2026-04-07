import { NextResponse } from "next/server";
import { getPortalGTLiveTable } from "@/lib/portal-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const historyDays = Number.parseInt(searchParams.get("historyDays") ?? "30", 10);
  const liveTable = await getPortalGTLiveTable({
    timeoutMs: 30_000,
    historyDays: Number.isFinite(historyDays) ? historyDays : 30,
  });

  if (!liveTable) {
    return NextResponse.json(
      { message: "GT League live table indisponivel no momento" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  return NextResponse.json(liveTable, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
