export type ResultCode = "W" | "D" | "L" | "E";
export type LeagueQueryValue = "gtleague" | "8minbattle" | "6minvolta";
export type LeagueApiValue = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA";
export type MethodCode =
  | "T+"
  | "E"
  | "(2E)"
  | "(2D)"
  | "(2D+)"
  | "(3D)"
  | "(3D+)"
  | "(4D)"
  | "(4D+)"
  | "HC-2"
  | "HC-3"
  | "HC-4"
  | "HC-5";
export type SeriesCode = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type FutureConfrontationRow = {
  fixtureId: string;
  confrontationKey: string;
  confrontationLabel: string;
  fixtureLabel: string;
  leagueType: LeagueApiValue;
  groupLabel: string | null;
  seasonId: number | null;
  playedAtIso: string;
  localPlayedAtLabel: string;
  playerName: string;
  opponentName: string;
  methodCode: MethodCode;
  apx: number;
  totalOccurrences: number;
  triggerSequence: ResultCode[];
  daySequence: ResultCode[];
};

export type FutureConfrontationMethodsResponse = {
  generatedAt: string;
  leagueType: LeagueApiValue;
  currentWindow: {
    dayKey: string;
    dayLabel: string;
    windowLabel: string;
    rangeLabel: string;
    description: string;
    usesOperationalDay: boolean;
  };
  availableMethods: Array<{
    code: MethodCode;
    label: string;
  }>;
  rows: FutureConfrontationRow[];
};
