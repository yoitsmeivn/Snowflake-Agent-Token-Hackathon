import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { AGENTPLAN_DIR } from "../core/catalog.js";
import type { PlannerOutput, StoredPlan, StoredTask } from "../core/plan.js";
import { harnessOf } from "../core/probe.js";
import type { ModelCatalogEntry } from "../core/types.js";

const RUNS_DIR = join(AGENTPLAN_DIR, "runs");

function runId(): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return `r_${stamp}_${randomBytes(3).toString("hex")}`;
}

/** Resolves each task's harness from the catalog. Harness is never planner-chosen. */
export function buildStoredPlan(opts: {
  output: PlannerOutput;
  goal: string;
  workspace: string;
  models: ModelCatalogEntry[];
  plannerModel: string;
  plannerCostUsd: number | null;
}): StoredPlan {
  const byId = new Map(opts.models.map((m) => [m.id, m]));

  const tasks: StoredTask[] = opts.output.tasks.map((task) => {
    const model = byId.get(task.model_id);
    if (!model) throw new Error(`task ${task.id} references unknown model ${task.model_id}`);
    return { ...task, harness: harnessOf(model) };
  });

  return {
    schema_version: "1",
    id: runId(),
    goal: opts.goal,
    workspace: opts.workspace,
    created_at: new Date().toISOString(),
    planner: { model: opts.plannerModel, cost_usd: opts.plannerCostUsd },
    rationale_summary: opts.output.rationale_summary,
    risk_notes: opts.output.risk_notes,
    tasks,
  };
}

/** Write-once: mode 0444, never mutated. A re-plan creates a new run. */
export function persistPlan(plan: StoredPlan): string {
  const dir = join(RUNS_DIR, plan.id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "plan.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  chmodSync(path, 0o444);
  return path;
}
