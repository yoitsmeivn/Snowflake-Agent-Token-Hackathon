import { harnessOf } from "../core/probe.js";
import type { ModelCatalogEntry } from "../core/types.js";

function price(m: ModelCatalogEntry): string {
  if (m.price_input_per_mtok === null || m.price_output_per_mtok === null) {
    return m.price_source === "local-no-marginal-cost" ? "local (free)" : "subscription";
  }
  return `${m.price_input_per_mtok} / ${m.price_output_per_mtok}`;
}

function ctx(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.floor(n / 1000)}k`;
}

function catalogTable(models: ModelCatalogEntry[]): string {
  const rows = models.map((m) =>
    [
      m.id.padEnd(18),
      harnessOf(m).padEnd(9),
      ctx(m.context_window).padEnd(6),
      price(m).padEnd(14),
      m.cost_tier.padEnd(8),
      m.speed_tier.padEnd(7),
      m.capabilities.join(", "),
    ].join(""),
  );

  const header = [
    "id".padEnd(18),
    "harness".padEnd(9),
    "ctx".padEnd(6),
    "$/MTok in/out".padEnd(14),
    "cost".padEnd(8),
    "speed".padEnd(7),
    "good at",
  ].join("");

  const notes = models
    .filter((m) => m.reliability_notes)
    .map((m) => `- ${m.id}: ${m.reliability_notes}`)
    .join("\n");

  return `${header}\n${rows.join("\n")}\n\nNotes:\n${notes}`;
}

/**
 * Goes into --append-system-prompt. Stable across runs for a given catalog
 * state, so it stays cacheable; the goal and workspace vary and live in the
 * user prompt instead.
 */
export function buildSystemPrompt(models: ModelCatalogEntry[]): string {
  return `You are the PLANNER for an agent orchestration system. You do not implement
anything. You decompose a goal into a directed acyclic graph of tasks and you
allocate each task to a model. Decomposition and allocation are one decision:
a task is only worth splitting out if it can be handed to a cheaper or more
suitable engine, and a model is only assignable once the work unit is bounded.

AVAILABLE MODELS — assign exactly one per task, using its id verbatim.

${catalogTable(models)}

HARD RULES

- Use only model ids from the table above. Nothing else exists.
- Choose a model PER TASK. Do not apply one model to every task.
- Prefer the cheapest model that can actually do the work. Reserve premium
  models for genuinely high-leverage reasoning: architecture, tricky review,
  work that must hold a lot of context at once.
- Respect context windows. Do not give a task that must read broadly to a
  model with a small window.
- Every task needs model_rationale explaining why this CLASS of model suits
  this specific work. "It is good at coding" is not a rationale; say what the
  task demands and why the cheaper option would not hold up, or why the
  expensive one is unnecessary.
- dependencies must form a DAG. Reference task ids only. Roots have [].
- Keep the graph small and legible: 4 to 8 tasks. Split for parallelism and
  for model fit, not for their own sake.
- estimated_cost_usd should follow from your own token estimates and the
  prices above. Subscription and local models have no marginal cost — use 0.
- Explore the repository with Read/Grep/Glob before planning. Ground the tasks
  in files that actually exist.
- Emit the plan only. Do not write files, do not implement.`;
}

export function buildUserPrompt(goal: string, workspace: string): string {
  return `GOAL
${goal}

WORKSPACE
${workspace}

Explore the workspace enough to ground the plan in its real structure, then
emit the execution plan.`;
}
