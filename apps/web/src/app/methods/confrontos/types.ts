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

export type ConfrontationDayHistoryItem = {
  matchId: string;
  matchNumber: number;
  localTimeLabel: string;
  localPlayedAtLabel: string;
  result: ResultCode;
  fullTimeScore: string;
  isMethodEntry: boolean;
};

export type ConfrontationOccurrence = {
  matchId: string;
  dayKey: string;
  dayLabel: string;
  windowLabel: string;
  localTimeLabel: string;
  localPlayedAtLabel: string;
  seasonId: number | null;
  result: ResultCode;
  fullTimeScore: string;
  triggerSequence: ResultCode[];
  daySequence: ResultCode[];
  dayHistory: ConfrontationDayHistoryItem[];
};

export type ConfrontationRow = {
  confrontationKey: string;
  confrontationLabel: string;
  totalOccurrences: number;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  history: ConfrontationOccurrence[];
};

export type ConfrontationMethodsResponse = {
  generatedAt: string;
  leagueType: LeagueApiValue;
  methodCode: MethodCode;
  availableMethods: Array<{
    code: MethodCode;
    label: string;
  }>;
  rows: ConfrontationRow[];
};
