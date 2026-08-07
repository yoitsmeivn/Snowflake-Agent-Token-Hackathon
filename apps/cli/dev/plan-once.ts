// Headless planner run — the TUI needs a TTY, this does not.
import { assignableModels, loadCatalog } from "../src/core/catalog.js";
import { applyProbes, probeHarnesses } from "../src/core/probe.js";
import { runPlanner, PLANNER_MODEL } from "../src/planner/run.js";
import { validatePlan } from "../src/planner/validate.js";
import { buildStoredPlan, persistPlan } from "../src/store/plans.js";
import { layoutTasks } from "../src/tui/Plan.js";

const goal = process.argv[2] ?? "add structured logging across the codebase";
const workspace = process.argv[3] ?? process.cwd();

const models = applyProbes(loadCatalog(), await probeHarnesses());
console.log("assignable:", assignableModels(models).map((m) => m.id).join(", "));
console.log("planning…");

const t0 = Date.now();
const result = await runPlanner({ goal, workspace, models });
console.log(`planner returned in ${((Date.now() - t0) / 1000).toFixed(1)}s, cost ${result.cost_usd}`);

const validation = validatePlan(result.output, models, null);
if (!validation.ok) {
  console.error("VALIDATION FAILED:", validation.failures);
  process.exit(1);
}

const stored = buildStoredPlan({
  output: validation.plan,
  goal,
  workspace,
  models,
  plannerModel: PLANNER_MODEL,
  plannerCostUsd: result.cost_usd,
});
console.log("persisted:", persistPlan(stored));
console.log("\nstrategy:", stored.rationale_summary, "\n");

for (const column of layoutTasks(stored.tasks).columns) {
  console.log("depth ---");
  for (const t of column) {
    console.log(`  ${t.id} ${t.name}`);
    console.log(`     ${t.model_id} / ${t.harness}  $${t.estimates.estimated_cost_usd}`);
    console.log(`     why: ${t.model_rationale}`);
  }
}
