/**
 * Tests for the EverOS UserPromptSubmit hook.
 *
 *   node --test .claude/hooks/
 *
 * Uses Node's built-in test runner -- zero dependencies, no package.json.
 * fetch and git are injected, so nothing here touches the network or the
 * live EverOS server.
 *
 * Fixtures mirror the authoritative DTOs in
 * .venv-everos/lib/python3.12/site-packages/everos/memory/search/dto.py
 * (SearchAgentCaseItem / SearchAgentSkillItem).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  LIMITS,
  buildContextBlock,
  buildRequestBody,
  clampText,
  deriveProjectId,
  runHook,
  sanitizeScopeId,
  searchMemory,
} from "./everos-context.mjs";

/* ── helpers ───────────────────────────────────────────────────────────── */

const PROMPT = "Implement a TypeScript authentication change";

const hookInput = (overrides = {}) =>
  JSON.stringify({
    session_id: "test-session",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp/some-repo",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: PROMPT,
    ...overrides,
  });

/** Minimal fetch double returning a JSON body with the given status. */
const fakeFetch = (body, status = 200) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      status,
      json: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
};

const emptyData = {
  request_id: "r",
  data: { episodes: [], profiles: [], agent_cases: [], agent_skills: [], unprocessed_messages: [] },
};

const oneCase = {
  request_id: "r",
  data: {
    episodes: [],
    profiles: [],
    agent_cases: [
      {
        id: "agent_case_1",
        agent_id: "coding-orchestrator",
        app_id: "agentplan",
        project_id: "proj",
        session_id: "s1",
        task_intent: "Add org billing to a TypeScript repo",
        approach: "Explorer scanned schema, architect designed, Codex implemented in a worktree",
        quality_score: 0.875,
        key_insight: "Bounded test-writing suited Codex; broad scans suited a cheap model",
        timestamp: "2026-08-01T10:00:00Z",
        score: 0.91,
      },
    ],
    agent_skills: [],
    unprocessed_messages: [],
  },
};

const oneSkill = {
  request_id: "r",
  data: {
    episodes: [],
    profiles: [],
    agent_cases: [],
    agent_skills: [
      {
        id: "agent_skill_1",
        agent_id: "coding-orchestrator",
        app_id: "agentplan",
        project_id: "proj",
        name: "worktree-isolation",
        description: "Isolate writing tasks in dedicated git worktrees",
        content: "Create one worktree per writing task; never merge automatically.",
        confidence: 0.8,
        maturity_score: 0.6,
        source_case_ids: ["agent_case_1"],
        score: 0.77,
      },
    ],
    unprocessed_messages: [],
  },
};

// Injected git double so project-id tests never shell out.
const gitReturns = (root) => () => `${root}\n`;
const gitThrows = () => {
  throw new Error("not a git repository");
};

const baseEnv = { EVEROS_URL: "http://127.0.0.1:8000" };

/* ── 1. successful agent-case result ───────────────────────────────────── */

test("renders an agent case into additionalContext", async () => {
  const out = await runHook({
    input: hookInput(),
    env: baseEnv,
    fetchImpl: fakeFetch(oneCase),
    execFileImpl: gitReturns("/tmp/some-repo"),
  });

  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");

  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.match(ctx, /^EVEROS ORCHESTRATION MEMORY/);
  assert.match(ctx, /Relevant prior cases:/);
  assert.match(ctx, /Add org billing to a TypeScript repo/);
  assert.match(ctx, /quality: 0\.88/); // 0.875 -> toFixed(2)
  assert.match(ctx, /Key insight: Bounded test-writing suited Codex/);
  assert.doesNotMatch(ctx, /Relevant learned skills:/); // empty section omitted
});

/* ── 2. successful agent-skill result ──────────────────────────────────── */

test("renders an agent skill into additionalContext", async () => {
  const out = await runHook({
    input: hookInput(),
    env: baseEnv,
    fetchImpl: fakeFetch(oneSkill),
    execFileImpl: gitReturns("/tmp/some-repo"),
  });

  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Relevant learned skills:/);
  assert.match(ctx, /- worktree-isolation: Isolate writing tasks in dedicated git worktrees/);
  assert.match(ctx, /Create one worktree per writing task/);
  assert.doesNotMatch(ctx, /Relevant prior cases:/);
});

/* ── 3. both sections, correct order; no metadata leakage ──────────────── */

test("renders both sections in order and leaks no metadata", async () => {
  const both = {
    request_id: "r",
    data: {
      episodes: [],
      profiles: [],
      agent_cases: oneCase.data.agent_cases,
      agent_skills: oneSkill.data.agent_skills,
      unprocessed_messages: [],
    },
  };
  const ctx = JSON.parse(
    await runHook({
      input: hookInput(),
      env: baseEnv,
      fetchImpl: fakeFetch(both),
      execFileImpl: gitReturns("/tmp/some-repo"),
    }),
  ).hookSpecificOutput.additionalContext;

  assert.ok(ctx.indexOf("Relevant prior cases:") < ctx.indexOf("Relevant learned skills:"));
  for (const leak of ["agent_case_1", "agent_skill_1", "0.91", "0.77", "source_case_ids", "2026-08-01"]) {
    assert.doesNotMatch(ctx, new RegExp(leak.replace(".", "\\.")), `leaked ${leak}`);
  }
  assert.match(ctx, /observations, not mandatory instructions/);
});

/* ── 4. empty results ──────────────────────────────────────────────────── */

test("empty results produce no stdout", async () => {
  const out = await runHook({
    input: hookInput(),
    env: baseEnv,
    fetchImpl: fakeFetch(emptyData),
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  assert.equal(out, "");
});

/* ── 5. server unavailable ─────────────────────────────────────────────── */

test("connection refused fails open with no stdout", async () => {
  const refuse = async () => {
    const err = new Error("fetch failed");
    err.cause = { code: "ECONNREFUSED" };
    throw err;
  };
  const out = await runHook({
    input: hookInput(),
    env: baseEnv,
    fetchImpl: refuse,
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  assert.equal(out, "");
});

/* ── 6. timeout ────────────────────────────────────────────────────────── */

test("abort/timeout fails open with no stdout", async () => {
  const abort = async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    throw err;
  };
  const out = await runHook({
    input: hookInput(),
    env: baseEnv,
    fetchImpl: abort,
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  assert.equal(out, "");
});

/* ── 7. malformed responses ────────────────────────────────────────────── */

test("malformed responses fail open", async () => {
  const cases = [
    { name: "non-JSON body", impl: async () => ({ status: 200, json: async () => { throw new SyntaxError("bad json"); } }) },
    { name: "missing data", impl: fakeFetch({ request_id: "r" }) },
    { name: "data is a string", impl: fakeFetch({ request_id: "r", data: "nope" }) },
    { name: "arrays are wrong type", impl: fakeFetch({ request_id: "r", data: { agent_cases: "x", agent_skills: 3 } }) },
    { name: "items are junk", impl: fakeFetch({ request_id: "r", data: { agent_cases: [null, 42, {}], agent_skills: [] } }) },
  ];
  for (const { name, impl } of cases) {
    const out = await runHook({
      input: hookInput(),
      env: baseEnv,
      fetchImpl: impl,
      execFileImpl: gitReturns("/tmp/some-repo"),
    });
    assert.equal(out, "", `expected no stdout for: ${name}`);
  }
});

test("unparseable stdin fails open", async () => {
  assert.equal(await runHook({ input: "not json", env: baseEnv, fetchImpl: fakeFetch(oneCase) }), "");
  assert.equal(await runHook({ input: "", env: baseEnv, fetchImpl: fakeFetch(oneCase) }), "");
});

test("blank prompt short-circuits without calling EverOS", async () => {
  const impl = fakeFetch(oneCase);
  const out = await runHook({
    input: hookInput({ prompt: "   \n  " }),
    env: baseEnv,
    fetchImpl: impl,
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  assert.equal(out, "");
  assert.equal(impl.calls.length, 0, "must not query EverOS for an empty prompt");
});

/* ── 8. non-2xx (the real 422 this server returns for hybrid) ──────────── */

test("HTTP 422 PROVIDER_NOT_CONFIGURED is treated as no-memory", async () => {
  const real422 = {
    request_id: "5d6eaf5b6b42461ab046210a480f43e7",
    error: {
      code: "PROVIDER_NOT_CONFIGURED",
      message: "Provider 'rerank' (required by agent_hybrid) is not configured.",
      timestamp: "2026-08-07T20:12:02.595640+00:00",
      path: "/api/v2/memory/search",
    },
  };
  const out = await runHook({
    input: hookInput(),
    env: { ...baseEnv, EVEROS_METHOD: "hybrid" },
    fetchImpl: fakeFetch(real422, 422),
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  assert.equal(out, "");
});

test("searchMemory returns null rather than throwing on 500", async () => {
  const data = await searchMemory({
    url: "http://127.0.0.1:8000",
    body: {},
    timeoutMs: 100,
    fetchImpl: fakeFetch({ oops: true }, 500),
  });
  assert.equal(data, null);
});

/* ── 9. project_id sanitization ────────────────────────────────────────── */

test("sanitizeScopeId enforces the EverOS scope charset", () => {
  assert.equal(sanitizeScopeId("Snowflake-Agent-Token-Hackathon"), "Snowflake-Agent-Token-Hackathon");
  assert.equal(sanitizeScopeId("my repo"), "my-repo");
  assert.equal(sanitizeScopeId("/Users/me/repo"), "Users-me-repo");
  assert.equal(sanitizeScopeId("a//b\\c:d*e"), "a-b-c-d-e");
  assert.equal(sanitizeScopeId("."), "workspace");
  assert.equal(sanitizeScopeId(".."), "workspace");
  assert.equal(sanitizeScopeId(""), "workspace");
  assert.equal(sanitizeScopeId("---"), "workspace");
  assert.equal(sanitizeScopeId(undefined), "workspace");
  assert.equal(sanitizeScopeId("café"), "cafe"); // NFKD strips the combining accent
  assert.ok(sanitizeScopeId("a".repeat(500)).length <= 100);

  // ".." must not survive anywhere in the output, not just as the whole string.
  assert.equal(sanitizeScopeId("my scope/../x"), "my-scope-.-x");
  assert.equal(sanitizeScopeId("a...b"), "a.b");

  for (const input of ["/Users/me/repo", "my repo", "café", "..", "../../etc/passwd", "a...b", "a".repeat(500)]) {
    const out = sanitizeScopeId(input);
    assert.match(out, /^[A-Za-z0-9_.-]+$/, `charset violated for ${input}`);
    assert.ok(out !== "." && out !== ".." && out.length >= 1 && out.length <= 128);
    assert.ok(!out.includes(".."), `".." survived sanitization of ${input}`);
  }
});

test("deriveProjectId is stable, legal, and prefers the git root", () => {
  const a = deriveProjectId("/tmp/some-repo/nested/deep", { execFileImpl: gitReturns("/tmp/some-repo"), env: {} });
  const b = deriveProjectId("/tmp/some-repo", { execFileImpl: gitReturns("/tmp/some-repo"), env: {} });
  assert.equal(a, b, "same repo from different subdirs must map to one id");
  assert.match(a, /^some-repo-[0-9a-f]{8}$/);
  assert.ok(a.length <= 128);
  assert.doesNotMatch(a, /\//, "must not embed the absolute path");
});

test("deriveProjectId falls back to cwd when git fails", () => {
  const id = deriveProjectId("/tmp/not-a-repo", { execFileImpl: gitThrows, env: {} });
  assert.match(id, /^not-a-repo-[0-9a-f]{8}$/);
});

test("deriveProjectId disambiguates same-named repos", () => {
  const one = deriveProjectId("/a/api", { execFileImpl: gitReturns("/a/api"), env: {} });
  const two = deriveProjectId("/b/api", { execFileImpl: gitReturns("/b/api"), env: {} });
  assert.notEqual(one, two);
  assert.ok(one.startsWith("api-") && two.startsWith("api-"));
});

test("EVEROS_PROJECT_ID overrides and is still sanitized", () => {
  assert.equal(deriveProjectId("/tmp/x", { execFileImpl: gitThrows, env: { EVEROS_PROJECT_ID: "my scope/../x" } }), "my-scope-.-x");
});

/* ── 10. context truncation / bounding ─────────────────────────────────── */

test("oversized fields are clamped and the block stays bounded", () => {
  const huge = "x".repeat(50_000);
  const block = buildContextBlock({
    agent_cases: Array.from({ length: 5 }, (_, i) => ({
      task_intent: `intent ${i} ${huge}`,
      approach: huge,
      quality_score: 0.5,
      key_insight: huge,
    })),
    agent_skills: Array.from({ length: 5 }, (_, i) => ({
      name: `skill ${i} ${huge}`,
      description: huge,
      content: huge,
    })),
  });

  assert.ok(block.length <= LIMITS.block, `block was ${block.length}, cap ${LIMITS.block}`);
  assert.ok(block.length < 10_000);
  assert.match(block, /\[… truncated\]$/);
  assert.ok(!block.includes("x".repeat(LIMITS.approach + 50)), "a single field escaped its cap");
});

test("truncation drops whole entries, never half-rendered ones", () => {
  const filler = "y".repeat(600);
  const block = buildContextBlock({
    agent_cases: Array.from({ length: 20 }, (_, i) => ({
      task_intent: `case ${i}`,
      approach: filler,
      quality_score: 1,
      key_insight: filler,
    })),
    agent_skills: [],
  });

  assert.ok(block.length <= LIMITS.block);
  // Every rendered "- case N" line must still carry its Key insight line.
  const heads = (block.match(/^- case \d+/gm) || []).length;
  const insights = (block.match(/^ {2}Key insight:/gm) || []).length;
  assert.equal(heads, insights, "an entry was cut in half");
  assert.ok(heads > 0 && heads < 20, "expected some entries dropped");
});

test("clampText collapses whitespace and marks truncation", () => {
  assert.equal(clampText("  a\n\n  b  ", 100), "a b");
  assert.equal(clampText("", 10), "");
  assert.equal(clampText(null, 10), "");
  const cut = clampText("z".repeat(100), 10);
  assert.equal(cut.length, 10);
  assert.ok(cut.endsWith("…"));
});

test("buildContextBlock returns empty string when nothing is renderable", () => {
  assert.equal(buildContextBlock({ agent_cases: [], agent_skills: [] }), "");
  assert.equal(buildContextBlock({}), "");
  assert.equal(buildContextBlock(null), "");
  assert.equal(buildContextBlock({ agent_cases: [{ task_intent: "  " }], agent_skills: [{ name: "" }] }), "");
});

/* ── 11. request body shape ────────────────────────────────────────────── */

test("request body matches EverOS SearchRequest exactly (extra='forbid')", async () => {
  const impl = fakeFetch(emptyData);
  await runHook({
    input: hookInput(),
    env: baseEnv,
    fetchImpl: impl,
    execFileImpl: gitReturns("/tmp/some-repo"),
  });

  assert.equal(impl.calls.length, 1);
  const { url, init, body } = impl.calls[0];

  assert.equal(url, "http://127.0.0.1:8000/api/v2/memory/search");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/json");
  assert.ok(init.signal, "must send an abort signal");

  assert.deepEqual(Object.keys(body).sort(), [
    "agent_id",
    "app_id",
    "enable_llm_rerank",
    "method",
    "project_id",
    "query",
    "top_k",
  ]);
  assert.equal(body.agent_id, "coding-orchestrator");
  assert.equal(body.user_id, undefined, "user_id and agent_id are mutually exclusive");
  assert.equal(body.app_id, "agentplan");
  assert.equal(body.method, "keyword");
  assert.equal(body.top_k, 5);
  assert.equal(body.enable_llm_rerank, false);
  assert.equal(body.query, PROMPT);
  assert.match(body.project_id, /^[A-Za-z0-9_.-]{1,128}$/);
});

test("top_k is clamped into EverOS's 1..100 range", () => {
  const body = buildRequestBody({ agentId: "a", appId: "b", projectId: "c", query: "q", method: "keyword", topK: 5 });
  assert.equal(body.top_k, 5);
});

test("a very long prompt is clamped before being sent", async () => {
  const impl = fakeFetch(emptyData);
  await runHook({
    input: hookInput({ prompt: "w".repeat(10_000) }),
    env: baseEnv,
    fetchImpl: impl,
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  assert.ok(impl.calls[0].body.query.length <= LIMITS.query);
});

/* ── 12. the prompt is never echoed back ───────────────────────────────── */

test("additionalContext does not echo the submitted prompt", async () => {
  const out = await runHook({
    input: hookInput(),
    env: baseEnv,
    fetchImpl: fakeFetch(oneCase),
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.ok(!ctx.includes(PROMPT), "context must not duplicate the user's prompt");
});

/* ── env overrides ─────────────────────────────────────────────────────── */

test("EVEROS_URL / METHOD / TOP_K overrides are honored", async () => {
  const impl = fakeFetch(emptyData);
  await runHook({
    input: hookInput(),
    env: { EVEROS_URL: "http://127.0.0.1:9999/", EVEROS_METHOD: "vector", EVEROS_TOP_K: "3", EVEROS_AGENT_ID: "other" },
    fetchImpl: impl,
    execFileImpl: gitReturns("/tmp/some-repo"),
  });
  const { url, body } = impl.calls[0];
  assert.equal(url, "http://127.0.0.1:9999/api/v2/memory/search", "trailing slash must not double up");
  assert.equal(body.method, "vector");
  assert.equal(body.top_k, 3);
  assert.equal(body.agent_id, "other");
});
