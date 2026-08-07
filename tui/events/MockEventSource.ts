import type { ModelRef, Task, TaskStatus } from "../../shared/types";
import type {
  ConnectionStatus,
  RoutingEvent,
  RoutingEventSource,
  RoutingSnapshot,
} from "./types";

/**
 * Scripted orchestration run used until the real scheduler exists.
 *
 * Costs are computed here rather than hardcoded, so the numbers on screen are
 * always internally consistent: tokens x rate = cost, tasks sum to the summary,
 * and savings match the baseline comparison. A real source will receive these
 * figures from the engine instead of deriving them.
 */

/** USD per 1,000,000 tokens. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "claude-opus-4-5": { input: 5.0, output: 25.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5": { input: 1.25, output: 10.0 },
};

const MODELS: Record<string, ModelRef> = {
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    displayName: "Gemini Flash",
    provider: "google",
  },
  "claude-opus-4-5": {
    id: "claude-opus-4-5",
    displayName: "Claude Opus",
    provider: "anthropic",
  },
  "claude-sonnet-4-5": {
    id: "claude-sonnet-4-5",
    displayName: "Claude Sonnet",
    provider: "anthropic",
  },
  "gpt-5-mini": { id: "gpt-5-mini", displayName: "GPT-5 mini", provider: "openai" },
  "gpt-5": { id: "gpt-5", displayName: "GPT-5", provider: "openai" },
};

/** "What if the whole run had used the strongest model?" */
const BASELINE_MODEL_ID = "claude-opus-4-5";

const GOAL =
  "Build an authentication system with email/password login, session refresh, and rate-limited password reset.";

interface PlannedTask {
  id: string;
  name: string;
  modelId: string;
  harness: string;
  reason: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const TASK_PLAN: readonly PlannedTask[] = [
  {
    id: "t1",
    name: "Repository Scan",
    modelId: "gemini-2.5-flash",
    harness: "gemini-cli",
    reason: "Large-context file traversal at the lowest cost per token",
    inputTokens: 48_000,
    outputTokens: 7_000,
    latencyMs: 4_200,
  },
  {
    id: "t2",
    name: "Architecture Planning",
    modelId: "claude-opus-4-5",
    harness: "claude-code",
    reason: "Deep reasoning over auth threat model — routed to the strongest model",
    inputTokens: 5_000,
    outputTokens: 1_200,
    latencyMs: 12_800,
  },
  {
    id: "t3",
    name: "Code Generation",
    modelId: "claude-sonnet-4-5",
    harness: "claude-code",
    reason: "Multi-file code generation against an already-settled design",
    inputTokens: 32_000,
    outputTokens: 6_000,
    latencyMs: 21_400,
  },
  {
    id: "t4",
    name: "Test Suite",
    modelId: "gpt-5-mini",
    harness: "codex",
    reason: "Repetitive test scaffolding from an established pattern",
    inputTokens: 15_000,
    outputTokens: 6_000,
    latencyMs: 9_100,
  },
  {
    id: "t5",
    name: "Security Review",
    modelId: "gpt-5",
    harness: "codex",
    reason: "Adversarial review of session and reset flows",
    inputTokens: 11_000,
    outputTokens: 3_500,
    latencyMs: 14_600,
  },
];

interface Step {
  label: string;
  detail?: string;
  /** Tasks absent from this map have not been created yet. */
  statuses: Record<string, TaskStatus>;
}

const STEPS: readonly Step[] = [
  {
    label: "Goal received",
    detail: GOAL,
    statuses: {},
  },
  {
    label: "Planner decomposed goal into 5 tasks",
    detail: "Awaiting model + harness assignment",
    statuses: { t1: "queued", t2: "queued", t3: "queued", t4: "queued", t5: "queued" },
  },
  {
    label: "Dispatched Repository Scan",
    detail: "Gemini Flash via gemini-cli",
    statuses: { t1: "running", t2: "queued", t3: "queued", t4: "queued", t5: "queued" },
  },
  {
    label: "Repository Scan served from cache",
    detail: "Architecture Planning dispatched to Claude Opus via claude-code",
    statuses: { t1: "cached", t2: "running", t3: "queued", t4: "queued", t5: "queued" },
  },
  {
    label: "Architecture Planning complete",
    detail: "Code Generation dispatched to Claude Sonnet via claude-code",
    statuses: { t1: "cached", t2: "completed", t3: "running", t4: "queued", t5: "queued" },
  },
  {
    label: "Code Generation complete",
    detail: "Test Suite dispatched to GPT-5 mini via codex",
    statuses: {
      t1: "cached",
      t2: "completed",
      t3: "completed",
      t4: "running",
      t5: "queued",
    },
  },
  {
    label: "Test Suite failed — 2 assertions rejected",
    detail: "Security Review dispatched to GPT-5 via codex",
    statuses: {
      t1: "cached",
      t2: "completed",
      t3: "completed",
      t4: "failed",
      t5: "running",
    },
  },
  {
    label: "Run complete",
    detail: "5 tasks across 5 models and 3 harnesses",
    statuses: {
      t1: "cached",
      t2: "completed",
      t3: "completed",
      t4: "failed",
      t5: "completed",
    },
  },
];

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function price(modelId: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING[modelId];
  if (!rate) return 0;
  return round6((inputTokens / 1e6) * rate.input + (outputTokens / 1e6) * rate.output);
}

/**
 * Running tasks have only partly streamed, so they contribute a fraction of
 * their eventual tokens. This is what makes the metrics climb as the run
 * progresses instead of jumping at the end.
 */
function progressFraction(status: TaskStatus): number {
  switch (status) {
    case "queued":
      return 0;
    case "running":
      return 0.5;
    default:
      return 1;
  }
}

function buildTask(plan: PlannedTask, status: TaskStatus): Task {
  const fraction = progressFraction(status);
  const inputTokens = Math.round(plan.inputTokens * fraction);
  const outputTokens = Math.round(plan.outputTokens * fraction);

  // A cache hit bills nothing — that is the entire point of the cache.
  const withRouting =
    status === "cached" ? 0 : price(plan.modelId, inputTokens, outputTokens);
  const withoutRouting = price(BASELINE_MODEL_ID, inputTokens, outputTokens);
  const savings = round6(withoutRouting - withRouting);
  const savingsPercent = withoutRouting === 0 ? 0 : (savings / withoutRouting) * 100;

  const selected = MODELS[plan.modelId]!;
  const baseline = MODELS[BASELINE_MODEL_ID]!;

  return {
    id: plan.id,
    name: plan.name,
    model: selected,
    harness: plan.harness,
    // Omitted when the router picked the baseline anyway — there is no
    // meaningful "instead of" to show.
    ...(plan.modelId === BASELINE_MODEL_ID ? {} : { alternativeModel: baseline }),
    reason: plan.reason,
    usage: { inputTokens, outputTokens },
    cost: { withRouting, withoutRouting, savings, savingsPercent },
    status,
    ...(status === "queued" ? {} : { latencyMs: Math.round(plan.latencyMs * fraction) }),
  };
}

function buildSnapshot(stepIndex: number): RoutingSnapshot {
  const step = STEPS[stepIndex]!;

  const tasks = TASK_PLAN.filter((plan) => step.statuses[plan.id] !== undefined).map(
    (plan) => buildTask(plan, step.statuses[plan.id]!),
  );

  const inputTokens = tasks.reduce((sum, t) => sum + t.usage.inputTokens, 0);
  const outputTokens = tasks.reduce((sum, t) => sum + t.usage.outputTokens, 0);
  const withRouting = round6(tasks.reduce((sum, t) => sum + t.cost.withRouting, 0));
  const withoutRouting = round6(tasks.reduce((sum, t) => sum + t.cost.withoutRouting, 0));
  const savings = round6(withoutRouting - withRouting);
  const savingsPercent = withoutRouting === 0 ? 0 : (savings / withoutRouting) * 100;

  const timed = tasks.filter((t) => typeof t.latencyMs === "number");
  const averageLatencyMs = timed.length
    ? Math.round(timed.reduce((sum, t) => sum + (t.latencyMs ?? 0), 0) / timed.length)
    : 0;

  const modelsUsed: ModelRef[] = [];
  for (const task of tasks) {
    if (!modelsUsed.some((m) => m.id === task.model.id)) modelsUsed.push(task.model);
  }

  return {
    id: `evt_step_${stepIndex + 1}`,
    prompt: GOAL,
    timestamp: new Date().toISOString(),
    strategy: "cost-optimized",
    summary: {
      modelsUsed,
      taskCount: tasks.length,
      usage: { inputTokens, outputTokens },
      cost: { withRouting, withoutRouting, savings, savingsPercent },
      averageLatencyMs,
    },
    tasks,
  };
}

export class MockEventSource implements RoutingEventSource {
  readonly supportsManualAdvance = true;
  readonly totalSteps = STEPS.length;

  #index = 0;
  #listeners = new Set<(event: RoutingEvent) => void>();

  current(): RoutingEvent {
    const step = STEPS[this.#index]!;
    return {
      id: `step-${this.#index + 1}`,
      step: this.#index + 1,
      label: step.label,
      detail: step.detail,
      snapshot: buildSnapshot(this.#index),
    };
  }

  next(): RoutingEvent {
    // Wraps so the demo can be replayed without restarting the process.
    this.#index = (this.#index + 1) % STEPS.length;
    const event = this.current();
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  subscribe(callback: (event: RoutingEvent) => void): () => void {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  getStatus(): ConnectionStatus {
    return "connected";
  }
}
