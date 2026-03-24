function normalizeFiniteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(normalizeFiniteNumber(value));
}

export function formatDecimal(value: number, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(normalizeFiniteNumber(value));
}

export function formatPercent(value: number, digits = 2) {
  return `${formatDecimal(value, digits)}%`;
}

export function formatUnits(value: number, digits = 2) {
  return `${formatDecimal(value, digits)}u`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}