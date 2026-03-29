/** Compact display: 12.6M, 100.1k, 1.2B, or 2 decimals for smaller values. */
export function formatCompactBalance(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(2);
}

/** Parse a decimal string (e.g. from JSON / chain) and format compactly. */
export function formatCompactFromDecimalString(s: string): string {
  const n = Number.parseFloat(s);
  return formatCompactBalance(n);
}

/** Competition standings portfolio column: no k/M/B; thousands separators + exactly 3 decimal places. */
export function formatStandingsPortfolioValue(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return '0.000';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
