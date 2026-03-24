export type FutureSortBy = "kickoff" | "apx" | "occurrences" | "priority";

type PriorityInput = {
  playedAtIso: string;
  apx: number;
  totalOccurrences: number;
};

export function getMinutesUntil(playedAtIso: string) {
  return Math.round((new Date(playedAtIso).getTime() - Date.now()) / 60000);
}

export function formatRelativeKickoff(playedAtIso: string) {
  const minutes = getMinutesUntil(playedAtIso);
  if (minutes <= 0) {
    return "Agora ou atrasado";
  }

  if (minutes < 60) {
    return `Em ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `Em ${hours}h ${remainingMinutes}min` : `Em ${hours}h`;
}

export function getOperationalPriorityScore(input: PriorityInput) {
  const minutes = Math.max(0, getMinutesUntil(input.playedAtIso));
  const proximityScore = ((240 - Math.min(minutes, 240)) / 240) * 55;
  const apxScore = Math.min(Math.max(input.apx, 0), 100) * 0.35;
  const occurrencesScore = Math.min(Math.max(input.totalOccurrences, 0), 10);

  return proximityScore + apxScore + occurrencesScore;
}

export function getFuturePriorityMeta(input: PriorityInput) {
  const score = getOperationalPriorityScore(input);

  if (score >= 65) {
    return {
      label: "Alta prioridade",
      className: "bg-[#7a3f34] text-white",
      score,
    };
  }

  if (score >= 42) {
    return {
      label: "Prioridade ativa",
      className: "bg-[#d8c48e] text-ink",
      score,
    };
  }

  return {
    label: "Monitorar",
    className: "bg-[#e9ece8] text-[#20352e]",
    score,
  };
}

export function compareFutureRows<T extends PriorityInput>(left: T, right: T, sortBy: FutureSortBy) {
  if (sortBy === "apx") {
    return right.apx - left.apx || compareKickoff(left, right) || right.totalOccurrences - left.totalOccurrences;
  }

  if (sortBy === "occurrences") {
    return right.totalOccurrences - left.totalOccurrences || right.apx - left.apx || compareKickoff(left, right);
  }

  if (sortBy === "priority") {
    return (
      getOperationalPriorityScore(right) - getOperationalPriorityScore(left) ||
      compareKickoff(left, right) ||
      right.apx - left.apx ||
      right.totalOccurrences - left.totalOccurrences
    );
  }

  return compareKickoff(left, right) || right.apx - left.apx || right.totalOccurrences - left.totalOccurrences;
}

function compareKickoff<T extends Pick<PriorityInput, "playedAtIso">>(left: T, right: T) {
  return new Date(left.playedAtIso).getTime() - new Date(right.playedAtIso).getTime();
}