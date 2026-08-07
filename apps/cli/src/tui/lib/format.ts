// Adapted from the tui-monitor branch so both surfaces read as one product.

export function formatTokens(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

/** Costs run to fractions of a cent, so precision scales with magnitude. */
export function formatCost(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "free";
  const decimals = Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toFixed(decimals)}`;
}

/**
 * Formats related costs at one shared precision. Shown side by side, mixed
 * decimal places ("$1.15 → $0.3055") read as a rendering bug rather than a
 * comparison, so the largest value decides for the whole group.
 */
export function formatCostGroup(...values: number[]): string[] {
  const largest = Math.max(...values.map(Math.abs));
  const decimals = largest < 1 ? 4 : 2;
  return values.map((value) => `$${value.toFixed(decimals)}`);
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}
