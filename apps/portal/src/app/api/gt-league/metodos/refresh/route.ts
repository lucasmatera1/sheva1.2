import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getPortalApiBaseUrl() {
  return (
    process.env.PORTAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4013/api"
  ).replace(/\/$/, "");
}

export async function POST() {
  try {
    const response = await fetch(
      `${getPortalApiBaseUrl()}/portal/method-occurrences/refresh?leagueType=${encodeURIComponent("GT LEAGUE")}`,
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { message: "Falha ao atualizar metodos." },
        { status: response.status },
      );
    }

    const payload = await response.json();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Nao foi possivel atualizar os metodos agora." },
      { status: 500 },
    );
  }
}
