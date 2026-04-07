import { NextResponse } from "next/server";
import { getPortalGTRaioX } from "@/lib/portal-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const xray = await getPortalGTRaioX({ timeoutMs: 30_000 });

  if (!xray) {
    return NextResponse.json(
      { message: "Raio X indisponivel no momento" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  return NextResponse.json(xray, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
