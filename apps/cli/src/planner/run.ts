import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assignableModels } from "../core/catalog.js";
import { buildPlanJsonSchema } from "../core/plan.js";
import type { ModelCatalogEntry } from "../core/types.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";

const run = promisify(execFile);

export const PLANNER_MODEL = "opus";
const PLANNER_BUDGET_USD = "2.00";

export interface PlannerResult {
  /** Raw structured output, still unvalidated. */
  output: unknown;
  cost_usd: number | null;
  duration_ms: number;
  /** The exact model ids the schema enum was built from. */
  modelIds: string[];
}

interface ClaudeResultEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
}

export class PlannerError extends Error {}

/**
 * A read-only Claude Code session. `dontAsk` plus a read-only tool list means
 * the planner physically cannot write; --max-budget-usd is a hard stop.
 */
export async function runPlanner(opts: {
  goal: string;
  workspace: string;
  models: ModelCatalogEntry[];
}): Promise<PlannerResult> {
  const assignable = assignableModels(opts.models);
  if (assignable.length === 0) {
    throw new PlannerError(
      "No assignable models. Enable at least one available row in the MODELS view.",
    );
  }

  const modelIds = assignable.map((m) => m.id);
  const schema = JSON.stringify(buildPlanJsonSchema(modelIds));

  const args = [
    "-p",
    buildUserPrompt(opts.goal, opts.workspace),
    "--model",
    PLANNER_MODEL,
    "--effort",
    "high",
    "--output-format",
    "json",
    "--json-schema",
    schema,
    "--allowedTools",
    "Read,Grep,Glob",
    "--permission-mode",
    "dontAsk",
    "--add-dir",
    opts.workspace,
    "--append-system-prompt",
    buildSystemPrompt(assignable),
    "--max-budget-usd",
    PLANNER_BUDGET_USD,
    "--no-session-persistence",
  ];

  let stdout: string;
  try {
    ({ stdout } = await run("claude", args, {
      cwd: opts.workspace,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    }));
  } catch (err) {
    throw new PlannerError(`claude failed to run: ${(err as Error).message}`);
  }

  let envelope: ClaudeResultEnvelope;
  try {
    envelope = JSON.parse(stdout) as ClaudeResultEnvelope;
  } catch {
    throw new PlannerError(`planner returned non-JSON output:\n${stdout.slice(0, 800)}`);
  }

  if (envelope.is_error) {
    throw new PlannerError(envelope.result ?? "planner reported an error");
  }

  const output = envelope.structured_output ?? parseResultAsJson(envelope.result);
  if (output === undefined) {
    throw new PlannerError(
      `planner produced no structured output:\n${(envelope.result ?? "").slice(0, 800)}`,
    );
  }

  return {
    output,
    cost_usd: envelope.total_cost_usd ?? null,
    duration_ms: envelope.duration_ms ?? 0,
    modelIds,
  };
}

/** Fallback for builds that put the structured payload in `result` as a string. */
function parseResultAsJson(result: string | undefined): unknown {
  if (!result) return undefined;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}
