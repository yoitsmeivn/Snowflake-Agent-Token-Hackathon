
# About this project

**agentplan** — a local-first orchestration harness for coding agents. Built for the Snowflake × Beta Fund × EverMind Agent & Token Economy Hackathon, Track 1 (cost reduction).

- **Input**: one engineering goal + one registered local git repo
- **Planner**: a read-only `claude -p` session reads the real repo and emits a validated task DAG
- **Per task it assigns**: model, harness, skills, tools, context, permissions, worktree, budget
- **Execution**: each task runs as a separate OS process on a real coding CLI, in parallel where the DAG allows
- **Output**: diffs in isolated worktrees + a per-model cost breakdown, routed vs all-frontier baseline

**The distinction that defines the product** — this is *allocation*, not routing:

- A router picks a model per prompt at runtime. Here, `model` is a **field on a planned task**, decided once during planning. No runtime classifier.
- Decomposition and assignment are **one decision** — a task is only worth splitting out if it can go to a cheaper engine, and a model is only assignable once the work is bounded.
- `plan.json` is the product, not a byproduct. Schema-validated, written `0444`, never mutated. That immutability is what makes "was the allocation any good?" answerable.
- Every task carries a written `model_rationale`. That artifact is the proof it's allocation.

**Not**: an inference gateway · a rebuild of any agent's inner loop · Claude Code native subagents (workers are peer OS processes) · a Claude-only system · hosted SaaS · an auto-merge bot.

**Honesty constraints** — load-bearing, see PLAN.md §16:

- Only Claude Code returns real dollars. Codex and local costs are *estimated equivalents*, labelled everywhere.
- Unknown cost renders "— tokens only", never `$0.00`.
- The baseline holds token counts constant across models; that assumption is printed next to the number.

Full design in [PLAN.md](PLAN.md) — §28 supersedes §18–19.

# Tech Stack

Local-first TUI. One Node process — no web UI, no HTTP API, no SSE (PLAN.md §28 supersedes §18–19).

**Runtime & tooling**

- Node 22.22.3, ESM only (`"type": "module"`)
- pnpm 10.20 workspaces — `apps/*`, single package `@agentplan/cli`
- TypeScript 5.9, `strict` + `noUncheckedIndexedAccess`, `moduleResolution: bundler`, `verbatimModuleSyntax`
- `tsx` runs sources directly — `noEmit: true`, no build step, no bundler
- `pnpm dev` = `tsx src/cli.tsx` · `pnpm typecheck` = `tsc --noEmit`

**App**

- Ink 6 + React 19 — terminal renderer, `jsx: react-jsx`
- Zod 4 — plan schema is the single source of truth
- **No database.** State is files under `~/.agentplan/`; the catalog and skill registry are in-memory, rebuilt at boot
- Scheduler, harness adapters, and renderer share one process and one `EventEmitter`
- Vitest is the planned test runner (§23) — not yet a dependency

**Harnesses** — spawned as child processes, each authenticates itself; the app holds no provider keys

| Tier | CLI | Version | Backend |
|---|---|---|---|
| Frontier | `claude -p` | 2.1.224 | Anthropic — only harness returning exact `total_cost_usd` |
| Mid | `codex exec` | 0.145.0 | OpenAI, ChatGPT OAuth (`~/.codex/auth.json`) |
| Local | `opencode run` | 1.18.15 | vLLM `cpatonn/Qwen3-4B-Instruct-2507-AWQ-4bit` @ `127.0.0.1:8000`, 32768 ctx |

- `gemini` is **not installed** on this machine — its catalog rows probe to `not-installed`
- Claude Code cannot drive the local model: its system prompt (~67k tokens) exceeds the 32k window

**Storage & isolation**

Everything lives under `~/.agentplan/`, never in the user's repo.

```text
~/.agentplan/
  config.json                    workspaces, catalog overrides (0600)
  runs/<runId>/
    plan.json                    frozen at 0444, never mutated
    tasks.jsonl                  one flat row per task — the telemetry record
    tasks/<taskId>/              context-packet.md, summary.json, output.md,
                                 patch.diff, events.ndjson, stderr.log
```

- **`tasks.jsonl` is the fact table** — flat, denormalized, one row per task. Snowflake ingests NDJSON directly (`COPY INTO … FILE_FORMAT=(TYPE=JSON)`), so the "sync it later" story survives dropping the DB.
- Usage view globs `runs/*/tasks.jsonl` and aggregates in JS — tens of rows, not thousands
- Restart recovery: a task row with no terminal status on load → `failed (interrupted_by_restart)`
- Git worktrees at `<repo>/.worktrees/<runId>/<taskId>` for writing tasks

**Deliberately absent**: database of any kind, bundler, HTTP server, charting or graph-layout lib, state manager, component library, `snowflake-sdk`, Claude Agent SDK.

# Chat Rules
Keep messages simple and use less words. Explain things in bullet points.
