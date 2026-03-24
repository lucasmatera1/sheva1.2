import type { AnalyticsMatch, MatchResultCode, TimeBucket } from "./types";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: SAO_PAULO_TIME_ZONE, weekday: "short" });
const dateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_INDEX_BY_LABEL: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_LABELS_PT_BR = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"] as const;
const TIME_BUCKET_LABELS_PT_BR: Record<TimeBucket, string> = {
  madrugada: "Madrugada",
  manha: "Manha",
  tarde: "Tarde",
  noite: "Noite",
};

export const ANALYTICS_TIME_ZONE = SAO_PAULO_TIME_ZONE;
export const ANALYTICS_WEEKDAY_LABELS = WEEKDAY_LABELS_PT_BR;
export const ANALYTICS_TIME_BUCKET_LABELS = TIME_BUCKET_LABELS_PT_BR;

export function roundAnalytics(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

export function clampAnalyticsScore(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, roundAnalytics(value)));
}

export function normalizeAnalyticsName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeAnalyticsKey(value: string) {
  return normalizeAnalyticsName(value).toUpperCase();
}

export function buildAnalyticsPlayerId(name: string) {
  return normalizeAnalyticsKey(name).replace(/[^A-Z0-9]+/g, "-");
}

export function normalizeLeagueGroup(group?: string | null) {
  const normalized = (group ?? "").trim().toUpperCase();
  return normalized || null;
}

export function isVoltaSeasonName(value: string | null | undefined) {
  return value ? value.trim().toLowerCase().startsWith("volta") : false;
}

export function getAnalyticsWinner(match: AnalyticsMatch) {
  if (match.homeScore === null || match.awayScore === null) {
    return null;
  }

  if (match.homeScore > match.awayScore) {
    return "home" as const;
  }

  if (match.awayScore > match.homeScore) {
    return "away" as const;
  }

  return "draw" as const;
}

export function getPlayerOpponentName(match: AnalyticsMatch, playerName: string) {
  return normalizeAnalyticsKey(match.homePlayer) === normalizeAnalyticsKey(playerName) ? match.awayPlayer : match.homePlayer;
}

export function getPlayerResultCode(match: AnalyticsMatch, playerName: string): MatchResultCode {
  const isHome = normalizeAnalyticsKey(match.homePlayer) === normalizeAnalyticsKey(playerName);

  if (match.homeScore === null || match.awayScore === null || match.homeScore === match.awayScore) {
    return "D";
  }

  if ((isHome && match.homeScore > match.awayScore) || (!isHome && match.awayScore > match.homeScore)) {
    return "W";
  }

  return "L";
}

export function getResultNumericScore(result: MatchResultCode) {
  if (result === "W") {
    return 1;
  }

  if (result === "L") {
    return -1;
  }

  return 0;
}

export function getTimeBucketForHour(hour: number | null): TimeBucket | null {
  if (hour === null || hour < 0 || hour > 23) {
    return null;
  }

  if (hour <= 5) {
    return "madrugada";
  }

  if (hour <= 11) {
    return "manha";
  }

  if (hour <= 17) {
    return "tarde";
  }

  return "noite";
}

export function getWeekdayLabel(weekday: number) {
  return WEEKDAY_LABELS_PT_BR[weekday] ?? `Dia ${weekday}`;
}

export function getTimeBucketLabel(timeBucket: TimeBucket) {
  return TIME_BUCKET_LABELS_PT_BR[timeBucket];
}

export function getHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function buildLocalTemporalContext(date: Date) {
  const parts = dateTimePartsFormatter.formatToParts(date).reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});
  const weekdayLabel = weekdayFormatter.format(date);
  const weekday = WEEKDAY_INDEX_BY_LABEL[weekdayLabel] ?? null;
  const hour = parts.hour ? Number(parts.hour) : null;

  return {
    dayKey: `${parts.year ?? "0000"}-${parts.month ?? "00"}-${parts.day ?? "00"}`,
    hour,
    weekday,
    timeBucket: getTimeBucketForHour(hour),
  };
}