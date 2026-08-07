# Local-First Coding-Agent Orchestration Harness — Implementation Plan

*Snowflake × Beta Fund × EverMind Agent & Token Economy Hackathon.*
*Research and plan only — no application code has been written.*

---

## 1. Context and scope

**What the brief asks for.** A local-first harness where *one strong planner decomposes an engineering goal into subagents, and assigns each subagent its own model, harness, skills, tools, context, permissions, workspace, and budget — before any execution begins.* The thing being built is a **planner that allocates resources**, not a gateway that picks a model per prompt.

**Starting point.** The repo is a bare `git init` on `main`: zero commits, no files, no `package.json`, no remote, no env vars set. Every decision below is a greenfield choice justified against the local toolchain that *is* present (§3).

**Intended outcome.** A locally-runnable app that: registers a git workspace → takes a goal → produces a validated task DAG with per-task model/harness assignments → executes 2–4 tasks across at least two harnesses → streams status to a dashboard → records token/cost telemetry → writes execution memory to EverOS → shows actual vs. baseline cost.

**Scope decisions confirmed with the user:**

1. Node API + Vite React SPA, pnpm workspaces.
2. Planner is `claude -p --output-format json --json-schema`.
3. **Snowflake is out of the MVP** — EverOS is the only sponsor integration. Concern stated once and dropped: this is a Snowflake-hosted hackathon and Track 1 is cost-reduction, so an empty Snowflake story may cost judging points. Mitigation: the telemetry table is shaped as a flat, Snowflake-ready fact table with an outbox column, so `pnpm sync:snowflake` is a ~60-line addition later, not a refactor (§16).

---

## 2. Product definition

| | |
|---|---|
| **Input** | One engineering goal + one registered local git workspace |
| **Planner** | One strong model, read-only, repo-aware, emits a validated DAG |
| **Unit of work** | A *planned task* — a bounded work unit with its own assigned resources |
| **Execution** | Local child processes running real coding-agent CLIs |
| **Isolation** | Git worktrees, one per writing task |
| **Output** | Diffs in worktrees + structured artifacts + a cost/usage record |
| **Persistence** | Local SQLite + a run artifact directory |
| **Memory** | EverOS (local, Markdown-backed) |

**The core differentiator:**

```
MODEL ROUTING (what we are not)
   prompt ──▶ classifier ──▶ model ──▶ answer

THIS SYSTEM
   engineering goal
        │
        ▼
   strong planner  ◀── repo profile · skills · harnesses · model catalog
        │               costs · constraints · concurrency · prior memory
        ▼
   VALIDATED EXECUTION PLAN (a DAG, produced in full before execution)
        ├── Task A · Gemini Flash    · read-only · skills[repo-exploration]
        ├── Task B · Claude Opus 5   · read-only · depends A · skills[architecture]
        ├── Task C · Codex gpt-5.6   · worktree  · depends B · skills[ts-coding]
        └── Task D · Claude Sonnet 5 · read-only · depends C · skills[review]
        │
        ▼
   execution engine (dependency-ready → parallel → isolated)
```

The planner answers **what work exists, who does it, what they need, and which engine runs it** — as one allocation decision, before execution.

**What this is NOT:**

- **Not an inference gateway / per-prompt router.** Model choice is a *field on a planned task*, decided once during planning. No runtime classifier.
- **Not a rebuild of Claude Code / Codex / Gemini CLI.** They are opaque harnesses driven over stdin/stdout.
- **Not Claude Code native subagents.** Workers are separate OS processes behind adapters — see §9, where this is specified once and load-bearing.
- **Not a Claude-only system.** Claude Code runs the *planner* because it is the best read-only, repo-aware, schema-validated planning surface on this machine. Workers can be any catalog model on any harness, and the architecture assumes they usually aren't Claude.
- **Not a hosted SaaS**, not an autonomous merge bot, not a chain-of-thought viewer.

---

## 3. Verified local toolchain

The repo contributes nothing — no stack, backend, persistence, tests, env management, or git tooling exists. SQLite, Vitest, and pnpm workspaces are therefore free choices rather than migrations.

| Tool | Version | Path | Auth state |
|---|---|---|---|
| `claude` | 2.1.224 | `~/.local/bin/claude` | Subscription/OAuth (no `ANTHROPIC_API_KEY`) |
| `codex` | 0.146.0 | `/opt/homebrew/bin/codex` | ChatGPT OAuth in `~/.codex/auth.json`; `OPENAI_API_KEY` null |
| `gemini` | 0.22.5 | `~/.bun/bin/gemini` | `~/.gemini` exists; no API key env var |
| `node` | v25.1.0 | — | `node:sqlite` **verified working** (`DatabaseSync`, `StatementSync`) |
| `pnpm` | 10.27.0 | — | preferred; npm 11.6.2 and bun 1.3.5 also present |
| `python3` / `uv` | 3.12.3 / 0.9.17 | — | meets EverOS's Python 3.12+ requirement |

**Two consequences that shape the whole design:**

1. **All three harnesses authenticate themselves.** The app spawns already-logged-in CLIs and never handles a provider API key. This is the biggest secret-management win available and the plan leans on it hard (§15).
2. **Codex and Gemini are on subscription/OAuth auth, so their tokens have no true marginal dollar cost.** Only Claude Code returns real dollars (`total_cost_usd`). Every non-Claude cost figure is an **estimated equivalent API cost**, labelled as such everywhere it appears (§17). Not negotiable — fabricated savings would sink a Track 1 submission on inspection.

---

## 4. System architecture

```
┌───────────────────────────────────────────────────────────────┐
│  web/  Vite + React SPA        :5173 (dev, proxies /api)      │
│  Dashboard · New Run · Plan View · Execution · Usage · Settings│
└──────────────┬────────────────────────────────────────────────┘
               │ REST (JSON)  +  GET /api/runs/:id/events (SSE)
┌──────────────▼────────────────────────────────────────────────┐
│  server/  single Node process   :8787                          │
│                                                               │
│  http/        Hono routes                                     │
│  planner/     builds prompt, spawns read-only claude -p,       │
│               parses structured_output, validates vs catalog   │
│  scheduler/   DAG · ready-set · concurrency cap · cancellation │
│  harness/     ClaudeCodeAdapter · CodexAdapter · GeminiAdapter │
│  workspace/   git worktree create / dirty-check / cleanup      │
│  context/     builds per-task context packets                  │
│  usage/       token normalization · cost model · baseline calc │
│  memory/      EverOS client (write-after-run, read-before-plan)│
│  db/          node:sqlite  → ~/.agentplan/agentplan.db         │
│  bus/         in-process EventEmitter → SSE fan-out            │
└──────────────┬────────────────────────────────────────────────┘
               │ spawn()                          │ HTTP
   ┌───────────┼───────────┐                      ▼
   ▼           ▼           ▼               EverOS :8000
 claude      codex       gemini            (local, Markdown+
  -p         exec         -o json           SQLite+LanceDB)
   │           │           │
   └───────────┴───────────┴──▶  ~/repo  and  ~/repo/.worktrees/<run>/<task>
```

**Why a single process:** the child-process registry, SSE bus, and scheduler must share memory. Everything binds to localhost; the only network dependencies are the CLIs' own provider calls and local EverOS.

---

## 5. Planner

A **read-only Claude Code session**, which buys four things at once: real repo awareness via `Read`/`Grep`/`Glob`; schema-validated output via `--json-schema` → `structured_output`; *measured* planning cost via `total_cost_usd`; and zero key handling.

```bash
claude -p "<planner prompt>" \
  --model opus \
  --effort high \
  --output-format json \
  --json-schema "$(cat plan.schema.json)" \
  --allowedTools "Read,Grep,Glob" \
  --permission-mode dontAsk \
  --add-dir "<workspace path>" \
  --append-system-prompt "<planner role + hard constraints>" \
  --max-budget-usd 2.00 \
  --no-session-persistence
```

Run with `cwd` set to the workspace. `dontAsk` plus a read-only tool list means the planner physically cannot write; `--max-budget-usd` is a hard stop against a runaway planner.

**What the planner receives** (`planner/prompt.ts`): the goal verbatim · a **repository profile** (§10, compact facts not file dumps) · `CLAUDE.md`/`AGENTS.md`/`README.md` excerpts · the **skill registry** (id/name/description/applicability for every discovered skill — descriptions only, never instruction text, §8) · the **harness registry** (installed *and* authenticated right now) · the **model catalog** (only `enabled` rows with an available harness) · **constraints** (max cost, max parallelism, whether writes are permitted) · **prior memory** (top-k EverOS hits, §18).

**Decomposition and assignment are one decision, not two.** The planner chooses *how to split the work* and *who executes each piece* together, because the two constrain each other — a task is only worth splitting out if it can be handed to a cheaper or more suitable engine, and a model is only assignable once the work unit is bounded. There is deliberately no second-stage "now pick models" pass and no runtime router. The output of this single call is the frozen allocation.

**Hard rules in the planner system prompt:**

- Emit only `model_id`/`harness_id`/`skill_id` values present in the supplied registries.
- `model` and `harness` are chosen **per task**. Do not apply one model to the whole plan, and do not infer a model from a task's skills — skills carry no model.
- Every task must carry `model_rationale` explaining *why this class of model* for *this work*. This is the artifact that proves the product is allocation, not routing.
- Prefer the cheapest model that can do the work; reserve frontier models for high-leverage reasoning.
- Do not implement anything. Emit a plan.
- Read-only tasks share the main repo. Any task that writes gets `worktree.mode = "dedicated"`.

**Validation gates** (`planner/validate.ts`), all before anything executes:

1. **Schema** — Zod parse of `structured_output`.
2. **Registry** — every id exists and is enabled; the model is actually supported by the assigned harness.
3. **Graph** — every dependency id resolves; no cycles (Kahn); `context_from ⊆ dependencies`.
4. **Permissions** — no `write` while `worktree.mode = "none"`; no `shell` without a declared allow-list.
5. **Budget** — Σ `estimated_cost_usd` ≤ run budget, else returned flagged `over_budget` for the user to accept or re-plan.

Failures surface in the UI with the offending field. **One** automatic re-plan is attempted with the validation errors appended; a second failure is reported, not retried.

---

## 6. `plan.json` — the product artifact

**`plan.json` is the central artifact of this system, not a byproduct of an LLM call.** It is a persisted, versioned, schema-validated allocation decision that the scheduler, UI, cost model, and memory writer all read. The Claude Code call is merely how the first draft is produced; swap the planner tomorrow and `plan.json` is unchanged in shape.

**Immutability contract:**

- After validation, written to `~/.agentplan/runs/<runId>/plan.json` with mode `0444` and **never mutated**. The DB copy in `runs.plan_json` is likewise write-once.
- A re-plan creates a **new run** with a new `plan.json`, so both remain inspectable and diffable.
- **No runtime field may ever appear in the plan schema** — `status`, timestamps, actual model/tokens/duration/cost, exit code, worktree path, artifact paths all live on the `tasks` runtime record (§14). A `.strict()` parse plus a unit test asserting the schema contains none of those key names keeps the boundary from eroding.

This is what makes actual-vs-planned comparison, baseline-vs-actual cost (§17), and "did the planner allocate well?" answerable at all.

Defined once in `packages/core/src/plan.ts` as Zod, with `zod-to-json-schema` producing the `--json-schema` payload — single source of truth for planner, server, and UI. Improvements over the brief's sketch are marked **[+]**.

```ts
ExecutionPlan {
  schema_version: "1"                    // [+] lets stored plans survive changes
  id: string
  workspace_id: string
  goal: string
  rationale_summary: string              // planner's overall strategy, shown in UI
  risk_notes: string[]                   // [+] what the planner is unsure about
  concurrency_limit: number              // [+] planner's own parallelism opinion
  budget { max_total_cost_usd: number | null }
  tasks: PlannedTask[]
}

PlannedTask {
  id: string                             // "t1", stable, referenced by dependencies
  name: string
  objective: string                      // the actual instruction to the worker
  agent_role: "explorer" | "architect" | "implementer"
              | "reviewer" | "tester" | "documenter"
  acceptance_criteria: string[]          // [+] what "done" means; drives review tasks

  harness: HarnessId                     // "claude-code" | "codex" | "gemini-cli"
  model: ModelId                         // must exist in the catalog
  model_rationale: string                // [+] REQUIRED. why this model class.

  skills: SkillId[]                      // 0..n — multi-select, resolved against the
                                         // SkillRegistry (§8). Skills carry no model;
                                         // model is assigned here, on the task.
  tools: ToolId[]                        // "read" | "edit" | "bash" | "web" | "git"

  relevant_files: string[]               // repo-relative hints, not a hard limit
  context_from: TaskId[]                 // whose artifacts get injected
  dependencies: TaskId[]                 // DAG edges (superset of context_from)

  expected_artifacts: {                  // [+] contract for downstream tasks
    summary: boolean                     // summary.json (always true in practice)
    output_markdown: boolean             // output.md
    diff: boolean                        // patch.diff from the worktree
  }

  permissions {
    filesystem: "none" | "read" | "read-write"
    shell: { enabled: boolean, allow: string[] }   // [+] explicit allow-list
    git:    { read: boolean, commit: boolean }     // [+] never push
    network: boolean                               // [+]
  }

  execution {
    worktree: { mode: "none" | "shared" | "dedicated", branch_hint?: string }
    parallelizable: boolean
    max_turns: number
    timeout_seconds: number
    effort?: "low" | "medium" | "high" | "xhigh" | "max"   // [+] maps per harness
  }

  estimates {
    expected_input_tokens: number
    expected_output_tokens: number
    estimated_cost_usd: number
    confidence: "low" | "medium" | "high"                  // [+] honesty signal
  }

  escalation?: {                                            // [+] post-MVP hook
    on_failure: "none" | "retry_same" | "escalate"
    escalate_to_model?: ModelId
  }
}
```

---

## 7. Model catalog

A **seeded, editable table** — not a hardcoded map, not a scraped API. Capability is expressed as **tags and coarse tiers we chose**, never invented numeric scores. Editable from Settings so it can evolve during the hackathon without a code change.

```ts
ModelCatalogEntry {
  id: string                 // "claude-opus-5"
  provider: "anthropic" | "openai" | "google"
  display_name: string
  harnesses: HarnessId[]     // which CLIs can actually drive it
  local: boolean             // false for all MVP entries
  context_window: number

  price_input_per_mtok: number | null    // null = unknown/not applicable
  price_output_per_mtok: number | null
  price_source: "published" | "estimated" | "subscription-no-marginal-cost"

  cost_tier:  "low" | "medium" | "high" | "premium"
  speed_tier: "fast" | "medium" | "slow"
  capabilities: string[]     // "coding" | "architecture" | "review" | "repo-exploration"
                             // "long-context" | "structured-output" | "tool-use"
  reliability_notes: string  // free text shown to the planner
  enabled: boolean
  availability: "available" | "unauthenticated" | "not-installed"  // computed at boot
}
```

| id | provider | harnesses | in/out $/MTok | tier | capabilities |
|---|---|---|---|---|---|
| `claude-opus-5` | anthropic | claude-code | 5 / 25 | premium | architecture, review, long-context, structured-output |
| `claude-sonnet-5` | anthropic | claude-code | 3 / 15 | high | coding, review, tool-use |
| `claude-haiku-4-5` | anthropic | claude-code | 1 / 5 | low | repo-exploration, extraction |
| `gpt-5.6-sol` | openai | codex | subscription | high | coding, implementation, refactoring, tests |
| `gpt-5.4-mini` | openai | codex | subscription | low | bounded edits, tests |
| `gemini-2.5-flash` | google | gemini-cli | subscription | low | repo-exploration, broad reading, extraction |
| `gemini-2.5-pro` | google | gemini-cli | subscription | high | analysis, long-context |

Anthropic IDs and prices come from the current published catalog. Codex slugs are read from this machine's own `~/.codex/models_cache.json` (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`), so they are real for this install rather than guessed. Subscription rows show *equivalent* cost from the published API rate where one exists, always labelled.

**Availability probe at boot** (`harness/detect.ts`): `which` each binary + a cheap `--version`; mark rows `not-installed`/`unauthenticated`. Unavailable models are filtered out of the planner's catalog — that is *why the planner cannot assign something that won't run*.

---

## 8. Skill registry — discovery-first, never model-bound

A skill is **reusable procedural knowledge**, injected as text into a worker's task context. It is not a model, not a tool, not a harness.

**Skills are discovered, not authored by this app.** Real repos and users already have this knowledge on disk; duplicating it into `server/src/skills/*.md` would fork it and let it rot.

| Precedence | Location | Scope |
|---|---|---|
| 1 (highest) | `<workspace>/.agents/skills/` | Project-specific, checked into the repo |
| 2 | `<workspace>/.claude/skills/` | Project-specific, Claude Code convention |
| 3 | `~/.agents/skills/` | User-level |
| 4 | `~/.claude/skills/` | User-level (this machine already has ~24 skills here) |
| 5 (lowest) | app built-ins | **Fallback only** |

First match wins on id collision, so a workspace or user skill **shadows** a built-in. Built-ins exist so a bare repo still produces a sensible plan — a floor, not the source of truth. Shipped built-ins: `repo-exploration`, `code-implementation`, `testing`, `architecture-review`, `security-review`, `git-review` — deliberately generic; anything project-specific belongs in the workspace where its owners can version it.

**Read in place, never copied.** The registry stores a pointer (`source_path`, `source_scope`, `mtime`, `content_hash`) plus normalized fields; instruction text is read from the original file at packet-build time, so editing `<repo>/.claude/skills/testing/SKILL.md` changes worker behavior on the next run with no re-import. Re-scan on workspace registration, on Settings refresh, and when a cached `mtime`/hash mismatches.

**Formats accepted**, both normalized to one shape: **directory form** (`<dir>/SKILL.md` with YAML front-matter `name`, `description`, optional `languages`, `roles`; siblings become resource paths) and **flat form** (`<name>.md`, front-matter optional, falling back to filename as id and first heading/paragraph as description). Unparseable files are skipped with a warning, never fatally — a malformed skill in someone's home directory must not break planning.

```ts
Skill {
  id: string                    // slug; unique after precedence resolution
  name: string
  description: string           // the PLANNER's selection signal ("when to use this")
  instructions_ref: {           // NOT inlined — read at packet-build time
    source_path: string
    source_scope: "workspace-agents" | "workspace-claude"
                | "user-agents" | "user-claude" | "builtin"
    content_hash: string
  }
  resource_paths: string[]      // sibling files, passed as paths
  applies_to_languages: string[] | null
  applies_to_roles: AgentRole[] | null
}
```

**No skill may have a model or harness attached — a hard invariant, not a convention.** `Skill` has no such key, the Zod schema is `.strict()` so a discovered file declaring `model:` has that key rejected (with a warning naming the file), and a unit test asserts it. A skill describes *how to do a kind of work*; the planner decides *who does it and on what engine*, per task. Binding a model to a skill collapses the product back into static routing.

**Selection and injection.** The planner sees only `id`/`name`/`description`/`applies_to_*`. A task selects zero or more skills — multi-select is normal (`typescript-coding` + `testing` + a workspace `house-style`). The worker receives resolved instruction text in its context packet (§10) plus `resource_paths` to read itself. The text is identical across harnesses; only the transport differs: Claude Code `--append-system-prompt`, Codex a prepended `## Skills` block in the stdin prompt, Gemini the same block in the positional prompt.

**The five-way distinction**, used consistently in code, DB columns, API fields, and UI labels — enforced by the type system where possible:

| Concept | Definition | Where it lives | Enforcement |
|---|---|---|---|
| **PlannedTask** | **Binds** objective + skills + harness + model + context + permissions | `plan.tasks[]` | The only place `model` and `harness` co-occur with `skills` |
| **Skill** | Reusable procedural knowledge — *how* to do a kind of work | `SkillRegistry`, sourced from disk | No `model`/`harness` field; `.strict()` rejects them |
| **Tool** | A capability a worker may perform | `permissions` + harness tool flags | Mapped to each harness's sandbox/allow flags |
| **Harness** | The **execution environment** running the agent loop | `CodingHarness` adapter → an OS process | One adapter per CLI (§9) |
| **Model** | The **inference resource** | `task.model` → the harness's `--model` flag | Must exist in the catalog *and* be supported by the harness |

The failure modes this prevents: a skill with a model attached is static routing; a model without a harness is unrunnable; a harness that is really a nested subagent isn't multi-vendor; a task that doesn't bind all four isn't an allocation decision.

---

## 9. Harness adapters

### A worker is an OS process, not a native subagent

At the product level we say *agent*/*worker*/*subagent* interchangeably for one executing `PlannedTask`. At the implementation level: a worker is a `PlannedTask` executed by a harness adapter as a **separate OS process** with its own PID, process group, and `cwd`/worktree, controlled by our scheduler from the frozen plan and running the model the *plan* assigned. Claude Code's own `Agent` tool / `--agents` definitions — spawned inside one Claude Code session, controlled by the model mid-conversation — are **not used**: no `--agents` JSON is passed, and the Agent tool is in no worker's `--allowedTools`.

**There is no `Agent(model="codex")` in this system, and the plan must never be read as implying one.** `harness: "codex"` → `spawn("codex", ["exec", ...])`, a real process running OpenAI's CLI on OpenAI's credentials. `harness: "gemini-cli"` → `spawn("gemini", [...])`. `harness: "claude-code"` → `spawn("claude", ["-p", ...])`, a **top-level** process — not nested under the planner session, which has long since exited by the time workers run. Every worker is a peer under our supervisor; this is what makes the system genuinely multi-vendor rather than Claude-with-extra-steps.

The one place Claude Code is privileged is the planner (§5) — an implementation choice about the planning step, not a constraint on workers.

### The interface

```ts
interface CodingHarness {
  readonly id: HarnessId;
  detect(): Promise<{ installed: boolean; version?: string; authenticated: boolean }>;
  supportsModel(modelId: string): boolean;

  execute(input: {
    task: PlannedTask;
    packet: ContextPacket;      // §10
    cwd: string;                // repo root or dedicated worktree
    signal: AbortSignal;
  }): AsyncIterable<HarnessEvent>;

  // cancel() is deliberately absent — cancellation is the AbortSignal, and
  // uniform process-tree kill lives in one place (§12), not per adapter.
}

type HarnessEvent =
  | { kind: "started";   pid: number; sessionId?: string }
  | { kind: "log";       level: "info"|"warn"|"error"; message: string }
  | { kind: "tool";      name: string; summary: string }   // operational, never CoT
  | { kind: "usage";     usage: NormalizedUsage }
  | { kind: "artifact";  path: string; type: "summary"|"output"|"diff" }
  | { kind: "finished";  exitCode: number; usage: NormalizedUsage;
                         costUsd: number | null; costIsExact: boolean };

type NormalizedUsage = {
  inputTokens: number; outputTokens: number;
  cachedInputTokens: number; reasoningTokens: number;
  totalTokens: number;
};
```

Every adapter is a thin translator: build argv → spawn → parse the harness's stream → emit `HarnessEvent`. `costIsExact` is what lets the usage dashboard be honest without special-casing providers in the UI.

### CLI capability matrix

Verified against `claude --help` 2.1.224, `codex exec --help` 0.146.0, `gemini --help` 0.22.5.

| Requirement | Claude Code | Codex | Gemini |
|---|---|---|---|
| Pass prompt | positional after `-p` (stdin ≤10MB) | positional, or stdin when omitted / `-` | **positional** (`-p` deprecated); stdin appended |
| Specify model | `--model` (alias or full id) | `-m/--model` | `-m/--model` |
| Working dir | process `cwd` + `--add-dir` | **`-C/--cd <DIR>`** (+ `--add-dir`) | **no `--cd`** — must set spawn `cwd`; `--include-directories` adds scope |
| Non-interactive | `-p` / `--print` | `codex exec` | positional query is one-shot |
| Structured output | `--json-schema` + `--output-format json` → `structured_output` | **`--output-schema <FILE>`** | none — prompted JSON contract + Zod parse (read-only roles only) |
| Stream | `--output-format stream-json --verbose` (NDJSON) | `--json` → JSONL (`thread.started`, `item.*`, `turn.completed`) | `--output-format stream-json` (`json` for one-shot) |
| Cancellation | SIGTERM aborts the turn, kills the Bash tree, exits **143** | SIGTERM on the process group | SIGTERM on the process group |
| **Token usage** | `result` event `usage` | `turn.completed.usage {input, cached_input, output}` — **cumulative** | `stats.models[m].tokens {prompt, candidates, cached, total, thoughts, tool}` |
| **Cost** | `result.total_cost_usd` + per-model breakdown — **exact dollars** | not returned → derived, flagged estimated | not returned → derived, flagged estimated |
| Permissions | `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--tools` | `--sandbox read-only \| workspace-write \| danger-full-access` | `--approval-mode default\|auto_edit\|yolo`, `--allowed-tools` |
| Worktrees | native `-w/--worktree` **not used** | none | none |

We manage worktrees ourselves for cross-harness uniformity (§13).

**Invocations:**

```bash
claude -p "<objective + context packet>" \
  --model <catalog model id or alias> \
  --output-format stream-json --verbose \
  --permission-mode <acceptEdits | dontAsk> \
  --allowedTools "<Read,Grep,Glob[,Edit,Write,Bash(...)]>" \
  --append-system-prompt "<skills>" \
  --add-dir "<worktree>" --max-turns <n> \
  --no-session-persistence --session-id <uuid>          # cwd = the task's worktree

codex exec "<objective + context packet>" \
  --model <gpt-5.6-sol | gpt-5.4-mini | ...> \
  -c model_reasoning_effort="<low|medium|high|xhigh|max>" \
  --cd "<worktree>" --sandbox <read-only | workspace-write> \
  --json --output-last-message "<runs/.../last_message.txt>" --skip-git-repo-check

gemini "<objective + context packet>" \
  --model <gemini-2.5-flash | gemini-2.5-pro> \
  --output-format json --approval-mode <default | auto_edit> \
  --include-directories "<worktree>"                     # cwd = the task's worktree
```

**Parsing notes, one per harness:**

- **Claude** — `system/init` → `started`; `assistant` messages → `tool` events from `tool_use` blocks; **`thinking` blocks dropped** (§16); `result` → `finished` with `costIsExact: true`. Extras used: `--max-budget-usd` as a per-task cap, `--effort` mapped from `execution.effort`. `--bare` is *not* used for workers (we want the workspace's `CLAUDE.md`) but is worth considering for the planner if cross-machine reproducibility becomes an issue.
- **Codex** — `turn.completed.usage` is **cumulative**, so last-event-wins; summing double-counts. Filter `item.type === "reasoning"` before writing logs. `--dangerously-bypass-approvals-and-sandbox` is never emitted.
- **Gemini** — map `prompt → inputTokens`, `candidates → outputTokens`, `cached → cachedInputTokens`, `thoughts → reasoningTokens`. `total` already includes `thoughts` and `tool`, so **recompute** rather than trusting it, keeping all three harnesses identical. `--yolo` is never emitted. Role fit: the exploration/extraction harness in the MVP — cheap, fast, broad reading, read-only. Not the implementer.

---

## 10. Context packets

Two rules govern this layer:

1. **The planner's conversation is never copied into workers.** Each worker gets a compact, purpose-built packet — not a transcript.
2. **The worker gets repository context by *running in the repository*.** Every harness is a real coding agent with real filesystem tools, executing with `cwd` set to the workspace or worktree. The packet carries **pointers and facts**; the worker `Read`/`Grep`/`Glob`s for itself. Inlining source would waste tokens, go stale the moment an upstream task writes, and duplicate a capability the worker already has.

The only inlined content is what the worker cannot obtain from the filesystem: skill instructions and upstream task summaries.

```ts
ContextPacket {
  run_id, task_id
  workspace_path: string                 // the cwd the worker actually runs in
  objective: string
  acceptance_criteria: string[]
  constraints: string[]                  // permission summary in plain English
  project_instructions: string | null    // CLAUDE.md / AGENTS.md — inlined; it is
                                         // instruction, not source, and is short
  repo_facts: RepoProfile                // ~2KB of derived facts, NOT file contents
  relevant_paths: string[]               // POINTERS — non-binding; the worker may
                                         // read anything its permissions allow
  upstream: Array<{                      // one per context_from — inlined, because a
    task_id, task_name, summary,         // sibling's reasoning exists nowhere on disk
    key_findings: string[],
    artifact_paths: string[]             // ...but its artifacts are passed as paths
  }>
  skills: Array<{ id, name, instructions, resource_paths }>
  expected_output: string                // exact contract, incl. the summary block
  assignment: { harness, model, effort }
}
```

**Consequence for diffs.** A reviewer task gets the worktree path plus `patch.diff`'s path, not pasted source — keeping review packets small and, more importantly, keeping the reviewer looking at the *actual* current tree rather than a build-time snapshot.

Rendered by `context/render.ts` into one markdown string, ordered stable-first (project instructions → repo facts → skills → upstream → objective) so harness-side prompt caching can hit.

**RepoProfile** (`workspace/profile.ts`) — cheap, deterministic, no LLM: git branch/HEAD/dirty state · root file listing · languages by extension histogram · package manager · framework hints from `package.json` deps · test runner · presence of `CLAUDE.md`/`AGENTS.md`/`README.md` · directory tree to depth 2 · LOC by language. Target ≤ 2 KB.

**Worker output contract.** Every worker ends its response with a fenced block:

````
```agentplan-summary
{ "summary": "...", "key_findings": ["..."], "artifacts": ["..."],
  "status": "completed" | "blocked", "blockers": ["..."] }
```
````

Parsed by `context/summary.ts`. If missing or malformed, the harness's final message is stored as `summary` with empty `key_findings` — degraded, never fatal. Claude tasks can additionally use `--json-schema`, Codex `--output-schema`; Gemini relies on the prompted contract.

**Artifacts on disk, rows in SQLite pointing at them** — diffs and logs are large awkward blobs; SQLite holds the queryable facts and the path, which keeps aggregate queries fast and artifacts trivially inspectable during a demo.

```
~/.agentplan/runs/<runId>/
  plan.json
  planner-stdout.json
  tasks/<taskId>/
    context-packet.md  summary.json  output.md
    patch.diff         events.ndjson  stderr.log
```

---

## 11. Scheduler

`scheduler/scheduler.ts`, a ready-set loop:

1. Build adjacency + indegree from `dependencies`. Cycles already rejected at validation.
2. `ready` = `queued` tasks whose deps are all `completed`.
3. Dispatch while `running.size < concurrency_limit`.
4. **Worktree serialization:** at most one `dedicated`-worktree task per branch at a time; `none`/`shared` tasks run freely in parallel against the main repo (they cannot write).
5. On completion → persist artifacts → recompute ready set → repeat.
6. On failure → mark dependents `blocked` transitively, leave independent branches running.
7. Terminate when nothing is running and nothing is ready.

**Lifecycle:** `planned → queued → running → completed | failed | blocked | cancelled`, recorded on both `runs` and `tasks`. `planned` is the state at plan-emit time; `queued` on Start Run; `blocked` means an upstream failed (distinct from `failed`); `cancelled` is user-initiated.

Default `concurrency_limit` = 3 (planner may lower it; server clamps to a Settings max), chosen to keep three provider CLIs' rate limits and a laptop's CPU comfortable.

---

## 12. Process management

One `ProcessSupervisor` (`harness/supervisor.ts`) for all three adapters — adapters never call `spawn` directly.

- `spawn(cmd, args, { cwd, env, detached: true })` — `detached` gives a process group, so we kill children (a CLI that spawned `npm test`) rather than orphaning them.
- **stdout** through a line-delimited NDJSON transform; malformed lines logged and skipped, never fatal.
- **stderr** captured to `stderr.log`, tailed into the UI at `warn`.
- **Env hygiene:** a curated env (`PATH`, `HOME`, `TERM`, plus explicit per-harness vars). Never spread `process.env` into a spawned coding agent.
- **Timeout:** `execution.timeout_seconds` → `SIGTERM` to `-pid` → 10s grace → `SIGKILL`.
- **Cancellation:** an `AbortController` per task; a run-level controller aborts all children.
- **Backpressure:** cap in-memory events per task (ring buffer ~500) for the UI; the full stream always lands in `events.ndjson`.
- **Crash safety:** on boot, any `running` task/run in the DB is marked `failed` with `interrupted_by_restart` — no zombie state after a laptop sleep.

---

## 13. Git worktree strategy

**Worktrees are the correct MVP choice:** every harness accepts an arbitrary working directory, a worktree is a real checkout so builds and tests work unmodified, creation is fast (shared object store), and removal is one command. Cloning is slower and wastes disk; a shared tree lets two writers stomp each other; containers are out of scope.

- Read-only tasks (`filesystem ∈ {none, read}`) run in the **main repo** with the harness in read-only mode. No worktree, no branch.
- Each writing task gets a dedicated worktree:
  ```bash
  git worktree add -b agentplan/<runId>/<taskId> \
      "<repo>/.worktrees/<runId>/<taskId>" HEAD
  ```
- **Preflight:** refuse to start if `git status --porcelain` is non-empty, unless the user explicitly ticks "I know, proceed" — a blocking dialog, not a silent warning.
- **After a writing task:** `git -C <wt> add -A && git -C <wt> diff --cached > patch.diff`, optionally committing inside the worktree. **Never push, merge, rebase, or resolve conflicts.**
- **Cleanup:** worktrees are **kept** after a run (they're the deliverable). Settings has an explicit "Remove worktrees for run X" → `git worktree remove --force` + `git worktree prune`. Manual on purpose: auto-deleting a user's generated code is the kind of destructive default that ruins trust.
- `.worktrees/` is added to `.git/info/exclude` at registration, so we never dirty the user's `.gitignore`.

---

## 14. Persistence and data model

**`node:sqlite`, built into Node 25 — verified working here.** Chosen over `better-sqlite3` because it needs no native compile step; a `node-gyp` failure mid-hackathon is a real, avoidable risk. (It prints an `ExperimentalWarning`; suppress with `--no-warnings=ExperimentalWarning`. If it misbehaves, `better-sqlite3` is a near-identical synchronous drop-in.) Chosen over JSON files because the Usage dashboard is fundamentally `GROUP BY model / workspace / run`; chosen over Postgres because local-first with zero ops is a requirement.

**Four separated concerns — a hard rule:**

| Concern | Location | Contains secrets? |
|---|---|---|
| **Secrets** | OS env + the CLIs' own stores (`~/.claude`, `~/.codex/auth.json`, `~/.gemini`) | Yes — and we never read or write them |
| **App configuration** | `~/.agentplan/config.json` (0600) — workspaces, catalog overrides, EverOS URL, concurrency | No |
| **Telemetry / run history** | `~/.agentplan/agentplan.db` | **Never** |
| **Task artifacts** | `~/.agentplan/runs/<runId>/...` | Never intentionally (§16 redaction) |

Everything lives under `~/.agentplan/`, never in the user's repo. Migrations: one `schema.sql` applied idempotently at boot behind a `user_version` pragma check — no migration framework.

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
  default_branch TEXT, profile_json TEXT, created_at TEXT NOT NULL);

CREATE TABLE runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  goal TEXT NOT NULL, status TEXT NOT NULL,   -- planning|planned|running|completed|failed|cancelled
  plan_json TEXT, plan_valid INTEGER, plan_errors_json TEXT,
  budget_usd REAL,
  planner_model TEXT, planner_cost_usd REAL, planner_input_tokens INTEGER,
  planner_output_tokens INTEGER, planner_session_id TEXT,
  concurrency_limit INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);

-- Flat fact table: one row per task. Snowflake-shaped on purpose (§16).
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,                       -- <runId>:<taskId>
  run_id TEXT NOT NULL REFERENCES runs(id), task_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL, name TEXT NOT NULL, objective TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  harness TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL,
  model_rationale TEXT,
  skills_json TEXT, dependencies_json TEXT, context_from_json TEXT,
  permissions_json TEXT, execution_json TEXT,
  est_input_tokens INTEGER, est_output_tokens INTEGER, est_cost_usd REAL,
  status TEXT NOT NULL,                      -- planned|queued|running|completed|failed|blocked|cancelled
  worktree_path TEXT, branch TEXT,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,
  cost_usd REAL, cost_is_estimated INTEGER DEFAULT 1,
  latency_ms INTEGER, exit_code INTEGER, success INTEGER,
  error TEXT, summary TEXT, artifact_dir TEXT,
  started_at TEXT, completed_at TEXT,
  synced_at TEXT);                           -- reserved for a future Snowflake sync

CREATE TABLE model_catalog (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, display_name TEXT NOT NULL,
  harnesses_json TEXT NOT NULL, context_window INTEGER,
  price_input_per_mtok REAL, price_output_per_mtok REAL, price_source TEXT,
  cost_tier TEXT, speed_tier TEXT, capabilities_json TEXT,
  reliability_notes TEXT, is_local INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);

-- Discovered-skill INDEX, not skill storage. Instructions stay in their source
-- files (§8) and are read at packet-build time. Deliberately no `model` column.
CREATE TABLE skills (
  id TEXT NOT NULL, workspace_id TEXT,          -- NULL = user-level or builtin
  name TEXT NOT NULL, description TEXT NOT NULL,
  source_path TEXT NOT NULL, source_scope TEXT NOT NULL,
  content_hash TEXT NOT NULL, mtime_ms INTEGER NOT NULL,
  resource_paths_json TEXT,
  applies_to_languages_json TEXT, applies_to_roles_json TEXT,
  precedence INTEGER NOT NULL,                  -- 1 workspace-agents .. 5 builtin
  PRIMARY KEY (id, workspace_id));

CREATE TABLE memory_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL, synced_at TEXT);

CREATE INDEX idx_tasks_run   ON tasks(run_id);
CREATE INDEX idx_tasks_model ON tasks(model);
CREATE INDEX idx_tasks_ws    ON tasks(workspace_id);
CREATE INDEX idx_runs_ws     ON runs(workspace_id);
```

**No secrets column exists anywhere in this schema.** That is intentional and load-bearing.

---

## 15. Security and secrets

**The design goal is that this app holds no provider API keys at all**, and the toolchain makes that achievable: `claude`, `codex`, and `gemini` authenticate themselves from their own credential stores, and EverOS's provider keys live in EverOS's own `.env` (`EVEROS_LLM__API_KEY`, `EVEROS_EMBEDDING__API_KEY`, …), read by its server process. We only talk to `http://127.0.0.1:8000`.

1. **Bind to `127.0.0.1` only.** Never `0.0.0.0` — a local orchestrator that spawns shell-capable agents must not be reachable from the LAN. **SSE has no auth**, acceptable only because of this rule; documented as a constraint, not an oversight.
2. **CORS restricted** to the Vite dev origin; in production the SPA is served same-origin.
3. **No secret reaches the browser.** Never `localStorage`/`sessionStorage`/a cookie/a bundled JS file. Settings returns `{ configured: boolean, source: "env" | "cli-credential-store" | "missing" }` — a status, never a value. Settings is a **detection and diagnostics screen** ("Claude Code: installed 2.1.224, authenticated ✓" plus a how-to-fix link), not a key-entry form.
4. **No secret in SQLite, plans, artifacts, or logs.** If a first-party key is ever genuinely required, it goes in the server process's environment via a gitignored `.env` with its file mode checked at boot — never a DB column. (OS keychain is deliberately deferred: a native dependency and per-platform code for zero benefit while we hold nothing worth storing.)
5. **Env allow-list for children** (§12).
6. **Workspace path validation.** Registration requires an existing directory containing `.git`; the resolved realpath is stored. Reject paths escaping the registered root when constructing worktree paths.
7. **`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, and `--yolo` are never emitted.** A unit test asserts no adapter can produce those strings.
8. **Least privilege per task.** `permissions.filesystem` maps to the harness's own sandbox flag, so read-only tasks are read-only *at the harness level*, not by convention. Shell allow-lists pass through as `Bash(cmd *)` rules where supported, rather than blanket bash access.
9. **No chain-of-thought in logs** (§9 parsing notes). Logs contain operational events, tool names/results, and summaries. Reasoning **tokens** are still counted for cost — counting is not exposing.
10. **Artifact redaction pass.** Before writing `output.md`/`summary.json`, regex-scan for common key shapes (`sk-`, `ghp_`, `AKIA`, `-----BEGIN ... PRIVATE KEY-----`) → `[REDACTED]`. Cheap insurance against an agent echoing a `.env` it read.

---

## 16. Usage, cost, and the baseline claim

**Normalization.** Each adapter maps its fields into `NormalizedUsage` (§9), handling the three traps documented there: Codex cumulative usage, Gemini's inclusive `total`, and Claude's separate cache fields (kept distinct so cost math can price them differently later).

**Cost resolution, in strict priority order** (`usage/cost.ts`):

1. **Exact** — the harness returned dollars. Only Claude Code. → `cost_is_estimated = 0`.
2. **Derived** — catalog has published per-MTok prices → `input/1e6 × in + output/1e6 × out`. → `cost_is_estimated = 1`.
3. **Unknown** — no published rate → cost `null`, tokens still recorded. The UI shows "— (tokens only)", never `$0.00`. Showing zero would be a lie that flatters the savings number.

**Every dollar figure in the UI carries a provenance badge** (`exact` / `est.` / `tokens only`), enforced by one shared `<Cost>` component that cannot render a number without a provenance prop.

**Aggregations** (plain SQL over `tasks`): per run, model, harness, workspace, day; agent count; model distribution; wall-clock duration; success/failure counts. Wall-clock run duration is `max(completed_at) − min(started_at)`, which is *less* than the sum of task durations under parallelism — the dashboard shows both, labelled.

**The baseline claim, stated precisely:**

> **Baseline** — what this same run would have cost if *every LLM-driven task* had been executed by the planner-class frontier model, holding the observed token counts constant.
> **Actual** — the sum of resolved per-task costs.
> **Savings** — `(baseline − actual) / baseline`.

```
baseline_cost = Σ_tasks ( in_tokens/1e6 × frontier_in + out_tokens/1e6 × frontier_out )
actual_cost   = Σ_tasks ( resolved cost per the priority order above )
```

**Assumptions, printed in the UI next to the number:**

1. Token counts are held constant across models. A frontier model may use fewer or more tokens for the same task, so this is an approximation, not a measurement.
2. The frontier reference is `claude-opus-5` at published API rates.
3. `tokens only` tasks are priced at their catalog rate on the actual side where one exists; where none exists they are **excluded from both sides**, with the excluded count displayed. Excluding from both is what keeps the ratio honest.
4. Planning cost is included in both sides (it is real and exact, and the planner is frontier by definition), so it dilutes the savings percentage rather than inflating it — the conservative direction.

```
Baseline (all-frontier, estimated)   $1.84
Actual routed plan cost              $0.42   ($0.11 exact · $0.31 est.)
Savings                              77%
⚠ Estimated. Token counts held constant across models. 1 task excluded (no published rate).
```

The `⚠` line is not optional chrome — a judge who asks "how do you know?" should find the answer already on screen. **Anti-goal:** never compare against a fabricated "what a human would have spent" or a made-up per-task frontier token count.

**Snowflake (out of MVP).** Not implemented, not stubbed with fake calls, not claimed in the UI. What is done instead, at near-zero cost: the `tasks` table is a flat denormalized fact table matching the columns the brief listed, carrying a `synced_at` column nothing currently writes. Adding Snowflake later is `pnpm add snowflake-sdk` → `SELECT ... WHERE synced_at IS NULL` → batched `INSERT` → `UPDATE synced_at`. ~60 lines, no schema change; auth would be key-pair (`authenticator: 'SNOWFLAKE_JWT'`, `privateKeyPath`), avoiding a stored password.

---

## 17. EverMind / EverOS integration

**Verified facts** (repo `EverMind-AI/EverOS`, Apache-2.0, Python, ~11.9k stars, active): local-first, Markdown is the source of truth, SQLite + LanceDB indexes, hybrid BM25 + vector retrieval, FastAPI HTTP server.

```bash
uv pip install everos          # Python 3.12+ — machine has 3.12.3 ✓
everos init                    # writes ./.env
everos server start            # http://127.0.0.1:8000
curl http://127.0.0.1:8000/health          # → {"status":"ok"}
```

Requires an OpenRouter key (`EVEROS_LLM__API_KEY`, `EVEROS_MULTIMODAL__API_KEY`) and a DeepInfra key (`EVEROS_EMBEDDING__API_KEY`, `EVEROS_RERANK__API_KEY`), or any OpenAI-compatible endpoints via `*__BASE_URL`. **Flag this prerequisite early** — without it only `everos demo` works, not add/search.

**Endpoints used** (v2; `/api/v1` is a legacy alias):

| Endpoint | Use |
|---|---|
| `GET /health` | Availability probe at boot and before each write |
| `POST /api/v2/memory/add` | Write run outcome — `{session_id, app_id, project_id, messages[{sender_id, role, timestamp, content}]}` |
| `POST /api/v2/memory/flush` | Force extraction so memory is searchable immediately (essential for a live demo) |
| `POST /api/v2/memory/search` | Retrieve — `{query, user_id \| agent_id, app_id, project_id, top_k, method:"hybrid"}` |

**This is operational memory for the planner, not decorative chat memory.** The retrieval axes map onto our domain almost exactly: `app_id` = `"agentplan"`, `project_id` = workspace id (memory is per-repository), `agent_id` = agent role (enables role-scoped recall), `session_id` = run id, `sender_id` = `"orchestrator"`.

**Write-after-run** (`memory/write.ts`) — one message per completed task plus a run-level summary, each a factual sentence built from real telemetry:

> "On workspace `acme-api` (TypeScript, Express, Vitest), a bounded test-writing task assigned to `gpt-5.6-sol` via the Codex harness completed successfully in 94s using 41.2k tokens. A read-only repository scan assigned to `gemini-2.5-flash` was sufficient and cost an estimated $0.004. The architecture task on `claude-opus-5` produced the design that the implementation followed without rework."

**Read-before-plan** (`memory/read.ts`) — before building the planner prompt, search with a query derived from goal + repo profile, `project_id` = workspace, `top_k` = 5. Hits are injected under `## Prior execution memory`, framed as **advisory observations, not instructions** (a memory saying "use model X" must not override the catalog).

**The demo moment:** run the same goal twice on the same repo and the second plan visibly cites prior memory in `rationale_summary` — a concrete "learning that compounds" story rather than a logo on a slide.

**Graceful degradation:** if `/health` fails, reads return `[]` and writes append to `~/.agentplan/everos-outbox.ndjson` with a "Retry EverOS sync" button in Settings. **The product is fully usable with EverOS down.**

---

## 18. Frontend

Six screens, one nav rail. Dark, dense, monospace for identifiers, colour used **only** for status, legible at projector distance. Tailwind, no component library — a UI kit is a time sink at this size.

| Route | Purpose | Key elements |
|---|---|---|
| `/` **Dashboard** | Orientation | Active workspace, live run card, total spend + tokens, last 5 runs |
| `/new` **New Run** | Start work | Workspace selector, goal textarea, optional budget, dirty-tree warning, **Create Plan** |
| `/runs/:id/plan` **Plan View** | *The differentiator screen* | DAG + task cards with model/harness/skills/deps/permissions/estimate/**rationale**, plan totals, **Start Run** |
| `/runs/:id` **Execution** | Watch it work | Live agent cards, statuses, elapsed, tokens, cost, worktree path, event log |
| `/usage` **Usage** | Economics | Cost and tokens by model, runs table, duration, success/fail, **baseline vs actual** |
| `/settings` **Settings** | Configure | Workspaces, harness detection, catalog toggles, **discovered skills grouped by source scope with file paths**, EverOS status, worktree cleanup |

Components worth naming:

- **`<PlanGraph>`** — the one visual worth investing in. **Layered list-graph hybrid, not physics.** Tasks bucketed by topological depth into columns; dependency edges as SVG paths between card anchors. Deterministic, no layout library, ~150 lines. A force-directed graph is the classic hackathon time sink; explicitly avoided.
- **`<AgentCard>`** — harness badge · model chip · role · status pill · elapsed · in/out tokens · cost with provenance · worktree path · dependency chips. Identical in Plan View (planned) and Execution (live).
- **`<Cost>`** — **requires** a `provenance` prop; renders `— tokens only` for unknown. Makes honest labelling structurally unavoidable.
- **`<EventLog>`** — virtualized, filterable by level, auto-scroll with pause-on-scroll-up.
- **`<UsageBars>`** — CSS-grid horizontal bars. No charting dependency.
- **`<BaselinePanel>`** — baseline / actual / savings % + the assumptions block (§16).
- **`<HarnessStatus>`** — per-CLI installed/version/authenticated row.

---

## 19. API and event streaming

REST for commands and reads; **SSE** for live updates — unidirectional is all we need, it's plain HTTP, it auto-reconnects natively, and it survives a Vite proxy without extra config.

```
POST   /api/workspaces                 register { path } → validate git repo, profile it
GET    /api/workspaces
DELETE /api/workspaces/:id

GET    /api/harnesses                  detection + auth status
GET    /api/models                     catalog (with availability)
PATCH  /api/models/:id                 { enabled } and price overrides
GET    /api/skills

POST   /api/runs                       { workspaceId, goal, budget? } → creates run, plans async
GET    /api/runs                       list + aggregates
GET    /api/runs/:id                   run + plan + tasks + usage
POST   /api/runs/:id/start             validated plan → queued → scheduler
POST   /api/runs/:id/cancel            abort all children
GET    /api/runs/:id/events            text/event-stream  ← live
GET    /api/runs/:id/tasks/:taskId/artifact/:name   raw artifact

GET    /api/usage/summary              ?groupBy=model|harness|workspace|run|day
GET    /api/usage/baseline/:runId      baseline vs actual + assumptions

GET    /api/memory/status              EverOS health
POST   /api/memory/retry               drain the outbox
```

**Event bus:** one in-process `EventEmitter`; SSE handlers subscribe by `runId`. Messages are `{ type, runId, taskId?, seq, ts, payload }` with a monotonic `seq`, so a reconnecting client replays from `events.ndjson` via `Last-Event-ID`. Types: `run.status`, `task.status`, `task.log`, `task.tool`, `task.usage`, `task.artifact`, `plan.ready`, `plan.invalid`.

---

## 20. Error handling and cancellation

| Failure | Handling |
|---|---|
| Planner returns invalid JSON / schema mismatch | Store raw stdout; surface field-level errors; **one** automatic re-plan; then stop |
| Planner invents a model/harness/skill | Rejected at gate 2; the invalid identifier is named in the UI |
| Plan has a dependency cycle | Rejected at gate 3 with the cycle path printed |
| Plan over budget | Returned as `over_budget`; user accepts or re-plans. Never silently truncated |
| Harness missing / unauthenticated | Detected at boot; its models filtered from the catalog so the planner can't pick them |
| Worker non-zero exit | Task `failed`; stderr captured; dependents → `blocked`; independent branches continue |
| Worker timeout | SIGTERM to the group → 10s → SIGKILL; task `failed` with `timeout` |
| Worker emits no summary block | Fall back to the final assistant message; `key_findings: []` |
| Dirty working tree at run start | Blocking dialog; explicit user override required |
| Worktree create fails (branch exists) | Suffix the branch name; retry once; then fail the task with a clear message |
| EverOS unreachable | Reads → `[]`; writes → outbox; banner in Settings. Run unaffected |
| SSE client disconnects | Server keeps running; client replays from `Last-Event-ID` |
| Server restart mid-run | Boot marks orphaned `running` rows `failed` (`interrupted_by_restart`); worktrees preserved |
| User cancels | Run-level `AbortController` → SIGTERM to every group → tasks `cancelled` → worktrees preserved |

**Principle:** a failure degrades to a clear message plus preserved artifacts. Nothing is auto-deleted, auto-merged, or auto-retried more than once.

---

## 21. MVP scope

1. Register/select a local git workspace.
2. Detect installed + authenticated harnesses; seed the catalog; **discover skills** from workspace and user directories with built-ins as fallback.
3. Enter an engineering goal (+ optional budget).
4. Planner inspects the real repo read-only and **jointly decides decomposition and per-task model/harness assignment** in one pass.
5. Plan validated against schema, catalog, skill registry, graph, permissions, budget — then frozen as an immutable `plan.json`.
6. Plan View shows every agent with model, harness, skills, deps, permissions, estimate, and rationale — **before execution**.
7. Execute 3–4 tasks across **at least two** harness/model configurations, in parallel where the DAG allows.
8. Stream status, tool events, tokens, and cost live over SSE.
9. Writing tasks run in dedicated worktrees; a diff artifact is produced.
10. Persist runs/plans/tasks/usage to SQLite; history survives a restart.
11. Write execution memory to EverOS; retrieve it on the next plan for the same repo.
12. Usage screen: cost/tokens by model, run history, baseline vs actual with assumptions.

**Everything above is real** — real CLIs, real tokens, real DAG execution, real worktrees, real arithmetic. The only qualifications: Codex/Gemini **cost** is estimated from a curated catalog and labelled in the UI; capability tags are **curated by us**, presented as our tags not benchmarks; Snowflake is **not built** (schema sync-ready); escalation/replanning is a **schema field only**. Nothing is fake-but-presented-as-real.

**Explicit non-goals:** hosted/multi-user SaaS, auth, RBAC · a model-routing gateway · reimplementing any agent's inner loop · automatic merge/rebase/conflict resolution · runtime replanning or escalation · container/VM sandboxing beyond each harness's own flags · benchmark scores for models · **skills carrying a model or harness** (structurally prohibited, §8) · **an app-owned skill format** (we read `.agents/skills/` and `.claude/skills/` as they are) · **native subagents as the execution unit** (§9) · mutating a plan after validation · chain-of-thought display · presenting estimated cost as exact · Snowflake (per user decision) · Windows (macOS/Linux; POSIX process groups assumed).

---

## 22. Implementation phases

Each phase ends in something runnable. Build strictly in order — this order *is* the priority order, and phases 0–8 constitute a complete, honest, demoable submission (~14.5 h cumulative). Per-phase tests are summarized here; the full testing rules are §23.

**Step 0 — Live smoke test first *(30 min)*.** Confirm all three CLIs' real output shapes and capture fixtures **before writing any parser** (see Verification). Everything downstream is built on these schemas.

| Phase | Time | Files | Done when |
|---|---|---|---|
| **0 · Scaffold** | 45 min | `package.json` (pnpm workspaces) · `pnpm-workspace.yaml` · `tsconfig.base.json` · `.gitignore` · `packages/core/` · `server/` · `web/` (Vite React TS) · `vitest.config.ts` | `pnpm dev` serves `:8787` + `:5173` with the proxy working; `GET /api/health` returns 200 |
| **1 · Persistence + workspaces** | 1 h | `db/{schema.sql,index.ts}` · `workspace/{register,profile,git}.ts` · `http/workspaces.ts` · `pages/Settings.tsx` | A repo is registered and its profile renders. *Tests:* schema idempotent; profiling yields correct language/PM/framework; non-git path rejected |
| **2 · Catalog + skills + detection** | 1.5 h | `catalog/{seed,index}.ts` · `skills/{discover,normalize,registry,resolve}.ts` + `builtin/*.md` · `harness/detect.ts` · `http/{models,skills,harnesses}.ts` · `HarnessStatus.tsx` | Settings lists discovered skills grouped by scope with source paths, and this machine's `~/.claude/skills/*` appear without being copied anywhere |
| **3 · Plan schema + planner** *(the core)* | 2 h | `packages/core/src/plan.ts` · `planner/{prompt,run,validate}.ts` · `http/runs.ts` · `pages/NewRun.tsx` | A real goal against a real repo returns a schema-valid plan plus its exact planner cost |
| **4 · Plan View** | 1.5 h | `pages/PlanView.tsx` · `components/{PlanGraph,AgentCard,Cost}.tsx` | The DAG renders model, harness, skills, deps, permissions, estimate, and rationale per task, plus totals and **Start Run** |
| **5 · Adapters + supervisor** | 2.5 h | `harness/{types,supervisor,claude,codex,gemini,index}.ts` · `usage/normalize.ts` | Each adapter runs a trivial read-only task in a scratch repo and reports correct tokens |
| **6 · Worktrees + context packets** | 1.5 h | `workspace/worktree.ts` · `context/{build,render,summary}.ts` · artifact endpoint | A writing task produces `patch.diff` in an isolated worktree and a downstream task receives its summary |
| **7 · Scheduler + SSE** | 2 h | `scheduler/scheduler.ts` · `bus/index.ts` · `http/events.ts` · `pages/Execution.tsx` · `hooks/useRunEvents.ts` | A 4-task plan executes with visible parallelism and live updates |
| **8 · Usage + baseline** | 1.5 h | `usage/{cost,aggregate,baseline}.ts` · `http/usage.ts` · `pages/Usage.tsx` · `components/{UsageBars,BaselinePanel}.tsx` | Usage shows cost/tokens by model and baseline vs actual with the assumptions block. Track 1 requires this |

**Should have — materially better submission:**

9. **EverOS memory** *(1.5 h)* — `memory/{client,write,read,outbox}.ts` · `http/memory.ts` · Settings panel. Done when a second run on the same repo cites prior memory in `rationale_summary`. The sponsor requirement and the strongest narrative beat — promote above Phase 8 if EverOS keys are confirmed working early.
10. **Third harness adapter** (Gemini) *(45 min)* — the plan visibly spans three providers.
11. **`<PlanGraph>` upgrade** from list to layered DAG with edges *(45 min)*.
12. **Dashboard + run history** *(45 min)*.
13. **Cancellation + restart recovery** *(45 min)*.
14. **Demo polish** *(1 h)* — seed script for a demo repo, empty/error states, README with the demo script, `demo:reset`.

**Cut if time is short, in this order:** Dashboard (Usage covers it) → DAG edges (an indented dependency-grouped list reads fine at distance) → third harness (two already prove heterogeneous assignment) → catalog editing UI (seed-only) → in-app artifact viewer (open files in an editor) → outbox retry UI (log-only) → redaction pass (keep the demo repo secret-free) → restart recovery (don't kill the server during the demo) → escalation/replanning/plan diffing/merge assistance (already non-goals).

**The one-line fallback if everything slips:** an immutable `plan.json` that visibly assigns **different models on different harnesses** to different work units — each with selected skills and a written rationale — then executes across at least two harnesses as separate processes, with a per-model cost breakdown. Ship that and cut everything else.

**Dependencies.** Server: `hono`, `@hono/node-server`, `zod`, `zod-to-json-schema`, `nanoid`. Web: `react`, `react-dom`, `react-router-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`. Dev: `typescript`, `tsx`, `vitest`, `@types/node`. **~13 direct deps, small on purpose.** Deliberately *not* added: a SQLite driver (`node:sqlite` is built in), a charting library, a graph-layout library, a state manager (SSE + `useState` suffices), a component library, `snowflake-sdk`, `@anthropic-ai/claude-agent-sdk` (the CLI is the interface and gives us `total_cost_usd` free).

---

## 23. Testing strategy

**Vitest**, unit-first. The rule: *anything that spends money is behind a fixture.* No E2E browser tests — wrong cost/benefit at this timescale.

- **Schema/validation (highest value)** — cycles, unknown ids, permission/worktree contradictions, `context_from ⊄ dependencies`, budget overrun. Checked-in fixture plans, zero API calls.
- **Plan immutability boundary** — the `ExecutionPlan` schema contains **no** runtime key (`status`, `started_at`, `completed_at`, `cost_usd`, `input_tokens`, `worktree_path`, `exit_code`); a written `plan.json` is mode `0444`; a re-plan creates a new run rather than mutating the file.
- **Skill registry** — precedence across all five locations; a workspace skill shadows a same-id built-in; malformed front-matter skipped not thrown; **`model:` in a skill file is rejected**; `Skill` has no `model`/`harness` key; an mtime/hash change forces a re-read; instruction text resolves from the source path, not the DB.
- **Worker/subagent boundary** — no adapter passes `--agents`; the Agent tool never appears in a worker's `--allowedTools`.
- **Adapter parsers** — checked-in stdout fixtures per harness → expected `NormalizedUsage`. Catches the Codex-cumulative and Gemini-`total` traps that would otherwise silently corrupt every cost number.
- **Cost + baseline** — exact/derived/unknown resolution; excluded tasks removed from both sides; aggregates match row sums.
- **Scheduler** — fixture DAG: ready-set order, concurrency cap, failure→`blocked` propagation, cancellation.
- **Git/worktree** — against a `mkdtemp` repo: create, diff, dirty detection, remove.
- **Security guardrail** — no adapter's argv can contain `--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, or `--yolo`.
- **EverOS client** — against a stubbed HTTP server; assert graceful degradation.
- **One live smoke test**, `pnpm test:live`, excluded from the default run: a trivial read-only task per harness asserting exit 0 and non-zero tokens.

Fixtures: `server/test/fixtures/{claude-stream.ndjson, codex-events.jsonl, gemini-output.json, plan-valid.json, plan-cycle.json, plan-unknown-model.json}`.

---

## 24. Risks and unknowns

| Risk | Severity | Mitigation |
|---|---|---|
| **Harness output schemas differ from docs on the installed versions** | **High** | Run the live smoke on day 1 and capture real fixtures *before* writing parsers. The single highest-value first action |
| EverOS needs OpenRouter + DeepInfra keys | **Med-High** | **Verify day 1.** Outbox + degradation means the demo survives without it, but the EverMind story doesn't |
| Codex/Gemini token fields shift between versions | Med | Defensive parsers: missing field → 0 + a warn log, never a crash |
| Subscription auth means no true marginal cost | Med | Labelled everywhere (§16). Turned into a credibility asset by being explicit |
| Planner emits a plausible but unexecutable plan | Med | Five validation gates + one bounded re-plan |
| Planner is slow (frontier + repo reads) | Med | `--effort high` not `max`; `--max-budget-usd`; UI streams "planning…" with elapsed time |
| DAG visualization eats the schedule | Med | Layered columns, not force-directed; timeboxed to Phase 4; a plain list is the acceptable fallback |
| Snowflake absence costs judging points | Med | User's call. Mitigated by a sync-ready schema (§16) and an honest "here's the 60-line addition" answer |
| Parallel CLIs hit provider rate limits | Low-Med | Default concurrency 3; per-task failures don't kill the run |
| `node:sqlite` is flagged experimental | Low | Verified on Node 25.1.0; `better-sqlite3` is a same-API fallback |
| Worktree churn / branch-name collisions | Low | Run-scoped branch names; suffix-and-retry once |
| Two agents write the same files | Low | Planner instructed toward disjoint file sets; worktrees make collisions non-destructive; no auto-merge |

**Open unknowns to resolve on day 1:** exact `structured_output` placement in the `claude -p --json-schema --output-format json` payload; whether `gemini --output-format json` includes `stats` on every run or only with tool use; whether Codex `--output-schema` beats the prompted summary contract for implementer tasks.

---

## 25. Demo flow

*Target: 4 minutes.*

1. **Settings (25s)** — three harnesses detected and authenticated: *"everything runs locally; the app never holds a provider key."* Scroll to Skills, shown with real source paths: *"we didn't invent a skill format — we read the ones you already have. And none of them names a model: a skill is knowledge; the planner decides who applies it."*
2. **New Run (20s)** — a prepared TypeScript repo. Goal: *"Find and fix the race condition in quote submission, and add a regression test."* **Create Plan**.
3. **Plan View (75s) — the centrepiece.** The DAG appears *before anything executes*. Walk one card: Explorer on Gemini Flash, read-only, `repo-exploration` — *"cheap model, this is scanning."* Then Architect on Claude Opus 5 — *"expensive model, high-leverage reasoning."* Then Implementer on Codex `gpt-5.6-sol` in a dedicated worktree. Then Reviewer on Claude Sonnet 5 with the diff. **Read one `model_rationale` aloud.** *"This isn't a router picking a model per prompt — the planner allocated a team, and decided the split and the staffing in the same breath."* Open `~/.agentplan/runs/<id>/plan.json` in a terminal: *"this file is the product. It's frozen — which is exactly why we can later ask whether the allocation was any good."*
4. **Execution (60s)** — Start Run. Two agents go green in parallel; tokens and cost tick live. Point at the worktree path: *"the implementer is writing in an isolated git worktree; nothing else can stomp it."*
5. **Result (20s)** — open `patch.diff` and the reviewer's summary.
6. **Usage (40s)** — four models on one goal. Baseline $1.84 → actual $0.42, 77% saved. **Point at the assumptions line:** *"estimated, token counts held constant, one task excluded — we're not going to hand-wave the number."*
7. **Memory (30s)** — re-run the same goal; the new plan's rationale cites prior EverOS memory. Open `~/.everos` and show the Markdown file: *"the memory is a file you own, not a vendor's database."*

---

## 26. Verification

**Static:** `pnpm -r typecheck` · `pnpm -r test` (all fixture-driven, no spend).

**Live smoke — run this FIRST, before building parsers:**
```bash
claude -p "Reply with the single word OK" --output-format json --allowedTools "" | jq '{result,total_cost_usd,usage,session_id}'
codex exec "Reply with the single word OK" --json --sandbox read-only --skip-git-repo-check | tail -5
gemini "Reply with the single word OK" --output-format json | jq '.stats'
everos server start &   # then, in a second terminal:
curl -s http://127.0.0.1:8000/health
```
Capture each into `server/test/fixtures/` and build the parsers against reality.

**End-to-end:**
1. `pnpm dev` → `http://localhost:5173`.
2. Settings: all three harnesses green; EverOS reachable.
3. Register a small TypeScript repo with a known bug.
4. New Run → goal → **Create Plan**; confirm ≥3 tasks, ≥2 distinct harnesses, a `model_rationale` on every task.
5. Plan View: DAG, dependencies, permissions, estimates all render.
6. **Start Run**; confirm real parallelism, live token/cost ticks, a worktree at `<repo>/.worktrees/<runId>/<taskId>`.
7. Inspect `patch.diff` and `summary.json` under `~/.agentplan/runs/<runId>/tasks/<taskId>/`.
8. Usage: per-model cost, provenance badges, baseline vs actual with assumptions.
9. **Cancel test:** cancel mid-flight; confirm no orphaned processes (`pgrep -f codex`) and surviving worktrees.
10. **Restart test:** kill the server mid-run, restart; confirm `failed (interrupted_by_restart)` and intact history.
11. **Memory test:** re-run the same goal; confirm the new plan cites prior memory and `~/.everos` contains the Markdown.

---

## 27. Post-hackathon extensions

1. **Snowflake telemetry sync** — the `synced_at` outbox drain (§16). First on the list.
2. **Runtime escalation** — execute the `escalation` field: on failure retry on a stronger model, recording the delta as catalog evidence.
3. **Learned routing priors** — use accumulated EverOS memory to propose catalog tag adjustments per repo/task shape.
4. **Real A/B cost evidence** — run the same goal under the routed plan and an all-frontier plan, replacing the held-constant-tokens assumption.
5. **Merge assistance** — sequential worktree integration with conflict *detection* (never auto-resolution).
6. **More harnesses** — `opencode` is already installed here; the adapter interface takes it without redesign.
7. **Local models** — the catalog already has a `local` flag; an Ollama harness fits the same interface.
8. **Prompt-cache-aware planning** — order packets so sibling tasks share a cacheable prefix.
9. **Plan diffing** — show what changed between re-plans of the same goal.
10. **OS keychain** — for the day a first-party API key is genuinely required.

---

## 28. TUI rules

**Supersedes §18 (Frontend) and §19 (API and event streaming).** There is no web UI, no HTTP
API, and no SSE bus. Decision taken during plan review; the rest of this section is binding.

### 28.1 Stack

**Ink (React for the terminal) on Node 22, single process, pnpm.**

Chosen because the DAG is the centrepiece and Ink lets each node be a React component with
the same mental model as the original Vite plan — no new paradigm, no renderer to hand-roll.
Rejected: Textual (Python — wrong runtime for the Node adapters), Bubbletea (no Go toolchain
installed), raw ANSI (the DAG is too much layout to hand-roll under time pressure).

```
apps/cli
├─ tui/          Ink components (Plan, Run, Usage views)
├─ core/         scheduler, adapters, catalog, validation
└─ store/        SQLite (node:sqlite), plan.json writer
```

### 28.2 The architecture consequence — this is the point

The TUI **is** the supervisor process. Scheduler, harness adapters, and renderer share one
Node process and one `EventEmitter`. Deleting the browser deletes the entire transport tier:

| Dropped | Reason |
| --- | --- |
| HTTP API layer | Nothing crosses a process boundary |
| SSE bus + reconnect logic | In-memory events |
| CORS, ports, two-app dev | Single `pnpm dev` |
| Client-side state sync | Renderer reads supervisor state directly |

Roughly 2h recovered. That is what pays for the DAG renderer.

### 28.3 Harness ↔ tier mapping (forced by measurement, not preference)

Verified on this machine: Claude Code's system prompt + tool schemas is **~270,000 characters
(~67k tokens)**. The local model's context window is **32,768**. Claude Code therefore
*cannot* drive the local model — the harness prompt alone is ~2× the window before any work.
Confirmed by a live run that failed at 173s with `maximum context length is 32768 tokens`.

| Tier | Harness | Backend | Notes |
| --- | --- | --- | --- |
| Frontier | `claude -p` | Anthropic | Emits `total_cost_usd` — real measured figure |
| Mid | `codex exec` | OpenAI (`~/.codex/auth.json` present) | Own parser |
| Local | `opencode run` | vLLM Qwen3-4B-AWQ @ `:8000` | Already configured and working; the only harness whose prompt fits 32k |

vLLM serves the **Anthropic Messages API** natively (`/v1/messages`, verified: correct
envelope, `stop_reason: tool_use`, real `usage` block) — so the `ANTHROPIC_BASE_URL` swap
works in principle; it is the *context window*, not the protocol, that rules Claude Code out
of the local tier.

### 28.4 Views

Three, switched with number keys. Each maps to a demo beat.

| Key | View | Beat |
| --- | --- | --- |
| `1` | **PLAN** — the frozen DAG, pre-execution | The centrepiece |
| `2` | **RUN** — live execution | Proves it runs |
| `3` | **USAGE** — cost by model, baseline vs actual | The track |

`p` create plan · `s` start run · `x` cancel · `q` quit · `↑/↓` select node · `enter` expand
rationale.

### 28.5 DAG render rules

- **Layered columns, never force-directed.** Column index = dependency depth. Tasks at the
  same depth stack vertically. Deterministic, no layout solver, no animation.
- **Fixed node width (28 cols).** Truncate with `…`; never reflow on state change — a node
  must not move once drawn, or the eye loses it mid-demo.
- **Edges are box-drawing only** (`│ ├ └ ─`). No unicode arrows, no braille, no emoji.
- **Every node shows four lines**: task id · model · harness · status+cost. Model and harness
  are always both visible — that pairing *is* the pitch.
- **Degrade, don't crash**: terminal under 100 cols falls back to an indented list with the
  same four fields. Detect once at mount, don't re-layout on resize mid-run.

```
┌─ PLAN a3f ─────────────────────────────────────────────────┐
│                                                            │
│  ┌──────────────────────────┐                              │
│  │ explore                  │                              │
│  │ qwen3-4b-awq             │──┐                           │
│  │ opencode → vllm          │  │  ┌──────────────────────┐ │
│  │ ● done          $0.0000  │  ├─▶│ architect            │ │
│  └──────────────────────────┘  │  │ claude-opus-5        │ │
│  ┌──────────────────────────┐  │  │ claude               │ │
│  │ scan-tests               │──┘  │ ◐ running    $0.0412 │ │
│  │ qwen3-4b-awq             │     └──────────────────────┘ │
│  │ opencode → vllm          │                              │
│  │ ● done          $0.0000  │                              │
│  └──────────────────────────┘                              │
└────────────────────────────────────────────────────────────┘
  routed $0.041   baseline $0.184   ▼ 78%      ●● 1 running
```

### 28.6 Status vocabulary

One glyph, one colour, no ambiguity. **16-colour ANSI only** — 256-colour and dim/faint
render unpredictably on a projector.

| Glyph | Colour | State |
| --- | --- | --- |
| `○` | grey | queued |
| `◐` | yellow | running (spinner cycles `◐◓◑◒`, 200ms) |
| `●` | green | done |
| `✗` | red | failed |
| `⊘` | grey | skipped (upstream failed) |

Never encode meaning in colour alone — the glyph carries it too.

### 28.7 Redraw discipline

- **Throttle renders to 10fps.** Adapter events arrive in bursts; unthrottled Ink redraws
  flicker badly on a projector.
- **Cost tickers animate, layout does not.** Numbers update in place; node positions are
  frozen at plan time.
- **Never clear the screen on state change.** Full clears read as a crash to an audience.
- Log lines go to a file, not the TUI. Stray adapter stdout must not corrupt the frame —
  capture child stdio, never inherit.

### 28.8 Legibility (projector)

Non-negotiable, and cheap:

- Rehearse at **large terminal font** (≈22pt+), and size the layout for **100×30** — not for
  your 4K display. Test by shrinking the window before demo day.
- High-contrast light-on-dark. No dim, no italics, no background colours behind text.
- The savings figure renders in a **bordered box, on its own line**, never inline in prose.

### 28.9 Out of scope

Mouse support · scrollback · resize reflow mid-run · theming · a settings *editor* (roster is
read from a seeded config file; §21 cut the settings tour from the demo) · log viewer ·
diff viewer.
