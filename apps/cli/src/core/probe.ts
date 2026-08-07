import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { HarnessId, HarnessProbe, ModelCatalogEntry } from "./types.js";

const run = promisify(execFile);

const VLLM_MODELS_URL =
  process.env.VLLM_BASE_URL?.replace(/\/$/, "").concat("/models") ??
  "http://localhost:8000/v1/models";

async function version(bin: string): Promise<string | null> {
  try {
    const { stdout } = await run(bin, ["--version"], { timeout: 4000 });
    return stdout.trim().split("\n")[0] ?? "";
  } catch {
    return null;
  }
}

async function vllmUp(): Promise<boolean> {
  try {
    const res = await fetch(VLLM_MODELS_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function probeClaude(): Promise<HarnessProbe> {
  const v = await version("claude");
  if (v === null) return { availability: "not-installed" };
  const authed =
    !!process.env.ANTHROPIC_API_KEY ||
    existsSync(join(homedir(), ".claude", ".credentials.json"));
  return authed
    ? { availability: "available", version: v }
    : { availability: "unauthenticated", note: "no API key or stored credentials", version: v };
}

async function probeCodex(): Promise<HarnessProbe> {
  const v = await version("codex");
  if (v === null) return { availability: "not-installed" };
  return existsSync(join(homedir(), ".codex", "auth.json"))
    ? { availability: "available", version: v }
    : { availability: "unauthenticated", note: "~/.codex/auth.json missing", version: v };
}

/**
 * opencode is only useful here as the driver for the local vLLM model, so the
 * backend has to answer for the row to count as available.
 */
async function probeOpencode(): Promise<HarnessProbe> {
  const v = await version("opencode");
  if (v === null) return { availability: "not-installed" };
  return (await vllmUp())
    ? { availability: "available", version: v }
    : { availability: "unauthenticated", note: `no vLLM at ${VLLM_MODELS_URL}`, version: v };
}

async function probeGemini(): Promise<HarnessProbe> {
  const v = await version("gemini");
  return v === null ? { availability: "not-installed" } : { availability: "available", version: v };
}

export type HarnessProbes = Record<HarnessId, HarnessProbe>;

export async function probeHarnesses(): Promise<HarnessProbes> {
  const [claude, codex, opencode, gemini] = await Promise.all([
    probeClaude(),
    probeCodex(),
    probeOpencode(),
    probeGemini(),
  ]);
  return { claude, codex, opencode, gemini };
}

/** Project harness-level results down onto each catalog row. */
export function applyProbes(
  models: ModelCatalogEntry[],
  probes: HarnessProbes,
): ModelCatalogEntry[] {
  return models.map((m) => {
    const probe = probes[harnessOf(m)];
    return { ...m, availability: probe.availability, availability_note: probe.note };
  });
}

/** Harness is derived, never chosen — every model has exactly one driver. */
export function harnessOf(model: ModelCatalogEntry): HarnessId {
  const first = model.harnesses[0];
  if (!first) throw new Error(`catalog row ${model.id} declares no harness`);
  return first;
}
