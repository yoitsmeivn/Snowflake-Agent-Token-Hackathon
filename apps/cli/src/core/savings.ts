import { CATALOG } from "./catalog.js";
import type { DelegationRow } from "./store.js";

export const FRONTIER_ID = "claude-opus-5";

export interface Savings {
  actualUsd: number;
  baselineUsd: number;
  savedUsd: number;
  savingsPercent: number;
  /** Rows with known token counts — the only ones either side is computed from. */
  countedRows: number;
  /** Rows dropped from BOTH sides because their token counts are unknown. */
  excludedRows: number;
  measured: boolean;
}

/**
 * PLAN.md §16, stated precisely:
 *
 *   baseline — what these same delegations would have cost if every one had run
 *              on the frontier model, HOLDING THE OBSERVED TOKEN COUNTS CONSTANT
 *   actual   — the sum of resolved per-delegation costs
 *
 * A row whose token counts are unknown (opencode reports none) is excluded from
 * both sides rather than being counted as free. Excluding from both is what
 * keeps the ratio honest; the excluded count is displayed next to the figure.
 */
export function computeSavings(rows: DelegationRow[]): Savings {
  const frontier = CATALOG.find((m) => m.id === FRONTIER_ID);
  const inRate = frontier?.price_input_per_mtok ?? 0;
  const outRate = frontier?.price_output_per_mtok ?? 0;

  let actualUsd = 0;
  let baselineUsd = 0;
  let countedRows = 0;
  let excludedRows = 0;

  for (const row of rows) {
    if (row.status !== "completed") continue;

    if (row.input_tokens === null || row.output_tokens === null) {
      excludedRows += 1;
      continue;
    }

    countedRows += 1;
    actualUsd += row.cost_usd ?? 0;
    baselineUsd +=
      (row.input_tokens / 1_000_000) * inRate + (row.output_tokens / 1_000_000) * outRate;
  }

  const savedUsd = baselineUsd - actualUsd;
  return {
    actualUsd,
    baselineUsd,
    savedUsd,
    savingsPercent: baselineUsd > 0 ? (savedUsd / baselineUsd) * 100 : 0,
    countedRows,
    excludedRows,
    measured: baselineUsd > 0,
  };
}
