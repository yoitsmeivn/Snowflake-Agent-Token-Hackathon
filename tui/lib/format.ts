export function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}

/** Costs run to fractions of a cent, so precision scales with magnitude. */
export function formatCost(value: number): string {
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

export function formatLatency(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** "cost-optimized" -> "Cost Optimized" */
export function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
