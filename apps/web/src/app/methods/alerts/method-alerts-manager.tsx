"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { SurfaceCard } from "../../../components/shell/app-shell";
import { apiUrl } from "../../../lib/api";
import { formatRelativeKickoff, getFuturePriorityMeta } from "../future/priority";

const LEAGUE_OPTIONS = ["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA"] as const;
const METHOD_OPTIONS = ["T+", "E", "(2E)", "(2D)", "(2D+)", "(3D)", "(3D+)", "(4D)", "(4D+)", "HC-2", "HC-3", "HC-4", "HC-5", "4D Jogador", "4W Jogador", "Fav T1", "Fav T2", "Fav T3"] as const;
const SERIES_OPTIONS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const DAYS_OPTIONS = [7, 15, 21, 30, 45, 60] as const;
const TRANSPORT_OPTIONS = ["webhook", "telegram"] as const;
const ALERTS_MAIN_TABS = ["editor", "rules", "dispatches", "webhook", "backup"] as const;
const CURRENT_J_LEAGUES = ["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA"] as const;
const TELEGRAM_CHAT_IDS_STORAGE_KEY = "sheva.alerts.telegramChatIds";
const ALERTS_OVERVIEW_CACHE_STORAGE_KEY = "sheva.alerts.overviewCache";
const ALERTS_OVERVIEW_POLL_INTERVAL_MS = 60000;

const FAV_METHOD_LABELS: Partial<Record<(typeof METHOD_OPTIONS)[number], string>> = {
  "Fav T1": "Fav T1 — Gap≥20pp, s/ LStr, ≤8j (APX ~74%)",
  "Fav T2": "Fav T2 — ≤4 jogos do dia (APX ~66%)",
  "Fav T3": "Fav T3 — Gap≥15pp, ≤8j (APX ~63%)",
};

type AlertsSyncState = {
  status: "idle" | "syncing" | "ok" | "error";
  lastSyncedAt: string | null;
  message: string | null;
};

type AlertsOverviewCache = {
  rules: AlertRule[];
  dispatches: AlertDispatch[];
  syncedAt: string;
};

type AlertRule = {
  id: string;
  name: string;
  isActive: boolean;
  transportType: (typeof TRANSPORT_OPTIONS)[number];
  leagueType: (typeof LEAGUE_OPTIONS)[number];
  methodCode: (typeof METHOD_OPTIONS)[number];
  series: (typeof SERIES_OPTIONS)[number] | null;
  playerName: string | null;
  apxMin: number;
  minOccurrences: number;
  windowDays: number;
  recipients: string[];
  webhookUrl: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  lastEvaluatedAt: string | null;
};

type AlertDispatch = {
  id: string;
  ruleId: string;
  ruleName: string | null;
  leagueType: string | null;
  methodCode: string | null;
  signalKey: string;
  confrontationKey: string;
  confrontationLabel: string;
  dayKey: string;
  occurrenceMatchId: string;
  occurrencePlayedAt: string;
  apx: number;
  totalOccurrences: number;
  recipients: string[];
  eventType: "initial_signal" | "result_followup";
  payloadText: string;
  transportStatus: string;
  transportResponse: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AlertDispatchPayload = {
  source?: "manual" | "scheduler";
  eventType?: "initial_signal" | "result_followup";
  message?: string;
  recipients?: string[];
  signal?: {
    localPlayedAtLabel?: string;
    result?: string;
    fullTimeScore?: string;
    totalOccurrences?: number;
    apx?: number;
    playerName?: string;
    opponentName?: string;
  };
};

type DebugWebhookEvent = {
  id: string;
  receivedAt: string;
  headers: Record<string, string | string[]>;
  body: unknown;
};

type AlertsStatus = {
  persistenceMode: "database" | "memory";
  isVolatile: boolean;
  telegramConfigured: boolean;
  defaultTelegramChatIds: string[];
};

type CurrentJSnapshot = {
  generatedAt: string;
  leagueType: (typeof CURRENT_J_LEAGUES)[number];
  warning?: string;
  currentWindow: {
    dayKey: string;
    dayLabel: string;
    windowLabel: string;
    rangeLabel: string;
    description: string;
    usesOperationalDay: boolean;
  };
  totals: {
    activePlayers: number;
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    totalDayMatches: number;
    currentWindowPlayedMatches: number;
    currentWindowUpcomingFixtures: number;
  };
  fixtures: Array<{
    id: string;
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    seasonId: number | null;
    groupLabel?: string | null;
  }>;
  players: Array<{
    id: string;
    name: string;
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    currentWindowGames: number;
    upcomingWindowGames: number;
    daySequence: Array<"W" | "D" | "L">;
    latestPlayedAt: string | null;
    nextFixtureAt: string | null;
    upcomingFixtures: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      opponent: string;
      seasonId: number | null;
    }>;
    recentMatches: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      opponent: string;
      seasonId: number | null;
      result: "W" | "D" | "L";
      scoreLabel: string;
    }>;
    previousWindows: Array<{
      key: string;
      dayLabel: string;
      windowLabel: string;
      rangeLabel: string;
      totalGames: number;
      wins: number;
      draws: number;
      losses: number;
      latestPlayedAt: string | null;
      sequence: Array<"W" | "D" | "L">;
      matches: Array<{
        id: string;
        playedAt: string;
        homePlayer: string;
        awayPlayer: string;
        opponent: string;
        seasonId: number | null;
        result: "W" | "D" | "L";
        scoreLabel: string;
      }>;
    }>;
  }>;
};

type AlertRulesBackup = {
  format: "sheva-method-alert-rules";
  version: 1 | 2;
  exportedAt: string;
  persistenceMode: "database" | "memory";
  rules: AlertRule[];
};

type LocalBackupStatus = {
  exists: boolean;
  filePath: string;
  directoryPath: string;
  latestFileName: string | null;
  exportedAt: string | null;
  sizeBytes: number | null;
};

type LocalBackupHistoryItem = {
  fileName: string;
  filePath: string;
  exportedAt: string | null;
  sizeBytes: number;
  modifiedAt: string;
};

type RunRulesResult = {
  executedAt: string;
  dryRun: boolean;
  totalRules: number;
  totalSignals: number;
  totalDispatched: number;
  rules: Array<{
    rule: AlertRule;
    matchedRows: number;
    triggeredSignals: number;
    dispatchedSignals: number;
  }>;
};

type CurrentSignalPreview = {
  signalKey: string;
  confrontationKey: string;
  confrontationLabel: string;
  dayKey: string;
  occurrenceMatchId: string;
  occurrencePlayedAt: string;
  localPlayedAtLabel: string;
  result: string;
  fullTimeScore: string;
  apx: number;
  totalOccurrences: number;
  recipients: string[];
  message: string;
  alreadyProcessed: boolean;
  lastTransportStatus: string | null;
  lastSentAt: string | null;
  methodCode?: string;
  fixtureLabel?: string;
  groupLabel?: string | null;
  playerName?: string;
  opponentName?: string;
  triggerSequence?: string[];
  daySequence?: string[];
  sourceView?: "future-confrontations" | "future-player-sessions" | "historical";
  deliveryStatus?: string;
  deliveryInfo?: string;
};

type CurrentSignalsResult = {
  rule: AlertRule;
  matchedRows: number;
  totalMatchingSignals?: number;
  totalEligibleSignals: number;
  alreadyProcessedSignals: number;
  signals: CurrentSignalPreview[];
  maxSignals?: number;
  attemptedSignals?: number;
  dispatchedSignals?: number;
  remainingSignals?: number;
};

type TestDispatchResult = {
  rule: AlertRule;
  signal: {
    signalKey: string;
    confrontationKey: string;
    confrontationLabel: string;
    dayKey: string;
    occurrenceMatchId: string;
    occurrencePlayedAt: string;
    localPlayedAtLabel: string;
    result: string;
    fullTimeScore: string;
    apx: number;
    totalOccurrences: number;
    recipients: string[];
    message: string;
  };
  deliveryStatus: string;
  deliveryInfo: string;
  wasDispatched: boolean;
};

function createInitialForm(preferredRecipients = "", webhookUrl = "") {
  return {
    name: "GT Serie A 4D acima de 63%",
    transportType: "telegram" as (typeof TRANSPORT_OPTIONS)[number],
    leagueType: "GT LEAGUE" as (typeof LEAGUE_OPTIONS)[number],
    methodCode: "(4D)" as (typeof METHOD_OPTIONS)[number],
    series: "A" as (typeof SERIES_OPTIONS)[number] | "",
    playerName: "",
    apxMin: "63",
    minOccurrences: "8",
    windowDays: "30",
    recipients: preferredRecipients,
    webhookUrl,
    note: "",
  };
}

export function MethodAlertsManager() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [dispatches, setDispatches] = useState<AlertDispatch[]>([]);
  const [debugEvents, setDebugEvents] = useState<DebugWebhookEvent[]>([]);
  const [alertsStatus, setAlertsStatus] = useState<AlertsStatus | null>(null);
  const [localBackupStatus, setLocalBackupStatus] = useState<LocalBackupStatus | null>(null);
  const [localBackupHistory, setLocalBackupHistory] = useState<LocalBackupHistoryItem[]>([]);
  const [backupText, setBackupText] = useState("");
  const [backupFileName, setBackupFileName] = useState<string | null>(null);
  const [savedTelegramChatIds, setSavedTelegramChatIds] = useState("");
  const [currentSignalsByRule, setCurrentSignalsByRule] = useState<Record<string, CurrentSignalsResult>>({});
  const [activeMainTab, setActiveMainTab] = useState<(typeof ALERTS_MAIN_TABS)[number]>("rules");
  const [form, setForm] = useState(() => createInitialForm());
  const [formPlayerOptions, setFormPlayerOptions] = useState<string[]>([]);
  const [isLoadingFormPlayers, setIsLoadingFormPlayers] = useState(false);
  const [formPlayersError, setFormPlayersError] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rulesLoadError, setRulesLoadError] = useState<string | null>(null);
  const [isRefreshingRules, setIsRefreshingRules] = useState(false);
  const [syncState, setSyncState] = useState<AlertsSyncState>({
    status: "idle",
    lastSyncedAt: null,
    message: null,
  });
  const [runResult, setRunResult] = useState<RunRulesResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const ruleFormRef = useRef<HTMLDivElement | null>(null);
  const apxMinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadFormPlayers() {
      setFormPlayersError(null);
      setIsLoadingFormPlayers(true);

      const response = await requestJson<CurrentJSnapshot>(`/dashboard/current-j?league=${encodeURIComponent(form.leagueType)}`);
      if (isCancelled) {
        return;
      }

      if (!response.ok) {
        setFormPlayerOptions([]);
        setFormPlayersError(response.message);
        setIsLoadingFormPlayers(false);
        return;
      }

      setFormPlayerOptions(getCurrentJPlayerNames(response.data));
      setIsLoadingFormPlayers(false);
    }

    void loadFormPlayers();

    return () => {
      isCancelled = true;
    };
  }, [form.leagueType]);

  useEffect(() => {
    let isCancelled = false;

    const cachedOverview = readAlertsOverviewCache();
    if (cachedOverview) {
      setRules(cachedOverview.rules);
      setDispatches(cachedOverview.dispatches);
      setSyncState({
        status: "ok",
        lastSyncedAt: cachedOverview.syncedAt,
        message: "Ultimo snapshot local carregado.",
      });
    }

    async function loadInitialData() {
      const retryDelays = [0, 1200, 2500];

      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        if (attempt > 0) {
          await wait(retryDelays[attempt]);
        }

        if (isCancelled) {
          return;
        }

        const loaded = await refreshData({ preserveRulesOnError: true });
        if (loaded) {
          return;
        }
      }
    }

    void loadInitialData();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    const runRefresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      void refreshAlertsOverview({ preserveOnError: true, source: "polling" });
    };

    intervalHandle = setInterval(runRefresh, ALERTS_OVERVIEW_POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runRefresh();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (intervalHandle) {
        clearInterval(intervalHandle);
      }

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    const storedValue = readSavedTelegramChatIds();
    if (!storedValue) {
      return;
    }

    setSavedTelegramChatIds(storedValue);
    setForm((current) => {
      if (editingRuleId || current.transportType !== "telegram" || current.recipients.trim()) {
        return current;
      }

      return {
        ...current,
        recipients: storedValue,
      };
    });
  }, [editingRuleId]);

  async function refreshData(options: { preserveRulesOnError?: boolean } = {}) {
    setErrorMessage(null);
    setIsRefreshingRules(true);
    setSyncState((current) => ({
      ...current,
      status: "syncing",
      message: "Atualizando painel de alertas...",
    }));

    const [rulesResponse, dispatchesResponse, debugEventsResponse, statusResponse, localBackupStatusResponse, localBackupHistoryResponse] = await Promise.all([
      requestJson<AlertRule[]>("/alerts/rules"),
      requestJson<AlertDispatch[]>("/alerts/dispatches?limit=12"),
      requestJson<{ total: number; events: DebugWebhookEvent[] }>("/alerts/webhook-debug/events"),
      requestJson<AlertsStatus>("/alerts/status"),
      requestJson<LocalBackupStatus>("/alerts/backup/local-status"),
      requestJson<{ items: LocalBackupHistoryItem[] }>("/alerts/backup/local-history?limit=8"),
    ]);

    if (rulesResponse.ok) {
      setRules(rulesResponse.data);
      setRulesLoadError(null);
    } else {
      setRulesLoadError(rulesResponse.message);
      if (!options.preserveRulesOnError) {
        setRules([]);
      }
    }
    setDispatches(dispatchesResponse.ok ? dispatchesResponse.data : []);
    setDebugEvents(debugEventsResponse.ok ? debugEventsResponse.data.events : []);
    setAlertsStatus(statusResponse.ok ? statusResponse.data : null);
    setLocalBackupStatus(localBackupStatusResponse.ok ? localBackupStatusResponse.data : null);
    setLocalBackupHistory(localBackupHistoryResponse.ok ? localBackupHistoryResponse.data.items : []);

    const message = firstErrorMessage(rulesResponse, dispatchesResponse, debugEventsResponse, statusResponse, localBackupStatusResponse, localBackupHistoryResponse);
    if (message) {
      setErrorMessage(message);
    }

    if (rulesResponse.ok && dispatchesResponse.ok) {
      const syncedAt = new Date().toISOString();
      writeAlertsOverviewCache({
        rules: rulesResponse.data,
        dispatches: dispatchesResponse.data,
        syncedAt,
      });
      setSyncState({
        status: "ok",
        lastSyncedAt: syncedAt,
        message: "Painel sincronizado com a API.",
      });
    } else {
      setSyncState((current) => ({
        status: "error",
        lastSyncedAt: current.lastSyncedAt,
        message: message ?? "Falha ao atualizar o painel de alertas.",
      }));
    }

    setIsRefreshingRules(false);
    return rulesResponse.ok;
  }

  async function refreshAlertsOverview(options: { preserveOnError?: boolean; source?: "manual" | "polling" } = {}) {
    setSyncState((current) => ({
      ...current,
      status: "syncing",
      message: options.source === "polling" ? "Verificando atualizacoes automaticas..." : "Atualizando regras e disparos...",
    }));

    const [rulesResponse, dispatchesResponse] = await Promise.all([
      requestJson<AlertRule[]>("/alerts/rules"),
      requestJson<AlertDispatch[]>("/alerts/dispatches?limit=12"),
    ]);

    const nowIso = new Date().toISOString();

    if (rulesResponse.ok) {
      setRules(rulesResponse.data);
      setRulesLoadError(null);
    } else if (!options.preserveOnError) {
      setRules([]);
      setRulesLoadError(rulesResponse.message);
    } else if (rulesResponse.message) {
      setRulesLoadError(rulesResponse.message);
    }

    if (dispatchesResponse.ok) {
      setDispatches(dispatchesResponse.data);
    } else if (!options.preserveOnError) {
      setDispatches([]);
    }

    if (rulesResponse.ok && dispatchesResponse.ok) {
      writeAlertsOverviewCache({
        rules: rulesResponse.data,
        dispatches: dispatchesResponse.data,
        syncedAt: nowIso,
      });
      setSyncState({
        status: "ok",
        lastSyncedAt: nowIso,
        message: options.source === "polling" ? "Sincronizacao automatica em dia." : "Regras e disparos atualizados.",
      });
      return true;
    }

    setSyncState((current) => ({
      status: "error",
      lastSyncedAt: current.lastSyncedAt,
      message: firstErrorMessage(rulesResponse, dispatchesResponse) ?? "Falha ao atualizar regras e disparos.",
    }));
    return false;
  }

  async function handleRefreshRules() {
    setStatusMessage(null);
    setErrorMessage(null);

    const loaded = await refreshAlertsOverview({ preserveOnError: true, source: "manual" });
    if (loaded) {
      setStatusMessage("Regras atualizadas pela API.");
    }
  }

  function handleOpenNewRule() {
    resetForm(form.webhookUrl);
    setStatusMessage(null);
    setErrorMessage(null);
    setActiveMainTab("editor");

    window.requestAnimationFrame(() => {
      ruleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

      window.setTimeout(() => {
        apxMinInputRef.current?.focus();
        apxMinInputRef.current?.select();
      }, 250);
    });
  }

  async function handleSubmitRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    const isEditing = Boolean(editingRuleId);
    const payload = {
      name: form.name.trim(),
      isActive: true,
      transportType: form.transportType,
      leagueType: form.leagueType,
      methodCode: form.methodCode,
      ...(form.leagueType === "GT LEAGUE"
        ? { series: form.series || (isEditing ? null : undefined) }
        : isEditing
          ? { series: null }
          : {}),
      ...(form.playerName.trim() ? { playerName: form.playerName.trim() } : isEditing ? { playerName: null } : {}),
      apxMin: Number(form.apxMin),
      minOccurrences: Number(form.minOccurrences),
      windowDays: Number(form.windowDays),
      recipients: parseRecipients(form.recipients),
      ...(form.webhookUrl.trim() ? { webhookUrl: form.webhookUrl.trim() } : isEditing ? { webhookUrl: null } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : isEditing ? { note: null } : {}),
    };

    const response = await requestJson<AlertRule>(editingRuleId ? `/alerts/rules/${editingRuleId}` : "/alerts/rules", {
      method: editingRuleId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    resetForm(response.data.webhookUrl ?? form.webhookUrl);
    setActiveMainTab("rules");
    setStatusMessage(editingRuleId ? `Regra atualizada: ${response.data.name}` : `Regra criada: ${response.data.name}`);
    await refreshData();
  }

  function handleEditRule(rule: AlertRule) {
    setActiveMainTab("editor");
    setEditingRuleId(rule.id);
    setStatusMessage(null);
    setErrorMessage(null);
    setForm({
      name: rule.name,
      transportType: rule.transportType,
      leagueType: rule.leagueType,
      methodCode: rule.methodCode,
      series: rule.series ?? "",
      playerName: rule.playerName ?? "",
      apxMin: String(rule.apxMin),
      minOccurrences: String(rule.minOccurrences),
      windowDays: String(rule.windowDays),
      recipients: rule.recipients.join(", "),
      webhookUrl: rule.webhookUrl ?? "",
      note: rule.note ?? "",
    });

    window.requestAnimationFrame(() => {
      ruleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

      window.setTimeout(() => {
        apxMinInputRef.current?.focus();
        apxMinInputRef.current?.select();
      }, 250);
    });
  }

  function handleCancelEdit() {
    resetForm(form.webhookUrl);
    setStatusMessage(null);
    setErrorMessage(null);
    setActiveMainTab("rules");
  }

  function handleSaveTelegramChatIds() {
    const normalizedRecipients = parseRecipients(form.recipients).join(", ");

    if (!normalizedRecipients) {
      localStorage.removeItem(TELEGRAM_CHAT_IDS_STORAGE_KEY);
      setSavedTelegramChatIds("");
      setStatusMessage("Chat IDs padrao removidos do navegador.");
      setErrorMessage(null);
      return;
    }

    localStorage.setItem(TELEGRAM_CHAT_IDS_STORAGE_KEY, normalizedRecipients);
    setSavedTelegramChatIds(normalizedRecipients);
    setForm((current) => ({
      ...current,
      recipients: normalizedRecipients,
    }));
    setStatusMessage("Chat IDs padrao salvos para os proximos cadastros.");
    setErrorMessage(null);
  }

  function handleUseLocalWebhook() {
    if (form.transportType !== "webhook") {
      setForm((current) => ({
        ...current,
        transportType: "webhook",
        webhookUrl: localWebhookUrl,
      }));
      setStatusMessage("Transporte alterado para webhook e URL local preenchida.");
      setErrorMessage(null);
      return;
    }

    setForm((current) => ({
      ...current,
      webhookUrl: localWebhookUrl,
    }));
    setStatusMessage("Webhook local preenchido no formulario.");
    setErrorMessage(null);
  }

  async function handleApplyLocalWebhookToRule(rule: AlertRule) {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<AlertRule>(`/alerts/rules/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ transportType: "webhook", webhookUrl: localWebhookUrl }),
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    if (editingRuleId === rule.id) {
      setForm((current) => ({
        ...current,
        transportType: "webhook",
        webhookUrl: localWebhookUrl,
      }));
    }

    setStatusMessage(`Webhook local aplicado na regra: ${response.data.name}`);
    await refreshData();
  }

  async function handleToggleRule(rule: AlertRule) {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<AlertRule>(`/alerts/rules/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !rule.isActive }),
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setStatusMessage(`Regra ${response.data.isActive ? "ativada" : "pausada"}: ${response.data.name}`);
    await refreshData();
  }

  async function handleDeleteRule(rule: AlertRule) {
    setStatusMessage(null);
    setErrorMessage(null);

    if (!window.confirm(`Remover a regra ${rule.name}?`)) {
      return;
    }

    const response = await requestJson<{ message: string }>(`/alerts/rules/${rule.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    if (editingRuleId === rule.id) {
      resetForm(form.webhookUrl);
    }

    setStatusMessage(response.data.message);
    await refreshData();
  }

  async function handleDryRun(ruleId?: string) {
    setStatusMessage(null);
    setErrorMessage(null);
    setRunResult(null);

    const response = await requestJson<RunRulesResult>("/alerts/run", {
      method: "POST",
      body: JSON.stringify({
        dryRun: true,
        onlyActive: true,
        ...(ruleId ? { ruleId } : {}),
      }),
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setRunResult(response.data);
    setStatusMessage(`Dry-run executado em ${formatDateTime(response.data.executedAt)}`);
    await refreshData();
  }

  async function handleClearDebugEvents() {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<{ message: string }>("/alerts/webhook-debug/events", {
      method: "DELETE",
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setStatusMessage(response.data.message);
    await refreshData();
  }

  async function handleExportBackup() {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<AlertRulesBackup>("/alerts/backup");
    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    const serialized = JSON.stringify(response.data, null, 2);
    setBackupText(serialized);

    const blob = new Blob([serialized], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `sheva-alert-rules-backup-${response.data.exportedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);

    setStatusMessage(`Backup gerado com ${response.data.rules.length} regra(s).`);
  }

  async function handleImportBackup(replaceExisting: boolean) {
    setStatusMessage(null);
    setErrorMessage(null);

    if (!backupText.trim()) {
      setErrorMessage("Cole o JSON do backup antes de importar.");
      return;
    }

    let parsedBackup: AlertRulesBackup;
    try {
      parsedBackup = JSON.parse(backupText) as AlertRulesBackup;
    } catch {
      setErrorMessage("O JSON do backup esta invalido.");
      return;
    }

    const response = await requestJson<{ importedCount: number; skippedCount: number; replaceExisting: boolean; skipDuplicates: boolean; rules: AlertRule[] }>("/alerts/backup/import", {
      method: "POST",
      body: JSON.stringify({
        replaceExisting,
        skipDuplicates: true,
        backup: parsedBackup,
      }),
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setStatusMessage(`${response.data.importedCount} regra(s) importada(s), ${response.data.skippedCount} ignorada(s) por duplicidade${response.data.replaceExisting ? " com substituicao do estado atual" : ""}.`);
    await refreshData();
  }

  async function handleSaveBackupToServer() {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<{ filePath: string; latestAliasPath: string; exportedAt: string; rulesCount: number }>("/alerts/backup/save-local", {
      method: "POST",
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setStatusMessage(`Backup local salvo no servidor com ${response.data.rulesCount} regra(s).`);
    await refreshData();
  }

  async function handleRestoreLatestServerBackup(replaceExisting: boolean) {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<{ importedCount: number; skippedCount: number; replaceExisting: boolean }>("/alerts/backup/restore-latest", {
      method: "POST",
      body: JSON.stringify({
        replaceExisting,
        skipDuplicates: true,
      }),
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setStatusMessage(`Ultimo backup do servidor restaurado: ${response.data.importedCount} importada(s), ${response.data.skippedCount} ignorada(s).`);
    await refreshData();
  }

  async function handleBackupFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setBackupText(content);
      setBackupFileName(file.name);
      setStatusMessage(`Backup carregado do arquivo: ${file.name}`);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao ler o arquivo de backup.");
    } finally {
      event.target.value = "";
    }
  }

  async function handlePreviewCurrentSignals(rule: AlertRule) {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<CurrentSignalsResult>(`/alerts/rules/${rule.id}/current-signals?limit=20`);
    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setCurrentSignalsByRule((current) => ({
      ...current,
      [rule.id]: response.data,
    }));
    setStatusMessage(`Verificacao concluida para ${rule.name}: ${response.data.totalEligibleSignals} sinal(is) elegivel(is) agora.`);
  }

  async function handleDispatchCurrentSignals(rule: AlertRule) {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<CurrentSignalsResult>(`/alerts/rules/${rule.id}/dispatch-current-signals`, {
      method: "POST",
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setCurrentSignalsByRule((current) => ({
      ...current,
      [rule.id]: response.data,
    }));
    setStatusMessage(
      `Disparo manual concluido para ${rule.name}: ${response.data.dispatchedSignals ?? 0} enviado(s), ${response.data.remainingSignals ?? 0} restante(s).`,
    );
    await refreshData();
  }

  async function handleTestDispatch(rule: AlertRule) {
    setStatusMessage(null);
    setErrorMessage(null);

    const response = await requestJson<TestDispatchResult>(`/alerts/rules/${rule.id}/test-dispatch`, {
      method: "POST",
      body: JSON.stringify({
        confrontationLabel: `TESTE ${rule.leagueType} x ALERTAS`,
      }),
    });

    if (!response.ok) {
      setErrorMessage(response.message);
      return;
    }

    setStatusMessage(
      response.data.wasDispatched
        ? `Disparo de teste enviado para ${rule.name}: ${response.data.signal.signalKey}.`
        : `Disparo de teste de ${rule.name} nao enviado: ${response.data.deliveryInfo}.`,
    );
    await refreshData();
  }

  const localWebhookUrl = `${apiUrl}/alerts/webhook-debug`;
  const isMissingAlertsTables =
    errorMessage?.includes("As tabelas de alertas ainda nao existem no banco atual") ?? false;

  function resetForm(webhookUrl = "") {
    setEditingRuleId(null);
    setForm({
      ...createInitialForm(savedTelegramChatIds, webhookUrl),
    });
  }

  const selectedPlayerMissingFromOptions = Boolean(form.playerName.trim()) && !formPlayerOptions.includes(form.playerName.trim());

  return (
    <div className="grid gap-5">
      {isMissingAlertsTables ? (
        <SurfaceCard className="border-amber-200 bg-[linear-gradient(135deg,rgba(255,248,228,0.96),rgba(255,255,255,0.88))]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-700">Bloqueio do banco</p>
              <h2 className="mt-3 font-display text-3xl text-ink">As tabelas de alertas ainda nao existem</h2>
              <p className="mt-3 text-sm leading-7 text-ink/72">
                O modulo ja esta pronto no codigo, mas o banco MySQL atual ainda nao possui as tabelas alert_method_rules e alert_method_dispatches. Enquanto isso nao for criado, cadastrar regras e rodar alertas reais vai falhar.
              </p>
            </div>

            <div className="rounded-[1.2rem] border border-amber-200 bg-white/80 px-4 py-4 text-sm text-ink/72">
              <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Acao necessaria</p>
              <p className="mt-2">Executar o SQL de migration com um usuario que tenha permissao de CREATE TABLE.</p>
            </div>
          </div>

          <div className="mt-5 rounded-[1.2rem] border border-ink/10 bg-[#1c201d] p-4 text-xs leading-6 text-[#edf3ea]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#b7d3bd]">Arquivo SQL</p>
            <p className="mt-2 break-all">apps/api/prisma/migrations/20260313_add_method_alerts/migration.sql</p>
          </div>

          <div className="mt-5 grid gap-3 text-sm text-ink/72 lg:grid-cols-3">
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">1. DBA</p>
              <p className="mt-2">Aplicar o SQL no banco fifa com um usuario que possa criar tabelas e chaves.</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">2. API</p>
              <p className="mt-2">Manter a API rodando e recarregar esta tela depois da criacao das tabelas.</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">3. Teste</p>
              <p className="mt-2">Usar o webhook local desta pagina para validar os payloads antes do WhatsApp real.</p>
            </div>
          </div>
        </SurfaceCard>
      ) : null}

      {alertsStatus?.persistenceMode === "memory" ? (
        <SurfaceCard className="border-sky-200 bg-[linear-gradient(135deg,rgba(235,246,255,0.95),rgba(255,255,255,0.88))]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.2em] text-sky-700">Modo de teste</p>
              <h2 className="mt-3 font-display text-3xl text-ink">Alertas em memoria volatil</h2>
              <p className="mt-3 text-sm leading-7 text-ink/72">
                As regras e os disparos estao funcionando sem o banco, mas ficam apenas na memoria da API atual. Se a API reiniciar, esse conteudo some e precisa ser recriado.
              </p>
            </div>

            <div className="rounded-[1.2rem] border border-sky-200 bg-white/80 px-4 py-4 text-sm text-ink/72">
              <p className="text-xs uppercase tracking-[0.16em] text-sky-700">Persistencia</p>
              <p className="mt-2 font-semibold text-ink">memory</p>
            </div>
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Painel</p>
            <h2 className="mt-3 font-display text-3xl text-ink">Alertas de metodo</h2>
            <p className="mt-3 text-sm leading-7 text-ink/68">Abra novas regras por botao, navegue por abas e use a pagina separada de metodos recentes para acompanhar o historico sem poluir a tela principal.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleOpenNewRule}
              className={`inline-flex rounded-full px-5 py-3 text-sm font-semibold transition ${activeMainTab === "editor" ? "bg-[#172821] text-white" : "bg-[#20352e] text-white hover:bg-[#172821]"}`}
            >
              {editingRuleId ? "Editar Regra" : "Nova Regra"}
            </button>
            <button
              type="button"
              onClick={() => setActiveMainTab("rules")}
              className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold transition ${activeMainTab === "rules" ? "bg-[#20352e] text-white" : "border border-ink/10 bg-white text-ink hover:border-ink/20"}`}
            >
              Regras cadastradas
            </button>
            <button
              type="button"
              onClick={() => setActiveMainTab("dispatches")}
              className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold transition ${activeMainTab === "dispatches" ? "bg-[#20352e] text-white" : "border border-ink/10 bg-white text-ink hover:border-ink/20"}`}
            >
              Disparos
            </button>
            <button
              type="button"
              onClick={() => setActiveMainTab("webhook")}
              className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold transition ${activeMainTab === "webhook" ? "bg-[#20352e] text-white" : "border border-ink/10 bg-white text-ink hover:border-ink/20"}`}
            >
              Webhook local
            </button>
            <button
              type="button"
              onClick={() => setActiveMainTab("backup")}
              className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold transition ${activeMainTab === "backup" ? "bg-[#20352e] text-white" : "border border-ink/10 bg-white text-ink hover:border-ink/20"}`}
            >
              Backup local
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => void refreshData())}
              className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20"
            >
              {isPending ? "Atualizando..." : "Atualizar"}
            </button>
            <Link href="/alerts/pastmethods" className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 transition hover:bg-sky-100">
              Metodos Recentes
            </Link>
          </div>
        </div>
      </SurfaceCard>

      {statusMessage ? <div className="rounded-[1.15rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{statusMessage}</div> : null}
      {errorMessage ? <div className="rounded-[1.15rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div> : null}
      {runResult ? (
        <SurfaceCard className="bg-[#f7f4ec]">
          <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Ultimo dry-run</p>
          <div className="mt-3 grid gap-3 text-sm text-ink/72 sm:grid-cols-4">
            <p>Regras lidas: {runResult.totalRules}</p>
            <p>Sinais: {runResult.totalSignals}</p>
            <p>Despachos: {runResult.totalDispatched}</p>
            <p>Horario: {formatDateTime(runResult.executedAt)}</p>
          </div>
          <div className="mt-4 space-y-2 text-sm text-ink/62">
            {runResult.rules.map((item) => (
              <p key={item.rule.id}>
                {item.rule.name}: {item.matchedRows} confronto(s), {item.triggeredSignals} sinal(is), {item.dispatchedSignals} envio(s).
              </p>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      {activeMainTab !== "backup" ? (
      <>
      {activeMainTab === "editor" ? (
      <SurfaceCard>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Cadastro</p>
            <h2 className="mt-3 font-display text-3xl text-ink">{editingRuleId ? "Editar regra" : "Nova regra"}</h2>
            <p className="mt-3 text-sm leading-7 text-ink/68">A tela conversa direto com /api/alerts. Se as tabelas ainda nao existirem no MySQL, a mensagem de erro aparece aqui.</p>
          </div>
          <button
            type="button"
            onClick={() => startTransition(() => void refreshData())}
            className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20"
          >
            {isPending ? "Atualizando..." : "Atualizar"}
          </button>
        </div>

        <div ref={ruleFormRef}>
        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleSubmitRule}>
          <label className="grid gap-2 text-sm text-ink/72">
            <span>Nome da regra</span>
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none" />
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>Transporte</span>
            <select value={form.transportType} onChange={(event) => setForm((current) => ({ ...current, transportType: event.target.value as (typeof TRANSPORT_OPTIONS)[number] }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none">
              <option value="telegram">Telegram</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>Liga</span>
            <select value={form.leagueType} onChange={(event) => setForm((current) => ({ ...current, leagueType: event.target.value as (typeof LEAGUE_OPTIONS)[number], series: event.target.value === "GT LEAGUE" ? current.series || "A" : "" }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none">
              {LEAGUE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>Metodo</span>
            <select value={form.methodCode} onChange={(event) => setForm((current) => ({ ...current, methodCode: event.target.value as (typeof METHOD_OPTIONS)[number] }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none">
              {METHOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {FAV_METHOD_LABELS[option] ?? option}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>Serie</span>
            <select value={form.series} disabled={form.leagueType !== "GT LEAGUE"} onChange={(event) => setForm((current) => ({ ...current, series: event.target.value as (typeof SERIES_OPTIONS)[number] | "" }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none disabled:bg-sand/40 disabled:text-ink/35">
              <option value="">Todas</option>
              {SERIES_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>Jogador</span>
            <select
              value={form.playerName}
              onChange={(event) => setForm((current) => ({ ...current, playerName: event.target.value }))}
              disabled={isLoadingFormPlayers}
              className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none disabled:bg-sand/40 disabled:text-ink/35"
            >
              <option value="">{isLoadingFormPlayers ? "Carregando jogadores..." : "Todos os jogadores"}</option>
              {selectedPlayerMissingFromOptions ? <option value={form.playerName}>{form.playerName} (fora do recorte atual)</option> : null}
              {formPlayerOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink/52">
              {formPlayersError
                ? `Nao foi possivel carregar a lista desta liga: ${formPlayersError}`
                : "Selecione um jogador da liga escolhida ou deixe em Todos os jogadores."}
            </span>
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>APX minimo</span>
            <input ref={apxMinInputRef} type="number" min="0" max="100" step="0.01" value={form.apxMin} onChange={(event) => setForm((current) => ({ ...current, apxMin: event.target.value }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none" />
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>Disparar a partir da ocorrencia</span>
            <input type="number" min="1" step="1" value={form.minOccurrences} onChange={(event) => setForm((current) => ({ ...current, minOccurrences: event.target.value }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none" />
          </label>

          <label className="grid gap-2 text-sm text-ink/72">
            <span>Janela em dias</span>
            <select value={form.windowDays} onChange={(event) => setForm((current) => ({ ...current, windowDays: event.target.value }))} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none">
              {DAYS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} dias
                </option>
              ))}
            </select>
          </label>

          {form.transportType === "webhook" ? (
            <label className="grid gap-2 text-sm text-ink/72">
              <span>Webhook</span>
              <input value={form.webhookUrl} onChange={(event) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))} placeholder="https://seu-endpoint.exemplo/alerts" className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none" />
            </label>
          ) : (
            <div className="grid gap-2 rounded-[1rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <span className="font-semibold">Envio via Telegram</span>
              <p>Use o TELEGRAM_BOT_TOKEN no backend e preencha abaixo o chat_id privado ou de grupo.</p>
            </div>
          )}

          <label className="grid gap-2 text-sm text-ink/72 md:col-span-2">
            <span>{form.transportType === "telegram" ? "Chat IDs do Telegram" : "Destinatarios"}</span>
            <textarea value={form.recipients} onChange={(event) => setForm((current) => ({ ...current, recipients: event.target.value }))} rows={3} placeholder={form.transportType === "telegram" ? "123456789 ou -1009876543210" : "+5511999999999, +5511888888888"} className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none" />
            {form.transportType === "telegram" ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink/58">
                <button
                  type="button"
                  onClick={handleSaveTelegramChatIds}
                  className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                >
                  Salvar Chat IDs
                </button>
                <span>{savedTelegramChatIds ? `Padrao salvo: ${savedTelegramChatIds}` : "Nenhum Chat ID padrao salvo neste navegador."}</span>
              </div>
            ) : null}
          </label>

          <label className="grid gap-2 text-sm text-ink/72 md:col-span-2">
            <span>Observacao</span>
            <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Opcional" className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none" />
          </label>

          <div className="md:col-span-2 flex flex-wrap gap-3 pt-2">
            <button type="submit" className="inline-flex rounded-full bg-[#20352e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#172821]">
              {editingRuleId ? "Salvar alteracoes" : "Criar regra"}
            </button>
            {editingRuleId ? (
              <button type="button" onClick={handleCancelEdit} className="inline-flex rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-ink/20">
                Cancelar edicao
              </button>
            ) : null}
            {form.transportType === "webhook" ? (
              <button type="button" onClick={handleUseLocalWebhook} className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100">
                Usar webhook local
              </button>
            ) : null}
            <button type="button" onClick={() => void handleDryRun()} className="inline-flex rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-ink/20">
              Rodar dry-run geral
            </button>
          </div>
        </form>
        </div>
      </SurfaceCard>
      ) : null}

      <section className="grid gap-5">
        {activeMainTab === "rules" ? (
        <SurfaceCard>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Regras</p>
              <h2 className="mt-3 font-display text-3xl text-ink">Regras cadastradas</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink/60">
                <span className={`inline-flex rounded-full px-3 py-1 font-semibold uppercase tracking-[0.14em] ${syncState.status === "ok" ? "bg-emerald-100 text-emerald-800" : syncState.status === "error" ? "bg-rose-100 text-rose-800" : syncState.status === "syncing" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>
                  {syncState.status === "ok" ? "Conexao ok" : syncState.status === "error" ? "Falha na conexao" : syncState.status === "syncing" ? "Sincronizando" : "Aguardando"}
                </span>
                <span>{syncState.lastSyncedAt ? `Ultima sincronizacao: ${formatDateTime(syncState.lastSyncedAt)}` : "Sem sincronizacao concluida ainda."}</span>
              </div>
              {syncState.message ? <p className="mt-2 text-sm text-ink/60">{syncState.message}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleRefreshRules()}
                disabled={isRefreshingRules || syncState.status === "syncing"}
                className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRefreshingRules || syncState.status === "syncing" ? "Atualizando..." : "Atualizar regras"}
              </button>
              <p className="text-xs uppercase tracking-[0.16em] text-ink/48">{rules.length} registro(s)</p>
            </div>
          </div>

          {rulesLoadError ? (
            <div className="mt-5 rounded-[1.15rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Nao foi possivel atualizar as regras pela API agora.</p>
              <p className="mt-1">
                {rules.length ? "A ultima lista carregada foi mantida na tela." : "Nenhuma lista valida foi carregada ainda."} Detalhe: {rulesLoadError}
              </p>
            </div>
          ) : null}

          {rules.length ? (
            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              {rules.map((rule) => (
                <article key={rule.id} className="rounded-[1.3rem] border border-ink/10 bg-white/70 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">{rule.leagueType} · {rule.transportType}</p>
                      <h3 className="mt-2 text-lg font-semibold text-ink">{rule.name}</h3>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${rule.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                      {rule.isActive ? "Ativa" : "Pausada"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-ink/68 sm:grid-cols-2">
                    <p>Metodo: {rule.methodCode}</p>
                    <p>Transporte: {rule.transportType}</p>
                    <p>Serie: {rule.series ?? "Todas"}</p>
                    <p>Jogador: {rule.playerName ?? "Todos"}</p>
                    <p>APX minimo: {rule.apxMin.toFixed(2)}%</p>
                    <p>Disparar a partir da ocorrencia: {rule.minOccurrences}</p>
                    <p>Janela: {rule.windowDays} dias</p>
                    <p>Destinatarios: {rule.recipients.length}</p>
                  </div>

                  {rule.note ? <p className="mt-3 text-sm text-ink/58">{rule.note}</p> : null}

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => handleEditRule(rule)} className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20">
                      Editar
                    </button>
                    {rule.transportType === "webhook" ? (
                      <button type="button" onClick={() => void handleApplyLocalWebhookToRule(rule)} className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100">
                        Aplicar webhook local
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void handleToggleRule(rule)} className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20">
                      {rule.isActive ? "Pausar" : "Ativar"}
                    </button>
                    <button type="button" onClick={() => void handleDryRun(rule.id)} className="inline-flex rounded-full bg-[#20352e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172821]">
                      Dry-run desta regra
                    </button>
                    <button type="button" onClick={() => void handlePreviewCurrentSignals(rule)} className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 transition hover:bg-sky-100">
                      Verificar sinais atuais
                    </button>
                    <button type="button" onClick={() => void handleDispatchCurrentSignals(rule)} className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100">
                      Disparar sinais atuais
                    </button>
                    <button type="button" onClick={() => void handleTestDispatch(rule)} className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-900 transition hover:bg-violet-100">
                      Disparo de teste
                    </button>
                    <button type="button" onClick={() => void handleDeleteRule(rule)} className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100">
                      Remover
                    </button>
                  </div>

                  {currentSignalsByRule[rule.id] ? (
                    <div className="mt-5 rounded-[1.15rem] border border-ink/10 bg-[#f7f4ec] p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Sinais atuais</p>
                      <div className="mt-3 grid gap-2 text-sm text-ink/68 sm:grid-cols-2">
                        <p>Filtro jogador: {rule.playerName ?? "Todos"}</p>
                        <p>Elegiveis agora: {currentSignalsByRule[rule.id].totalEligibleSignals}</p>
                        <p>Ja processados: {currentSignalsByRule[rule.id].alreadyProcessedSignals}</p>
                        <p>Confrontos lidos: {currentSignalsByRule[rule.id].matchedRows}</p>
                        {currentSignalsByRule[rule.id].attemptedSignals !== undefined ? <p>Tentados agora: {currentSignalsByRule[rule.id].attemptedSignals}</p> : null}
                        {currentSignalsByRule[rule.id].dispatchedSignals !== undefined ? <p>Enviados agora: {currentSignalsByRule[rule.id].dispatchedSignals}</p> : null}
                        {currentSignalsByRule[rule.id].remainingSignals !== undefined ? <p>Restantes apos limite: {currentSignalsByRule[rule.id].remainingSignals}</p> : null}
                      </div>

                      {currentSignalsByRule[rule.id].signals.length ? (
                        <div className="mt-4 space-y-3">
                          {currentSignalsByRule[rule.id].signals.map((signal, index) => (
                            <div key={signal.signalKey} className="rounded-[1rem] border border-ink/10 bg-white/80 p-3 text-sm text-ink/72">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="font-semibold text-ink">{signal.confrontationLabel}</p>
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                                  {signal.result} · {signal.apx.toFixed(2)}%
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                                {signal.sourceView && signal.sourceView !== "historical" && index === 0 ? <span className="inline-flex rounded-full bg-[#7a3f34] px-3 py-1 font-semibold uppercase tracking-[0.14em] text-white">Proximo</span> : null}
                                {rule.playerName ? <span className="inline-flex rounded-full bg-sky-100 px-3 py-1 font-semibold uppercase tracking-[0.14em] text-sky-800">Filtro: {rule.playerName}</span> : null}
                                {signal.playerName ? <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 font-semibold uppercase tracking-[0.14em] text-emerald-800">Jogador: {signal.playerName}</span> : null}
                                {signal.opponentName ? <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 font-semibold uppercase tracking-[0.14em] text-amber-900">Oponente: {signal.opponentName}</span> : null}
                                <span className={`inline-flex rounded-full px-3 py-1 font-semibold uppercase tracking-[0.14em] ${getFuturePriorityMeta({ playedAtIso: signal.occurrencePlayedAt, apx: signal.apx, totalOccurrences: signal.totalOccurrences }).className}`}>
                                  {getFuturePriorityMeta({ playedAtIso: signal.occurrencePlayedAt, apx: signal.apx, totalOccurrences: signal.totalOccurrences }).label}
                                </span>
                                <span className="inline-flex rounded-full border border-ink/10 bg-white px-3 py-1 font-semibold uppercase tracking-[0.14em] text-ink/70">
                                  {formatRelativeKickoff(signal.occurrencePlayedAt)}
                                </span>
                              </div>
                              <div className="mt-3 grid gap-2 text-xs text-ink/58 sm:grid-cols-2 xl:grid-cols-4">
                                <p>Fonte: {signal.sourceView === "historical" ? "Historico" : signal.sourceView === "future-player-sessions" ? "Future jogador" : "Future"}</p>
                                <p>Metodo: {signal.methodCode ?? rule.methodCode}</p>
                                <p>Fixture: {signal.fixtureLabel ?? signal.confrontationLabel}</p>
                                <p>Grupo: {signal.groupLabel ?? rule.series ?? "-"}</p>
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <p>Jogo: {signal.localPlayedAtLabel}</p>
                                <p>Placar: {signal.fullTimeScore}</p>
                                <p>Ocorrencias: {signal.totalOccurrences}</p>
                                <p>Dia: {signal.dayKey}</p>
                                {signal.playerName ? <p>Jogador em sinal: {signal.playerName}</p> : null}
                                {signal.opponentName ? <p>Oponente: {signal.opponentName}</p> : null}
                                {signal.deliveryStatus ? <p>Status envio: {signal.deliveryStatus}</p> : null}
                                {signal.deliveryInfo ? <p className="text-xs text-ink/58">Info: {truncate(signal.deliveryInfo, 120)}</p> : null}
                              </div>
                              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.16em] text-brand-strong">Gatilho metodo</p>
                                  <div className="mt-2">{renderSignalSequence(signal.triggerSequence)}</div>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.16em] text-brand-strong">Historico sequencia dia</p>
                                  <div className="mt-2">{renderSignalSequence(signal.daySequence)}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-[1rem] border border-dashed border-ink/15 bg-white/60 px-4 py-4 text-sm text-ink/58">
                          Nenhum sinal elegivel agora para esta regra.
                        </div>
                      )}
                    </div>
                  ) : null}

                  <p className="mt-4 text-xs uppercase tracking-[0.14em] text-ink/42">Atualizada em {formatDateTime(rule.updatedAt)}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
              {rulesLoadError ? "A API falhou ao carregar as regras nesta tentativa. Use o botao acima para tentar novamente." : "Nenhuma regra retornada pela API ainda."}
            </div>
          )}

        </SurfaceCard>
        ) : null}

        {activeMainTab === "webhook" ? (
          <>
            <SurfaceCard>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Webhook local</p>
                  <h2 className="mt-3 font-display text-3xl text-ink">Coletor de inspecao</h2>
                  <p className="mt-3 text-sm leading-7 text-ink/68">
                    Use esta URL como webhook da regra para verificar o payload sem depender do bridge real do WhatsApp.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(localWebhookUrl)}
                  className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20"
                >
                  Copiar URL
                </button>
              </div>

              <div className="mt-5 rounded-[1.2rem] border border-ink/10 bg-[#f7f4ec] px-4 py-4 text-sm text-ink/74">
                <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">URL</p>
                <p className="mt-2 break-all font-medium text-ink">{localWebhookUrl}</p>
                <p className="mt-3 text-xs leading-6 text-ink/58">Use o botao Aplicar webhook local nos cards ou o botao Usar webhook local no formulario para apontar a regra automaticamente para este coletor.</p>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => startTransition(() => void refreshData())}
                  className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20"
                >
                  Atualizar capturas
                </button>
                <button
                  type="button"
                  onClick={() => void handleClearDebugEvents()}
                  className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100"
                >
                  Limpar capturas
                </button>
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Capturas locais</p>
                  <h2 className="mt-3 font-display text-3xl text-ink">Payloads recebidos</h2>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-ink/48">{debugEvents.length} evento(s)</p>
              </div>

              {debugEvents.length ? (
                <div className="mt-6 space-y-3">
                  {debugEvents.map((event) => (
                    <article key={event.id} className="rounded-[1.25rem] border border-ink/10 bg-white/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Recebido em {formatDateTime(event.receivedAt)}</p>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
                          {event.id}
                        </span>
                      </div>
                      <pre className="mt-4 overflow-x-auto rounded-[1rem] bg-[#1c201d] p-4 text-xs leading-6 text-[#edf3ea]">
                        {JSON.stringify(event.body, null, 2)}
                      </pre>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
                  Nenhum payload chegou no coletor local ainda.
                </div>
              )}
            </SurfaceCard>
          </>
        ) : null}

        {activeMainTab === "dispatches" ? (
          <SurfaceCard>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Historico</p>
                <h2 className="mt-3 font-display text-3xl text-ink">Ultimos disparos</h2>
                <p className="mt-3 text-sm leading-7 text-ink/68">Cada card mostra o confronto disparado, a mensagem persistida e o retorno do transporte para validar o envio.</p>
              </div>
              <div className="flex flex-col items-end gap-2 text-right">
                <p className="text-xs uppercase tracking-[0.16em] text-ink/48">{dispatches.length} registro(s)</p>
                <p className="text-xs text-ink/55">Atualizacao automatica a cada 60s</p>
                <Link href="/alerts/pastmethods" className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 transition hover:bg-sky-100">
                  Abrir pagina completa
                </Link>
              </div>
            </div>

            {dispatches.length ? (
              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                {dispatches.map((dispatch) => {
                  const payload = parseDispatchPayload(dispatch.payloadText);
                  const signal = payload?.signal;
                  const recipientsLabel = payload?.recipients?.length ? payload.recipients.join(", ") : dispatch.recipients.join(", ");
                  const eventType = dispatch.eventType ?? payload?.eventType ?? inferDispatchEventTypeFromSignalKey(dispatch.signalKey);
                  const eventMeta = getDispatchEventMeta(eventType);

                  return (
                  <article key={dispatch.id} className="rounded-[1.25rem] border border-ink/10 bg-white/70 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">{dispatch.ruleName ?? "Regra"}</p>
                        <h3 className="mt-2 text-base font-semibold text-ink">{dispatch.confrontationLabel}</h3>
                        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-ink/48">{dispatch.methodCode ?? "-"} · {dispatch.leagueType ?? "-"} · chave {dispatch.signalKey}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${eventMeta.className}`}>
                          {eventMeta.label}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${dispatch.transportStatus === "sent" ? "bg-emerald-100 text-emerald-800" : dispatch.transportStatus === "failed" ? "bg-rose-100 text-rose-800" : dispatch.transportStatus === "duplicate" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>
                          {dispatch.transportStatus}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-ink/72">
                      {signal?.playerName ? <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1">Jogador: {signal.playerName}</span> : null}
                      {signal?.opponentName ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1">Oponente: {signal.opponentName}</span> : null}
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Dia: {dispatch.dayKey}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Jogo: {signal?.localPlayedAtLabel ?? formatDateTime(dispatch.occurrencePlayedAt)}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Evento: {eventMeta.shortLabel}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Resultado: {signal?.result ?? "-"}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Placar: {signal?.fullTimeScore ?? "-"}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">APX: {(signal?.apx ?? dispatch.apx).toFixed(2)}%</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Ocorrencias: {signal?.totalOccurrences ?? dispatch.totalOccurrences}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Criado: {formatDateTime(dispatch.createdAt)}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Atualizado: {formatDateTime(dispatch.updatedAt)}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Enviado: {dispatch.sentAt ? formatDateTime(dispatch.sentAt) : "-"}</span>
                      <span className="rounded-full border border-ink/10 bg-[#f7f4ec] px-3 py-1">Destinatarios: {recipientsLabel || "-"}</span>
                    </div>

                    {payload?.message || dispatch.transportResponse ? (
                      <div className="mt-4 grid gap-3 xl:grid-cols-2">
                        {payload?.message ? (
                          <div className="rounded-[1rem] border border-ink/10 bg-[#f7f4ec] p-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Mensagem enviada</p>
                            <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink/78">{payload.message}</pre>
                          </div>
                        ) : null}

                        {dispatch.transportResponse ? (
                          <div className="rounded-[1rem] border border-ink/10 bg-[#f7f4ec] p-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Retorno do transporte</p>
                            <p className="mt-3 text-xs leading-6 text-ink/60">{truncate(dispatch.transportResponse, 320)}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
                Nenhum disparo encontrado ainda.
              </div>
            )}
          </SurfaceCard>
        ) : null}
      </section>
      </>
      ) : null}

      {activeMainTab === "backup" ? (
      <SurfaceCard>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Backup local</p>
            <h2 className="mt-3 font-display text-3xl text-ink">Exportar e restaurar regras</h2>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Em modo memoria, use este snapshot JSON para guardar as regras antes de reiniciar a API e depois restaurar tudo em poucos cliques.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleExportBackup()}
              className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20"
            >
              Baixar backup JSON
            </button>
            <button
              type="button"
              onClick={() => void handleSaveBackupToServer()}
              className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 transition hover:bg-sky-100"
            >
              Salvar backup no servidor
            </button>
            <label className="inline-flex cursor-pointer rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20">
              Carregar arquivo JSON
              <input type="file" accept="application/json,.json" onChange={(event) => void handleBackupFileChange(event)} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(backupText)}
              disabled={!backupText.trim()}
              className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Copiar JSON
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <label className="grid gap-2 text-sm text-ink/72">
            <span>JSON do backup</span>
            <textarea
              value={backupText}
              onChange={(event) => setBackupText(event.target.value)}
              rows={14}
              placeholder='{
  "format": "sheva-method-alert-rules",
  "version": 1,
  "rules": []
}'
              className="rounded-[1rem] border border-ink/10 bg-white px-4 py-3 font-mono text-xs leading-6 text-ink outline-none"
            />
          </label>

          <div className="grid gap-4 content-start">
            <div className="rounded-[1.2rem] border border-ink/10 bg-[#f7f4ec] p-4 text-sm text-ink/72">
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Como usar</p>
              <p className="mt-3">1. Clique em Baixar backup JSON para gerar um snapshot atual.</p>
              <p className="mt-2">2. Depois de reiniciar a API, cole o JSON aqui ou carregue um arquivo .json.</p>
              <p className="mt-2">3. O import ignora regras identicas por padrao.</p>
              <p className="mt-2">4. Importe em append ou substituindo o estado atual.</p>
              {backupFileName ? <p className="mt-3 text-xs text-ink/58">Arquivo carregado: {backupFileName}</p> : null}
            </div>

            <div className="rounded-[1.2rem] border border-ink/10 bg-white p-4 text-sm text-ink/72">
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Snapshot do servidor</p>
              {localBackupStatus?.exists ? (
                <>
                  <p className="mt-3">Arquivo: {localBackupStatus.latestFileName}</p>
                  <p className="mt-2">Gerado em: {localBackupStatus.exportedAt ? formatDateTime(localBackupStatus.exportedAt) : "-"}</p>
                  <p className="mt-2">Tamanho: {formatBytes(localBackupStatus.sizeBytes)}</p>
                  <p className="mt-2 break-all text-xs text-ink/58">Diretorio: {localBackupStatus.directoryPath}</p>
                  <p className="mt-2 break-all text-xs text-ink/58">Alias latest: {localBackupStatus.filePath}</p>
                </>
              ) : (
                <p className="mt-3">Nenhum backup local do servidor foi salvo ainda.</p>
              )}
            </div>

            <div className="rounded-[1.2rem] border border-ink/10 bg-white p-4 text-sm text-ink/72">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Historico de snapshots</p>
                <span className="text-xs uppercase tracking-[0.14em] text-ink/48">{localBackupHistory.length} item(ns)</span>
              </div>

              {localBackupHistory.length ? (
                <div className="mt-3 space-y-3">
                  {localBackupHistory.map((item) => (
                    <div key={item.fileName} className="rounded-[1rem] border border-ink/10 bg-[#f7f4ec] p-3">
                      <p className="break-all text-sm font-semibold text-ink">{item.fileName}</p>
                      <p className="mt-1 text-xs text-ink/58">Gerado em: {item.exportedAt ? formatDateTime(item.exportedAt) : formatDateTime(item.modifiedAt)}</p>
                      <p className="mt-1 text-xs text-ink/58">Tamanho: {formatBytes(item.sizeBytes)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3">Nenhum snapshot versionado encontrado ainda.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleImportBackup(false)}
                className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/20"
              >
                Importar em append
              </button>
              <button
                type="button"
                onClick={() => void handleRestoreLatestServerBackup(false)}
                disabled={!localBackupStatus?.exists}
                className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Restaurar ultimo backup do servidor
              </button>
              <button
                type="button"
                onClick={() => void handleImportBackup(true)}
                className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                Importar substituindo tudo
              </button>
              <button
                type="button"
                onClick={() => void handleRestoreLatestServerBackup(true)}
                disabled={!localBackupStatus?.exists}
                className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Restaurar ultimo backup substituindo tudo
              </button>
            </div>
          </div>
        </div>
      </SurfaceCard>
      ) : null}
    </div>
  );
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      return { ok: false, message };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Falha de comunicacao com a API" };
  }
}

async function extractErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? `Falha HTTP ${response.status}`;
  } catch {
    return `Falha HTTP ${response.status}`;
  }
}

function parseRecipients(value: string) {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCurrentJPlayerNames(snapshot: CurrentJSnapshot) {
  return Array.from(
    new Set(
      snapshot.players
        .map((player) => player.name.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function readAlertsOverviewCache(): AlertsOverviewCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(ALERTS_OVERVIEW_CACHE_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<AlertsOverviewCache>;
    if (!Array.isArray(parsed.rules) || !Array.isArray(parsed.dispatches) || typeof parsed.syncedAt !== "string") {
      return null;
    }

    return {
      rules: parsed.rules as AlertRule[],
      dispatches: parsed.dispatches as AlertDispatch[],
      syncedAt: parsed.syncedAt,
    };
  } catch {
    return null;
  }
}

function writeAlertsOverviewCache(value: AlertsOverviewCache) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ALERTS_OVERVIEW_CACHE_STORAGE_KEY, JSON.stringify(value));
  } catch {}
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function getSignalSequencePillClass(result: string) {
  if (result === "W") {
    return "bg-[#20352e] text-white";
  }

  if (result === "L") {
    return "bg-[#7a3f34] text-white";
  }

  if (result === "D" || result === "E") {
    return "bg-[#c6b487] text-ink";
  }

  return "bg-slate-100 text-slate-700";
}

function renderSignalSequence(sequence?: string[]) {
  if (!sequence?.length) {
    return <span className="text-xs text-ink/45">-</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sequence.map((result, index) => (
        <span key={`${result}-${index}`} className={`inline-flex min-w-8 items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSignalSequencePillClass(result)}`}>
          {result}
        </span>
      ))}
    </div>
  );
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatBytes(value: number | null) {
  if (value === null) {
    return "-";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function parseDispatchPayload(value: string | null | undefined): AlertDispatchPayload | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as AlertDispatchPayload;
  } catch {
    return null;
  }
}

function inferDispatchEventTypeFromSignalKey(signalKey: string) {
  return signalKey.endsWith("::resolved") ? "result_followup" : "initial_signal";
}

function getDispatchEventMeta(eventType: "initial_signal" | "result_followup") {
  if (eventType === "result_followup") {
    return {
      label: "Resultado final",
      shortLabel: "resultado",
      className: "bg-sky-100 text-sky-800",
    };
  }

  return {
    label: "Sinal inicial",
    shortLabel: "inicial",
    className: "bg-[#efe4c8] text-[#6f5312]",
  };
}

function readSavedTelegramChatIds() {
  if (typeof window === "undefined") {
    return "";
  }

  return localStorage.getItem(TELEGRAM_CHAT_IDS_STORAGE_KEY)?.trim() ?? "";
}

function firstErrorMessage(
  ...responses: Array<{ ok: true; data: unknown } | { ok: false; message: string }>
) {
  return responses.find((item) => !item.ok)?.message ?? null;
}
