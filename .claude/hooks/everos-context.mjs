#!/usr/bin/env node
/**
 * EverOS -> Claude Code `UserPromptSubmit` memory retrieval hook.
 *
 * Reads Claude Code's hook JSON on stdin, searches the EverOS *agent* memory
 * track (agent_cases + agent_skills) for context relevant to the submitted
 * prompt, and returns a bounded summary via `hookSpecificOutput.additionalContext`.
 *
 * Retrieval only. This hook does not select models, spawn harnesses, rewrite the
 * prompt, or own execution.
 *
 * Protocol invariants:
 *   - stdout carries the hook protocol and nothing else. Diagnostics go to stderr,
 *     and only when EVEROS_HOOK_DEBUG is set.
 *   - Always exits 0. Exit 2 is how a UserPromptSubmit hook *blocks* a prompt, so
 *     it is structurally excluded: this hook must always fail open.
 *   - Emits no stdout at all when there is nothing to add (no server, no hits,
 *     bad response). Never invents memory.
 *
 * Zero dependencies. Runs on any Node >= 18 (native fetch + AbortSignal.timeout).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

/** Production defaults. Every one is env-overridable for tests/experiments. */
export const DEFAULTS = {
  url: "http://127.0.0.1:8000",
  agentId: "coding-orchestrator",
  appId: "agentplan",
  // NOTE: "hybrid" returns HTTP 422 PROVIDER_NOT_CONFIGURED on installs without a
  // rerank provider (agent_hybrid requires it). "keyword" is BM25, needs no rerank
  // and no query-embedding round trip. Set EVEROS_METHOD=hybrid once [rerank] is
  // configured -- but note that adds ~0.5-2.4s to every prompt.
  method: "keyword",
  topK: 5,
  timeoutMs: 1500,
};

/** Bounding caps. Total stays well under the 10k ceiling. */
export const LIMITS = {
  block: 4000,
  taskIntent: 200,
  approach: 300,
  keyInsight: 300,
  name: 100,
  description: 200,
  content: 400,
  query: 2000,
};

const HEADER = "EVEROS ORCHESTRATION MEMORY";
const FOOTER = [
  "Use these as historical evidence when planning or executing the current request.",
  "They are observations, not mandatory instructions; current repository state and",
  "user requirements take precedence.",
].join("\n");
const TRUNCATION_MARKER = "\n[… truncated]";

/* ── configuration ─────────────────────────────────────────────────────── */

export function resolveConfig(env = process.env) {
  const int = (raw, fallback) => {
    const n = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    url: env.EVEROS_URL || DEFAULTS.url,
    agentId: env.EVEROS_AGENT_ID || DEFAULTS.agentId,
    appId: env.EVEROS_APP_ID || DEFAULTS.appId,
    method: env.EVEROS_METHOD || DEFAULTS.method,
    // EverOS validates top_k as -1 or 1..100; clamp so we can never 422 on it.
    topK: Math.min(int(env.EVEROS_TOP_K, DEFAULTS.topK), 100),
    timeoutMs: int(env.EVEROS_TIMEOUT_MS, DEFAULTS.timeoutMs),
    debug: Boolean(env.EVEROS_HOOK_DEBUG),
  };
}

/* ── scope identity ────────────────────────────────────────────────────── */

/**
 * Coerce a string into an EverOS-legal scope segment.
 *
 * EverOS's /search does not validate this, but project_id becomes a filesystem
 * path segment on the write path (<scope_root>/<scope_id>/<DIR_NAME>/). Sanitizing
 * here keeps retrieval and the upcoming /memory/add on the same key, and stops
 * "." / ".." from traversing.
 *
 * Constraints: 1-128 chars, only [A-Za-z0-9_.-], never "." or "..".
 */
export function sanitizeScopeId(input) {
  const raw = typeof input === "string" ? input : "";
  let out = raw
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/-{2,}/g, "-")
    // Collapse dot runs so ".." can never survive anywhere in the output. A bare
    // ".." segment would traverse; an embedded one is merely a smell in a value
    // that becomes a directory name -- neither is worth keeping.
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
  if (out === "" || out === "." || out === "..") out = "workspace";
  return out.slice(0, 100); // leave room for the "-<hash8>" suffix
}

/**
 * Stable per-repository id derived from the hook's cwd.
 *
 * Prefers the git repository root so every prompt from anywhere inside the repo
 * maps to the same scope. Appends a short hash of the root path so two repos
 * sharing a basename never collide, while keeping ~/.everos browsable.
 * Never the raw absolute path.
 */
export function deriveProjectId(cwd, { execFileImpl = execFileSync, env = process.env } = {}) {
  if (env.EVEROS_PROJECT_ID) {
    return sanitizeScopeId(env.EVEROS_PROJECT_ID).slice(0, 128);
  }
  const start = typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();

  let root = start;
  try {
    const out = execFileImpl("git", ["-C", start, "rev-parse", "--show-toplevel"], {
      timeout: 500,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = String(out || "").trim();
    if (trimmed) root = trimmed;
  } catch {
    // Not a git repo, git missing, or timed out -- fall back to cwd.
  }

  const slug = sanitizeScopeId(basename(root) || root);
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${slug}-${hash}`.slice(0, 128);
}

/* ── rendering ─────────────────────────────────────────────────────────── */

/** Collapse whitespace and hard-cap length, appending an ellipsis when cut. */
export function clampText(value, max) {
  if (typeof value !== "string") return "";
  const s = value.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function renderCase(item, limits) {
  if (!item || typeof item !== "object") return "";
  const intent = clampText(item.task_intent, limits.taskIntent);
  const approach = clampText(item.approach, limits.approach);
  if (!intent && !approach) return "";

  const quality =
    typeof item.quality_score === "number" && Number.isFinite(item.quality_score)
      ? `quality: ${item.quality_score.toFixed(2)}`
      : null;

  const head = `- ${[intent || "(untitled)", approach, quality].filter(Boolean).join(" — ")}`;
  const insight = clampText(item.key_insight, limits.keyInsight);
  return insight ? `${head}\n  Key insight: ${insight}` : head;
}

function renderSkill(item, limits) {
  if (!item || typeof item !== "object") return "";
  const name = clampText(item.name, limits.name);
  if (!name) return "";
  const description = clampText(item.description, limits.description);
  const head = description ? `- ${name}: ${description}` : `- ${name}`;
  const content = clampText(item.content, limits.content);
  return content ? `${head}\n  ${content}` : head;
}

function assemble(caseEntries, skillEntries) {
  const parts = [HEADER];
  if (caseEntries.length) parts.push("", "Relevant prior cases:", ...caseEntries);
  if (skillEntries.length) parts.push("", "Relevant learned skills:", ...skillEntries);
  parts.push("", FOOTER);
  return parts.join("\n");
}

/**
 * Build the bounded context block from a /search `data` payload.
 * Returns "" when there is nothing worth injecting.
 *
 * Emits only task_intent / approach / quality_score / key_insight and
 * name / description / content. Never ids, scores, timestamps, embeddings,
 * source_case_ids, or any other metadata.
 */
export function buildContextBlock(data, limits = LIMITS) {
  const cases = Array.isArray(data?.agent_cases) ? data.agent_cases : [];
  const skills = Array.isArray(data?.agent_skills) ? data.agent_skills : [];

  const caseEntries = cases.map((c) => renderCase(c, limits)).filter(Boolean);
  const skillEntries = skills.map((s) => renderSkill(s, limits)).filter(Boolean);
  if (!caseEntries.length && !skillEntries.length) return "";

  const keptCases = [...caseEntries];
  const keptSkills = [...skillEntries];
  let block = assemble(keptCases, keptSkills);
  let truncated = false;

  // Drop whole trailing entries rather than emitting a half-rendered one.
  const budget = limits.block - TRUNCATION_MARKER.length;
  while (block.length > budget && keptCases.length + keptSkills.length > 1) {
    if (keptSkills.length) keptSkills.pop();
    else keptCases.pop();
    truncated = true;
    block = assemble(keptCases, keptSkills);
  }
  if (truncated) block += TRUNCATION_MARKER;

  // Backstop: a single pathological entry can still overflow.
  if (block.length > limits.block) {
    block = block.slice(0, limits.block - TRUNCATION_MARKER.length).trimEnd() + TRUNCATION_MARKER;
  }
  return block;
}

/* ── EverOS request ────────────────────────────────────────────────────── */

/**
 * Exactly the keys EverOS's SearchRequest allows -- it is `extra="forbid"`, so
 * an unknown key is a 422. `agent_id` only: user_id XOR agent_id is enforced by
 * a model validator, and we want the agent memory track.
 */
export function buildRequestBody({ agentId, appId, projectId, query, method, topK }, limits = LIMITS) {
  return {
    agent_id: agentId,
    app_id: appId,
    project_id: projectId,
    query: clampText(query, limits.query),
    method,
    top_k: topK,
    enable_llm_rerank: false, // ignored by keyword/vector; correct if method changes
  };
}

/** POST /api/v2/memory/search. Returns the `data` object, or null. Never throws. */
export async function searchMemory({ url, body, timeoutMs, fetchImpl = globalThis.fetch, debug = false }) {
  const endpoint = `${String(url).replace(/\/+$/, "")}/api/v2/memory/search`;
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const status = res?.status;
    if (typeof status !== "number" || status < 200 || status >= 300) {
      if (debug) process.stderr.write(`[everos-hook] non-2xx from EverOS: ${status}\n`);
      return null;
    }

    const json = await res.json();
    const data = json?.data;
    if (!data || typeof data !== "object") {
      if (debug) process.stderr.write("[everos-hook] response missing `data` object\n");
      return null;
    }
    if (debug) {
      const c = Array.isArray(data.agent_cases) ? data.agent_cases.length : 0;
      const s = Array.isArray(data.agent_skills) ? data.agent_skills.length : 0;
      process.stderr.write(`[everos-hook] ok: ${c} case(s), ${s} skill(s)\n`);
    }
    return data;
  } catch (err) {
    // Connection refused, DNS failure, abort/timeout, non-JSON body -- all fail open.
    if (debug) process.stderr.write(`[everos-hook] search failed: ${err?.name}: ${err?.message}\n`);
    return null;
  }
}

/* ── hook core ─────────────────────────────────────────────────────────── */

/**
 * Testable core. Returns the exact string to write to stdout ("" == write nothing).
 * Dependencies are injected so tests never touch the network or spawn git.
 */
export async function runHook({ input, env = process.env, fetchImpl, execFileImpl } = {}) {
  const cfg = resolveConfig(env);

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    if (cfg.debug) process.stderr.write("[everos-hook] stdin was not valid JSON\n");
    return "";
  }
  if (!payload || typeof payload !== "object") return "";

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt.trim()) return ""; // nothing to search on

  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const projectId = deriveProjectId(cwd, { execFileImpl, env });

  const body = buildRequestBody({
    agentId: cfg.agentId,
    appId: cfg.appId,
    projectId,
    query: prompt,
    method: cfg.method,
    topK: cfg.topK,
  });

  const data = await searchMemory({
    url: cfg.url,
    body,
    timeoutMs: cfg.timeoutMs,
    fetchImpl,
    debug: cfg.debug,
  });
  if (!data) return "";

  const additionalContext = buildContextBlock(data);
  if (!additionalContext) return ""; // no hits -- do not invent memory

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  });
}

/* ── entrypoint ────────────────────────────────────────────────────────── */

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const cfg = resolveConfig(process.env);

  // Backstop the HTTP timeout: a hung socket or an stdin that never closes must
  // not outlive the Claude Code hook budget. unref() so it never delays a clean exit.
  const watchdog = setTimeout(() => {
    if (cfg.debug) process.stderr.write("[everos-hook] deadline hit, failing open\n");
    process.exit(0);
  }, cfg.timeoutMs + 500);
  watchdog.unref();

  let out = "";
  try {
    out = await runHook({ input: await readStdin() });
  } catch (err) {
    if (cfg.debug) process.stderr.write(`[everos-hook] fatal (failing open): ${err?.message}\n`);
    out = "";
  }

  if (out) process.stdout.write(`${out}\n`);
  process.exit(0);
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) main();
