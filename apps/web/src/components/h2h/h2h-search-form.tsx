"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "../../lib/api";

type Suggestion = {
  id: string;
  name: string;
};

type H2HSearchFormProps = {
  initialPlayerA: string;
  initialPlayerB: string;
  initialSuggestions: string[];
  action?: string;
  leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA" | "H2H";
  apiBaseUrl?: string;
  activeWithinDays?: number;
};

async function fetchSuggestions(
  query: string,
  leagueType?: H2HSearchFormProps["leagueType"],
  apiBaseUrl = apiUrl,
  activeWithinDays?: number,
) {
  if (!query.trim()) {
    return [] as Suggestion[];
  }

  const params = new URLSearchParams({ q: query, limit: "8", minGames: "5" });
  if (leagueType) {
    params.set("leagueType", leagueType);
  }
  if (activeWithinDays) {
    params.set("activeWithinDays", String(activeWithinDays));
  }

  const response = await fetch(`${apiBaseUrl}/players/search?${params.toString()}`);
  if (!response.ok) {
    return [] as Suggestion[];
  }

  return (await response.json()) as Suggestion[];
}

export function H2HSearchForm({
  initialPlayerA,
  initialPlayerB,
  initialSuggestions,
  action,
  leagueType,
  apiBaseUrl = apiUrl,
  activeWithinDays,
}: H2HSearchFormProps) {
  const [playerA, setPlayerA] = useState(initialPlayerA);
  const [playerB, setPlayerB] = useState(initialPlayerB);
  const [suggestionsA, setSuggestionsA] = useState(initialSuggestions);
  const [suggestionsB, setSuggestionsB] = useState(initialSuggestions);
  const playerASearchKey = [apiBaseUrl, leagueType ?? "", activeWithinDays ?? "", playerA].join("|");
  const playerBSearchKey = [apiBaseUrl, leagueType ?? "", activeWithinDays ?? "", playerB].join("|");

  useEffect(() => {
    const timeout = setTimeout(async () => {
      const results = await fetchSuggestions(playerA, leagueType, apiBaseUrl, activeWithinDays);
      if (results.length) {
        setSuggestionsA(results.map((item) => item.name));
      }
    }, 180);

    return () => clearTimeout(timeout);
  }, [playerASearchKey]);

  useEffect(() => {
    const timeout = setTimeout(async () => {
      const results = await fetchSuggestions(playerB, leagueType, apiBaseUrl, activeWithinDays);
      if (results.length) {
        setSuggestionsB(results.map((item) => item.name));
      }
    }, 180);

    return () => clearTimeout(timeout);
  }, [playerBSearchKey]);

  return (
    <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]" method="get" action={action}>
      <label className="text-sm text-ink/72">
        Jogador A
        <input
          name="playerAId"
          value={playerA}
          onChange={(event) => setPlayerA(event.target.value)}
          list="h2h-suggestions-a"
          className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none"
        />
        <datalist id="h2h-suggestions-a">
          {suggestionsA.map((name) => (
            <option key={`a-${name}`} value={name} />
          ))}
        </datalist>
      </label>

      <label className="text-sm text-ink/72">
        Jogador B
        <input
          name="playerBId"
          value={playerB}
          onChange={(event) => setPlayerB(event.target.value)}
          list="h2h-suggestions-b"
          className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none"
        />
        <datalist id="h2h-suggestions-b">
          {suggestionsB.map((name) => (
            <option key={`b-${name}`} value={name} />
          ))}
        </datalist>
      </label>

      {leagueType ? <input type="hidden" name="leagueType" value={leagueType} /> : null}

      <button type="submit" className="rounded-full bg-[#20352e] px-5 py-3 text-sm font-semibold text-white md:self-end">
        Comparar
      </button>
    </form>
  );
}