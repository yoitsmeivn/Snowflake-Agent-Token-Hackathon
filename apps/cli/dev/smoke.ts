import { loadCatalog, assignableModels } from "../src/core/catalog.js";
import { applyProbes, probeHarnesses } from "../src/core/probe.js";
import { buildPlanJsonSchema } from "../src/core/plan.js";
import { buildSystemPrompt } from "../src/planner/prompt.js";
import { validatePlan } from "../src/planner/validate.js";
import { buildStoredPlan, persistPlan } from "../src/store/plans.js";
import { layoutTasks } from "../src/tui/Plan.js";

const probes = await probeHarnesses();
console.log("PROBES:", JSON.stringify(probes, null, 1));

const models = applyProbes(loadCatalog(), probes);
const assignable = assignableModels(models);
console.log("ASSIGNABLE:", assignable.map((m) => m.id).join(", "));

const schema = buildPlanJsonSchema(assignable.map((m) => m.id));
console.log("SCHEMA BYTES:", JSON.stringify(schema).length);
console.log("ENUM:", JSON.stringify((schema as any).properties.tasks.items.properties.model_id.enum));

const sys = buildSystemPrompt(assignable);
console.log("--- SYSTEM PROMPT ---");
console.log(sys);
console.log("--- END (", sys.length, "chars ) ---");

const MODEL = assignable[0]!.id;
const good = {
  rationale_summary: "cheap models scan, one premium model designs",
  risk_notes: ["token estimates are guesses"],
  tasks: [
    { id: "t1", name: "scan repo", objective: "map the codebase", agent_role: "explorer",
      model_id: MODEL, model_rationale: "cheap wide read",
      dependencies: [], estimates: { expected_input_tokens: 4000, expected_output_tokens: 900, estimated_cost_usd: 0.008, confidence: "medium" } },
    { id: "t2", name: "design", objective: "propose the change", agent_role: "architect",
      model_id: MODEL, model_rationale: "needs real reasoning",
      dependencies: ["t1"], estimates: { expected_input_tokens: 9000, expected_output_tokens: 2200, estimated_cost_usd: 0.1, confidence: "low" } },
    { id: "t3", name: "tests", objective: "write tests", agent_role: "tester",
      model_id: MODEL, model_rationale: "bounded",
      dependencies: ["t1"], estimates: { expected_input_tokens: 3000, expected_output_tokens: 1200, estimated_cost_usd: 0.004, confidence: "high" } },
  ],
};

console.log("GATE ok  :", JSON.stringify(validatePlan(good, models, null)).slice(0, 90));

const badModel = structuredClone(good);
badModel.tasks[0]!.model_id = "gpt-9-imaginary";
console.log("GATE bad model:", JSON.stringify(validatePlan(badModel, models, null)));

const cyc = structuredClone(good);
cyc.tasks[0]!.dependencies = ["t2"];
console.log("GATE cycle:", JSON.stringify(validatePlan(cyc, models, null)));

const overBudget = validatePlan(good, models, 0.05);
console.log("GATE budget:", JSON.stringify(overBudget));

const v = validatePlan(good, models, null);
if (!v.ok) throw new Error("expected ok");
const stored = buildStoredPlan({
  output: v.plan, goal: "smoke", workspace: process.cwd(), models,
  plannerModel: "opus", plannerCostUsd: 0.42,
});
const path = persistPlan(stored);
console.log("PERSISTED:", path);
console.log("HARNESSES:", stored.tasks.map((t) => `${t.id}=${t.model_id}/${t.harness}`).join(" "));
console.log("LAYOUT COLUMNS:", layoutTasks(stored.tasks).columns.map((c) => c.map((t) => t.id).join("+")).join(" | "));
