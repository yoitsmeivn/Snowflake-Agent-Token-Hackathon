import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTPLAN_DIR, assignableModels } from "./catalog.js";
import { harnessOf } from "./probe.js";
import type { ModelCatalogEntry } from "./types.js";

export const ROSTER_CACHE = join(AGENTPLAN_DIR, "roster.json");

/**
 * The text injected into every Claude message. Built from models that are both
 * enabled AND available, so the hook can never advertise a model that would
 * fail when called.
 */
export function buildRosterContext(models: ModelCatalogEntry[]): string | null {
  const usable = assignableModels(models);
  if (usable.length === 0) return null;

  const listed = usable.map((m) => `${m.id} (${harnessOf(m)}, ${m.cost_tier})`).join(", ");
  const cheap = usable.filter((m) => m.cost_tier === "low").map((m) => m.id);

  return (
    `You have a \`delegate\` tool backed by these models: ${listed}. ` +
    `Before doing mechanical or wide work yourself — scanning files, enumerating ` +
    `call sites, extracting facts, summarising — consider delegating it to the ` +
    `cheapest capable model instead` +
    (cheap.length > 0 ? ` (${cheap.join(" or ")})` : "") +
    `. Keep judgement-heavy work and anything that writes files for yourself.`
  );
}

/**
 * Written after every probe and every toggle. The hook reads this instead of
 * recomputing, which keeps per-message latency to a bare file read — it runs on
 * every message in every session, so its cost is paid constantly.
 */
export function writeRosterCache(models: ModelCatalogEntry[]): void {
  mkdirSync(AGENTPLAN_DIR, { recursive: true });
  writeFileSync(
    ROSTER_CACHE,
    `${JSON.stringify(
      { additionalContext: buildRosterContext(models), updated_at: new Date().toISOString() },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
