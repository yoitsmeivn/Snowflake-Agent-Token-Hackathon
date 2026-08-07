export type HarnessId = "claude" | "codex" | "opencode" | "gemini";

/** Computed at boot by core/probe.ts. `checking` is the pre-resolution state. */
export type Availability =
  | "checking"
  | "available"
  | "unauthenticated"
  | "not-installed";

export interface ModelCatalogEntry {
  id: string;
  provider: "anthropic" | "openai" | "google" | "local";
  display_name: string;
  /** Which CLIs can actually drive this model. First entry is the one used. */
  harnesses: HarnessId[];
  /** The model identifier as that harness's CLI expects it. */
  harness_model_arg: string;
  local: boolean;
  context_window: number;

  price_input_per_mtok: number | null;
  price_output_per_mtok: number | null;
  price_source:
    | "published"
    | "estimated"
    | "subscription-no-marginal-cost"
    | "local-no-marginal-cost";

  cost_tier: "low" | "medium" | "high" | "premium";
  speed_tier: "fast" | "medium" | "slow";
  capabilities: string[];
  /** Free text shown to the planner. */
  reliability_notes: string;

  enabled: boolean;
  availability: Availability;
  /** Why the row is not available, when it isn't. */
  availability_note?: string;
}

export interface HarnessProbe {
  availability: Availability;
  note?: string;
  version?: string;
}
