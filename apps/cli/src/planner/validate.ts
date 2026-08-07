import { assignableModels } from "../core/catalog.js";
import { plannerOutputSchema, type PlannerOutput } from "../core/plan.js";
import type { ModelCatalogEntry } from "../core/types.js";

export interface ValidationFailure {
  gate: "schema" | "registry" | "graph" | "budget";
  field?: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; plan: PlannerOutput }
  | { ok: false; failures: ValidationFailure[] };

/**
 * All gates run before anything is persisted. Gates 1 and 2 overlap with the
 * generated schema enum on purpose — the enum should make them unreachable,
 * and if one ever fires it means the constraint mechanism regressed.
 */
export function validatePlan(
  raw: unknown,
  models: ModelCatalogEntry[],
  budgetUsd: number | null,
): ValidationResult {
  const assignable = assignableModels(models);
  const ids = assignable.map((m) => m.id);

  // Gate 1 — schema.
  const parsed = plannerOutputSchema(ids).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      failures: parsed.error.issues.map((issue) => ({
        gate: "schema" as const,
        field: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const plan = parsed.data as PlannerOutput;
  const failures: ValidationFailure[] = [];

  // Gate 2 — registry.
  const byId = new Map(assignable.map((m) => [m.id, m]));
  for (const task of plan.tasks) {
    if (!byId.has(task.model_id)) {
      failures.push({
        gate: "registry",
        field: `${task.id}.model_id`,
        message: `${task.model_id} is not an enabled, available model`,
      });
    }
  }

  // Gate 3 — graph.
  failures.push(...checkGraph(plan));

  // Gate 4 — budget.
  if (budgetUsd !== null) {
    const total = plan.tasks.reduce((sum, t) => sum + t.estimates.estimated_cost_usd, 0);
    if (total > budgetUsd) {
      failures.push({
        gate: "budget",
        message: `estimated $${total.toFixed(4)} exceeds budget $${budgetUsd.toFixed(2)}`,
      });
    }
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, plan };
}

function checkGraph(plan: PlannerOutput): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const seen = new Set<string>();

  for (const task of plan.tasks) {
    if (seen.has(task.id)) {
      failures.push({ gate: "graph", field: task.id, message: "duplicate task id" });
    }
    seen.add(task.id);
  }

  for (const task of plan.tasks) {
    for (const dep of task.dependencies) {
      if (!seen.has(dep)) {
        failures.push({
          gate: "graph",
          field: `${task.id}.dependencies`,
          message: `unknown dependency "${dep}"`,
        });
      }
      if (dep === task.id) {
        failures.push({
          gate: "graph",
          field: `${task.id}.dependencies`,
          message: "task depends on itself",
        });
      }
    }
  }

  // Kahn — anything left unvisited sits in or behind a cycle.
  const indegree = new Map(plan.tasks.map((t) => [t.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const task of plan.tasks) {
    for (const dep of task.dependencies) {
      if (!seen.has(dep) || dep === task.id) continue;
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);
    }
  }

  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    visited += 1;
    for (const next of dependents.get(id) ?? []) {
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  if (visited < plan.tasks.length) {
    failures.push({ gate: "graph", message: "dependency cycle detected" });
  }

  return failures;
}
