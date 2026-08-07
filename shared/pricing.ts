/**
 * Pricing contract — shared between the routing engine and the dashboard.
 *
 * TYPE-ONLY, same rule as `types.ts`: no runtime values in this directory.
 * The dashboard's reference rate table lives in `frontend/lib/pricing.ts` and
 * exists only so mock numbers are defensible. The frontend prices nothing —
 * every cost it displays comes from the engine via `CostComparison`.
 */

/** Rates are USD per 1,000,000 tokens. */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/** Keyed by `ModelRef.id`. */
export type PricingTable = Record<string, ModelPricing>;
