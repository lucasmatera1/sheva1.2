import { NextResponse } from "next/server";
import { getPortalGTPanorama } from "@/lib/portal-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dayKey = searchParams.get("dayKey") ?? undefined;

  const panorama = await getPortalGTPanorama({ dayKey });

  if (!panorama) {
    return NextResponse.json(
      { message: "Panorama da GT League indisponivel no momento" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }

  return NextResponse.json(panorama, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
