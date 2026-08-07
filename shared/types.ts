/**
 * Routing event contract — shared between the routing engine and the dashboard.
 *
 * IMPORTANT FOR ALL CONTRIBUTORS
 * This directory is TYPE-ONLY. Do not add `const`, functions, or any runtime
 * value here. The frontend imports these with `import type`, which is erased
 * before module resolution runs — that is the only reason a file outside the
 * Next.js project root resolves at all. A runtime export would break the build.
 * Runtime values belong in `frontend/lib/`.
 *
 * The dashboard is a pure renderer: it formats these values and never
 * recomputes or mutates them. Whatever the engine emits is what gets shown.
 */

/**
 * Lifecycle of a single delegated subtask.
 * `cached` means the result was served from cache — no model call was billed.
 */
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cached";

/**
 * A model the router can delegate to.
 *
 * Deliberately not a union of known models: the engine may add providers or
 * model versions without a frontend release. The UI renders `displayName` and
 * groups by `provider`; it never parses `id`.
 */
export interface ModelRef {
  /** Provider's own identifier, e.g. "claude-sonnet-4-5". */
  id: string;
  /** Human-readable label, e.g. "Claude Sonnet". */
  displayName: string;
  /** Provider slug, e.g. "anthropic", "openai", "google". Free-form. */
  provider: string;
}

/** Raw token counts. Totals are derived by the consumer, never stored. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * The project's value proposition, in one shape.
 *
 * Used identically at task level (this subtask vs. its alternative model) and
 * at event level (the whole prompt vs. a single-model baseline). `savings` and
 * `savingsPercent` are supplied rather than derived so the engine stays the
 * single source of truth for cost math.
 */
export interface CostComparison {
  /** USD actually spent. */
  withRouting: number;
  /** USD the baseline/alternative model would have cost. */
  withoutRouting: number;
  /** USD saved: withoutRouting - withRouting. May be 0 or negative. */
  savings: number;
  /** Percentage saved, 0-100. */
  savingsPercent: number;
}

/** One unit of delegated work. */
export interface Task {
  id: string;
  /** Short imperative label, e.g. "Refactor React component". */
  name: string;
  /** The model the router selected. */
  model: ModelRef;
  /**
   * The agent harness that executed the task, e.g. "claude-code", "gemini-cli",
   * "codex". Free-form for the same reason `ModelRef.provider` is. Optional so
   * a router that doesn't delegate across harnesses can omit it.
   */
  harness?: string;
  /** What routing avoided. Omit when no meaningful comparison exists. */
  alternativeModel?: ModelRef;
  /** Why the router chose `model` — shown verbatim to the user. */
  reason: string;
  usage: TokenUsage;
  cost: CostComparison;
  status: TaskStatus;
  /** Wall-clock duration in milliseconds. Omit while queued. */
  latencyMs?: number;
}

/** Event-level rollup. Supplied by the engine; the dashboard does not compute it. */
export interface RoutingSummary {
  /** Distinct models used across `tasks`, in first-use order. */
  modelsUsed: ModelRef[];
  taskCount: number;
  usage: TokenUsage;
  cost: CostComparison;
  averageLatencyMs: number;
}

/**
 * One user prompt and everything the router did with it.
 * This is the top-level object the dashboard renders.
 */
export interface RoutingEvent {
  id: string;
  /** The user's original prompt, verbatim. */
  prompt: string;
  /** ISO 8601 timestamp of when the prompt was received. */
  timestamp: string;
  /** Routing strategy in effect, e.g. "cost-optimized". Free-form. */
  strategy: string;
  summary: RoutingSummary;
  tasks: Task[];
}
