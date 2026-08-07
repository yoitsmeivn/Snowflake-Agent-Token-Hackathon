import { z } from "zod";
import type { HarnessId } from "./types.js";

export const AGENT_ROLES = [
  "explorer",
  "architect",
  "implementer",
  "reviewer",
  "tester",
  "documenter",
] as const;

export const CONFIDENCE = ["low", "medium", "high"] as const;

export interface PlannerTask {
  id: string;
  name: string;
  objective: string;
  agent_role: (typeof AGENT_ROLES)[number];
  /** Constrained to the assignable set by a generated enum in the JSON Schema. */
  model_id: string;
  model_rationale: string;
  dependencies: string[];
  estimates: {
    expected_input_tokens: number;
    expected_output_tokens: number;
    estimated_cost_usd: number;
    confidence: (typeof CONFIDENCE)[number];
  };
}

export interface PlannerOutput {
  rationale_summary: string;
  risk_notes: string[];
  tasks: PlannerTask[];
}

/** A task once persisted: harness resolved from the catalog, never planner-chosen. */
export interface StoredTask extends PlannerTask {
  harness: HarnessId;
}

export interface StoredPlan {
  schema_version: "1";
  id: string;
  goal: string;
  workspace: string;
  created_at: string;
  planner: { model: string; cost_usd: number | null };
  rationale_summary: string;
  risk_notes: string[];
  tasks: StoredTask[];
}

/**
 * Zod mirror of the JSON Schema below. Both are generated from the same
 * `modelIds` array, so the only drift risk is field names — which gate 1
 * catches on the first run.
 */
export function plannerOutputSchema(modelIds: string[]) {
  const modelId =
    modelIds.length > 0
      ? z.enum(modelIds as [string, ...string[]])
      : z.string();

  const task = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    objective: z.string().min(1),
    agent_role: z.enum(AGENT_ROLES),
    model_id: modelId,
    model_rationale: z.string().min(1),
    dependencies: z.array(z.string()),
    estimates: z.object({
      expected_input_tokens: z.number().nonnegative(),
      expected_output_tokens: z.number().nonnegative(),
      estimated_cost_usd: z.number().nonnegative(),
      confidence: z.enum(CONFIDENCE),
    }),
  });

  return z.object({
    rationale_summary: z.string().min(1),
    risk_notes: z.array(z.string()),
    tasks: z.array(task).min(1),
  });
}

/**
 * The payload for `claude -p --json-schema`. The `model_id` enum is rebuilt on
 * every plan call from the currently assignable rows, which is what makes an
 * invalid assignment unemittable rather than merely rejected afterwards.
 *
 * `harness` is deliberately absent: it is derived from the catalog, so an
 * invalid model/harness pairing is unrepresentable.
 */
export function buildPlanJsonSchema(modelIds: string[]): Record<string, unknown> {
  const obj = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });

  return obj(
    {
      rationale_summary: {
        type: "string",
        description: "The overall allocation strategy in two or three sentences.",
      },
      risk_notes: {
        type: "array",
        items: { type: "string" },
        description: "What you are unsure about in this plan.",
      },
      tasks: {
        type: "array",
        minItems: 1,
        items: obj(
          {
            id: { type: "string", description: 'Stable short id, e.g. "t1".' },
            name: { type: "string", description: "Short human label." },
            objective: {
              type: "string",
              description: "The actual instruction the assigned worker would receive.",
            },
            agent_role: { type: "string", enum: [...AGENT_ROLES] },
            model_id: {
              type: "string",
              enum: modelIds,
              description: "Must be one of the listed available models.",
            },
            model_rationale: {
              type: "string",
              description:
                "Why this class of model for this work. Required. Refer to the " +
                "task's reasoning demand, context needs and cost.",
            },
            dependencies: {
              type: "array",
              items: { type: "string" },
              description: "Ids of tasks that must finish first. Empty for roots.",
            },
            estimates: obj(
              {
                expected_input_tokens: { type: "number" },
                expected_output_tokens: { type: "number" },
                estimated_cost_usd: { type: "number" },
                confidence: { type: "string", enum: [...CONFIDENCE] },
              },
              [
                "expected_input_tokens",
                "expected_output_tokens",
                "estimated_cost_usd",
                "confidence",
              ],
            ),
          },
          [
            "id",
            "name",
            "objective",
            "agent_role",
            "model_id",
            "model_rationale",
            "dependencies",
            "estimates",
          ],
        ),
      },
    },
    ["rationale_summary", "risk_notes", "tasks"],
  );
}
