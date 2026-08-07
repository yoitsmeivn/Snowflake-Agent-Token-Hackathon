import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelCatalogEntry } from "./types.js";

export const AGENTPLAN_DIR = join(homedir(), ".agentplan");
const OVERLAY_PATH = join(AGENTPLAN_DIR, "catalog.json");

/**
 * Seeded catalog. Source of truth lives here, in git, so the rows are
 * reviewable. User toggles are a separate id->boolean overlay on disk.
 *
 * Every row below was verified present on the build machine except the two
 * gemini rows, which are kept deliberately: they are what makes the boot
 * availability probe visible rather than merely asserted.
 */
export const CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: "claude-opus-5",
    provider: "anthropic",
    display_name: "Claude Opus 5",
    harnesses: ["claude"],
    harness_model_arg: "opus",
    local: false,
    context_window: 1_000_000,
    price_input_per_mtok: 5,
    price_output_per_mtok: 25,
    price_source: "published",
    cost_tier: "premium",
    speed_tier: "slow",
    capabilities: ["architecture", "review", "long-context", "structured-output"],
    reliability_notes: "Strongest reasoning. Reserve for high-leverage decisions.",
    enabled: true,
    availability: "checking",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    display_name: "Claude Sonnet 5",
    harnesses: ["claude"],
    harness_model_arg: "sonnet",
    local: false,
    context_window: 1_000_000,
    price_input_per_mtok: 3,
    price_output_per_mtok: 15,
    price_source: "published",
    cost_tier: "high",
    speed_tier: "medium",
    capabilities: ["coding", "review", "tool-use", "long-context"],
    reliability_notes: "Good default for substantive implementation work.",
    enabled: true,
    availability: "checking",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    display_name: "Claude Haiku 4.5",
    harnesses: ["claude"],
    harness_model_arg: "haiku",
    local: false,
    context_window: 200_000,
    price_input_per_mtok: 1,
    price_output_per_mtok: 5,
    price_source: "published",
    cost_tier: "low",
    speed_tier: "fast",
    capabilities: ["repo-exploration", "extraction", "summarisation"],
    reliability_notes: "Cheap and fast. Weak on multi-step architectural reasoning.",
    enabled: true,
    availability: "checking",
  },
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    display_name: "GPT-5.6-Sol",
    harnesses: ["codex"],
    harness_model_arg: "gpt-5.6-sol",
    local: false,
    context_window: 272_000,
    price_input_per_mtok: null,
    price_output_per_mtok: null,
    price_source: "subscription-no-marginal-cost",
    cost_tier: "high",
    speed_tier: "medium",
    capabilities: ["coding", "implementation", "refactoring", "tests"],
    reliability_notes: "Strong implementer. Billed by subscription, no marginal cost.",
    enabled: true,
    availability: "checking",
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    display_name: "GPT-5.4-Mini",
    harnesses: ["codex"],
    harness_model_arg: "gpt-5.4-mini",
    local: false,
    context_window: 272_000,
    price_input_per_mtok: null,
    price_output_per_mtok: null,
    price_source: "subscription-no-marginal-cost",
    cost_tier: "low",
    speed_tier: "fast",
    capabilities: ["bounded-edits", "tests", "extraction"],
    reliability_notes: "For small, well-specified edits. Billed by subscription.",
    enabled: true,
    availability: "checking",
  },
  {
    id: "qwen3-4b-awq",
    provider: "local",
    display_name: "Qwen3 4B Instruct (AWQ, vLLM)",
    harnesses: ["opencode"],
    harness_model_arg: "vllm/cpatonn/Qwen3-4B-Instruct-2507-AWQ-4bit",
    local: true,
    context_window: 32_768,
    price_input_per_mtok: null,
    price_output_per_mtok: null,
    price_source: "local-no-marginal-cost",
    cost_tier: "low",
    speed_tier: "fast",
    capabilities: ["extraction", "repo-exploration", "bounded-edits"],
    reliability_notes:
      "32k window — only suitable for tightly bounded work. Cannot be driven by " +
      "Claude Code, whose system prompt alone exceeds the window; opencode only.",
    enabled: true,
    availability: "checking",
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    display_name: "Gemini 2.5 Pro",
    harnesses: ["gemini"],
    harness_model_arg: "gemini-2.5-pro",
    local: false,
    context_window: 1_000_000,
    price_input_per_mtok: null,
    price_output_per_mtok: null,
    price_source: "subscription-no-marginal-cost",
    cost_tier: "high",
    speed_tier: "medium",
    capabilities: ["analysis", "long-context"],
    reliability_notes: "Requires the gemini CLI.",
    enabled: true,
    availability: "checking",
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    display_name: "Gemini 2.5 Flash",
    harnesses: ["gemini"],
    harness_model_arg: "gemini-2.5-flash",
    local: false,
    context_window: 1_000_000,
    price_input_per_mtok: null,
    price_output_per_mtok: null,
    price_source: "subscription-no-marginal-cost",
    cost_tier: "low",
    speed_tier: "fast",
    capabilities: ["repo-exploration", "broad-reading", "extraction"],
    reliability_notes: "Requires the gemini CLI.",
    enabled: true,
    availability: "checking",
  },
];

type Overlay = Record<string, boolean>;

function readOverlay(): Overlay {
  try {
    const parsed: unknown = JSON.parse(readFileSync(OVERLAY_PATH, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as Overlay;
  } catch {
    // No overlay yet, or it is unreadable — fall back to the seeded defaults.
  }
  return {};
}

/** Seeded rows with the user's enable/disable overlay applied. */
export function loadCatalog(): ModelCatalogEntry[] {
  const overlay = readOverlay();
  return CATALOG.map((entry) => ({
    ...entry,
    enabled: overlay[entry.id] ?? entry.enabled,
  }));
}

export function saveOverlay(models: ModelCatalogEntry[]): void {
  const overlay: Overlay = {};
  for (const m of models) overlay[m.id] = m.enabled;
  mkdirSync(AGENTPLAN_DIR, { recursive: true });
  writeFileSync(OVERLAY_PATH, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
}

/**
 * The set the planner is allowed to assign from. This filter is the whole
 * reason the planner cannot allocate something that will not run.
 */
export function assignableModels(models: ModelCatalogEntry[]): ModelCatalogEntry[] {
  return models.filter((m) => m.enabled && m.availability === "available");
}
