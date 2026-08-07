# Local-First Coding-Agent Orchestration Harness — Implementation Plan

*Snowflake × Beta Fund × EverMind Agent & Token Economy Hackathon.*
*Research and plan only — no application code has been written.*

---

## Context

**Why this exists.** The hackathon brief asks for a local-first harness where *one strong planner decomposes an engineering goal into subagents, and assigns each subagent its own model, harness, skills, tools, context, permissions, workspace, and budget — before any execution begins.* The thing being built is a **planner that allocates resources**, not a gateway that picks a model per prompt.

**What prompted it.** `/Users/ivansandroid/Desktop/Snowflake-Agent-Token-Hackathon` is an empty `git init` — no commits, no files, no `package.json`. Every architectural decision below is therefore a greenfield choice justified against the local toolchain that *is* present, not against existing code.

**Intended outcome.** A locally-runnable app that: registers a git workspace → takes a goal → produces a validated task DAG with per-task model/harness assignments → executes 2–4 of those tasks across at least two different harnesses → streams status to a dashboard → records token/cost telemetry → writes execution memory to EverOS → shows actual vs. baseline cost.

**Two scope decisions confirmed with the user:**
1. Stack: Node API + Vite React SPA, pnpm workspaces.
2. Planner: `claude -p --output-format json --json-schema`.
3. **Snowflake is out of the MVP** — EverOS is the only sponsor integration. One concern, stated once and then dropped: this is a Snowflake-hosted hackathon and Track 1 is cost-reduction, so an empty Snowflake story may cost judging points. The mitigation baked into this plan is that the telemetry table is designed as a **flat, Snowflake-shaped fact table with an outbox column**, so `pnpm sync:snowflake` is a ~60-line file to add later, not a refactor. Beyond that, proceeding as directed.

---

## 1. Executive summary

Build **one local Node process** that owns a SQLite database, a child-process registry, and an SSE event bus, plus a small Vite React dashboard. The user registers a local git repo, types an engineering goal, and clicks **Create Plan**.

Planning runs as a **read-only Claude Code session** (`claude -p --json-schema`, tools limited to `Read,Grep,Glob`). It sees the real repository, the model catalog, the **skills discovered on this machine and in this workspace**, and prior EverOS memories. In **one pass** it decides both how to decompose the work and who executes each piece, and returns a JSON-Schema-validated **`plan.json`**: a DAG of tasks, each with an explicitly assigned model + harness + skills + permissions + worktree policy + cost estimate + a written rationale for *why that model class*.

**`plan.json` is the central product artifact** (§8), not a transient LLM response. Once validated it is frozen: the scheduler, the UI, the cost model, and the memory writer all read it, and no runtime state is ever written back into it. Claude Code is how the plan is *produced*; the plan is what the system *is*.

Validation runs server-side against the registered catalog and skill registry, so a model, harness, or skill the planner invented is rejected before anything executes. The UI renders the DAG for inspection. On **Start Run**, a dependency-aware scheduler executes ready tasks in parallel — **each as its own OS process** driven by a harness adapter (`ClaudeCodeAdapter` → `claude -p`, `CodexAdapter` → `codex exec`, `GeminiAdapter` → `gemini`), running in either the main repo (read-only tasks) or a dedicated `git worktree` (writing tasks). These are peer processes under our supervisor, **not** Claude Code native subagents (§11). Events, tokens, and cost stream back live.

Afterwards the run is written to EverOS as durable operational memory (which model/harness succeeded at which kind of task on which repo), and the dashboard shows **actual routed cost vs. an all-frontier baseline**, with every estimated figure explicitly labelled as estimated.

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

---

## 3. What this is NOT

- **Not OpenRouter / not an inference gateway.** There is no "send prompt, get model" path. Model choice is a *field on a planned task*, decided once during planning.
- **Not a per-prompt router.** No runtime classifier picks a model per message. Decomposition and model/harness assignment are decided **jointly, by the planner, before execution**.
- **Not a rebuild of Claude Code / Codex / Gemini CLI.** Those are treated as opaque harnesses driven over stdin/stdout.
- **Not Claude Code native subagents.** A worker is *not* a Claude Code `Agent` invocation. There is no `Agent(model="codex")` anywhere in this system — that construct does not exist. A Codex-assigned task is executed by `CodexAdapter` spawning `codex exec`; a Gemini-assigned task by `GeminiAdapter` spawning `gemini`. Claude Code's own `--agents` / Agent tool is **not used** for cross-harness work. See §11.
- **Not a Claude-only system.** The planner happens to run on Claude Code because it is the best available read-only, repo-aware, schema-validated planning surface on this machine. Workers can be **any model on any harness in the catalog**, and the architecture assumes they usually aren't Claude.
- **Not a hosted SaaS.** No auth, no tenancy, no cloud database.
- **Not an autonomous merge bot.** It never merges, rebases, or resolves conflicts automatically.
- **Not a chain-of-thought viewer.** Reasoning blocks are filtered out of logs by design.

---

## 4. Core differentiator

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
        ├── Task A · goal · Gemini Flash  · read-only · skills[repo-exploration]
        ├── Task B · goal · Claude Opus 5 · read-only · depends A · skills[architecture]
        ├── Task C · goal · Codex gpt-5.6 · worktree  · depends B · skills[ts-coding]
        └── Task D · goal · Claude Sonnet 5 · read-only · depends C · skills[review]
        │
        ▼
   execution engine (dependency-ready → parallel → isolated)
```

The planner answers **what work exists, who does it, what they need, and which engine runs it** — as one allocation decision, before execution.

---

## 5. Current repository assessment

The repo is **empty**: `git init` on `main`, **zero commits**, no tracked or untracked files, no remote.

| Research question | Finding |
|---|---|
| Existing stack/framework | **None.** Greenfield. |
| Existing backend | **None.** |
| Existing persistence | **None.** SQLite is therefore a free choice, not a migration. |
| Frontend/backend comms | **None.** |
| Monorepo | **No** — but pnpm workspaces is the right shape for `server` + `web` + shared schemas. |
| Package manager | Repo says nothing. Machine has **pnpm 10.27.0** (preferred), npm 11.6.2, bun 1.3.5. |
| Testing framework | **None.** Recommend **Vitest** (one runner for server + shared package). |
| Env var management | **None.** No `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SNOWFLAKE_*`, or `EVERMIND_API_KEY` is set in the environment. |
| Claude/Codex/Gemini integrations present | No code — but **all three CLIs are installed and already authenticated** (see below). |
| Git/worktree handling present | **None.** |

**Verified local toolchain:**

| Tool | Version | Path | Auth state |
|---|---|---|---|
| `claude` | 2.1.224 | `~/.local/bin/claude` | Subscription/OAuth (no `ANTHROPIC_API_KEY`) |
| `codex` | 0.146.0 | `/opt/homebrew/bin/codex` | ChatGPT OAuth tokens in `~/.codex/auth.json`; `OPENAI_API_KEY` is `null` |
| `gemini` | 0.22.5 | `~/.bun/bin/gemini` | `~/.gemini` exists; no API key env var |
| `node` | v25.1.0 | — | `node:sqlite` **verified working** (`DatabaseSync`, `StatementSync`) |
| `pnpm` | 10.27.0 | — | — |
| `python3` / `uv` | 3.12.3 / 0.9.17 | — | Meets EverOS's Python 3.12+ requirement |

**Two consequences that shape the whole design:**

1. **All three harnesses authenticate themselves.** The app spawns already-logged-in CLIs and never handles a provider API key for execution. This is the single biggest secret-management win available and the plan leans on it hard (§20).
2. **Codex and Gemini are on subscription/OAuth auth, so there is no true marginal dollar cost for their tokens.** Only Claude Code returns real dollars (`total_cost_usd`). Every non-Claude cost figure in this product is therefore an **estimated equivalent API cost** and must be labelled as such (§21, §22). Not negotiable — fabricated savings would sink a Track 1 submission on inspection.

---

## 6. Proposed system architecture

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

Everything runs on localhost. There is no network dependency other than the CLIs' own provider calls and the local EverOS server.

---

## 7. Planning / orchestrator architecture

The planner is a **read-only Claude Code session**. This is the key architectural choice and it buys four things at once:

1. **Real repo awareness** — it uses `Read`/`Grep`/`Glob` to inspect the actual code, so task decomposition is grounded rather than generic.
2. **Schema-validated output** — `--json-schema` puts the `ExecutionPlan` schema into the request; the response carries `structured_output`.
3. **Exact planning cost** — the `json` result payload includes `total_cost_usd` plus a per-model breakdown. Planning cost is *measured*, not estimated.
4. **Zero key handling** — it reuses the existing Claude Code login.

**Exact invocation:**

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

Run with `cwd` set to the workspace. `--permission-mode dontAsk` plus a read-only tool list means the planner physically cannot write. `--max-budget-usd` is a hard stop so a runaway planner cannot burn the demo budget.

**What the planner receives** (assembled by `planner/prompt.ts`):

- The user's goal, verbatim.
- A **repository profile** (§15) — compact facts, not file dumps.
- **Project instructions** — `CLAUDE.md` / `AGENTS.md` / `README.md` excerpts if present.
- The **skill registry** — `id`, `name`, `description`, applicable languages/roles for every skill **discovered in this workspace and on this machine** (§10). Descriptions only, never full instruction text.
- The **harness registry** — which CLIs are installed *and* authenticated right now.
- The **model catalog** — only rows with `enabled = 1` and an available harness.
- **Constraints** — max total estimated cost, max parallelism, whether writes are permitted at all.
- **Prior memory** — top-k EverOS hits for this repo profile (§23).

**Decomposition and assignment are one decision, not two.** The planner is explicitly instructed to choose *how to split the work* and *who executes each piece* together, because the two constrain each other — a task is only worth splitting out if it can be handed to a cheaper or more suitable engine, and a model is only assignable once the work unit is bounded. There is deliberately **no** second-stage "now pick models for these tasks" pass, and no runtime router. The output of this single call is the frozen allocation.

**Hard rules in the planner system prompt:**

- Emit only `model_id` / `harness_id` / `skill_id` values present in the supplied registries. Inventing one fails validation and the plan is rejected.
- `model` and `harness` are chosen **per task**. Do not apply one model to the whole plan, and do not infer a model from a task's skills — skills carry no model.
- Every task must carry `model_rationale` explaining *why this class of model* for *this work*. This is the artifact that proves the product is allocation, not routing.
- Prefer the cheapest model that can do the work; reserve frontier models for high-leverage reasoning.
- Do not implement anything. Emit a plan.
- Read-only tasks share the main repo. Any task that writes gets `worktree.mode = "dedicated"`.

**Post-generation validation pipeline** (`planner/validate.ts`) — five gates, all before anything executes:

1. **Schema** — Zod parse of `structured_output`.
2. **Registry** — every `model_id`/`harness_id`/`skill_id` exists and is enabled; the model is actually supported by the assigned harness.
3. **Graph** — every dependency id resolves; no cycles (Kahn's algorithm); `context_from ⊆ dependencies`.
4. **Permissions** — no task claims `write` while `worktree.mode = "none"`; no task claims `shell` without a declared allow-list.
5. **Budget** — Σ `estimated_cost_usd` ≤ the run budget, else the plan is returned to the UI flagged `over_budget` for the user to accept or re-plan.

Failures are surfaced in the UI with the offending field. One automatic re-plan is attempted with the validation errors appended to the prompt; a second failure is reported, not retried.

---

## 8. Structured execution-plan schema — `plan.json` is the product

**`plan.json` is the central artifact of this system, not a byproduct of an LLM call.** It is not "the planner's response"; it is a persisted, versioned, schema-validated allocation decision that everything downstream reads. The Claude Code planning call is merely how the first draft is *produced* — once validated, the plan stands on its own and is the thing the scheduler, the UI, the cost model, and the memory writer all consume. If the planner were swapped for a different engine tomorrow, `plan.json` would be unchanged in shape and everything downstream would keep working.

**Immutability contract:**

- After validation passes, `plan.json` is written to `~/.agentplan/runs/<runId>/plan.json` and **never mutated again**. Written with mode `0444`; the DB copy in `runs.plan_json` is likewise write-once.
- A re-plan does **not** edit a plan — it creates a **new run** with a new `plan.json`, so both remain inspectable and diffable (§40.9).
- **No runtime field may ever appear in the plan schema.** `status`, `started_at`, `completed_at`, actual model used, actual tokens, actual duration, actual cost, exit code, worktree path, artifact paths — all live on the `tasks` runtime record (§28). A Zod `.strict()` parse plus a unit test asserting the plan schema contains none of those key names enforces this, so the boundary can't erode through casual edits.

Why this matters: actual-vs-planned comparison, baseline-vs-actual cost (§22), and the "did the planner allocate well?" question are all only answerable if the allocation decision is frozen and separable from what actually happened.

Defined once in `packages/core/src/plan.ts` as Zod, with `zod-to-json-schema` producing the `--json-schema` payload. Single source of truth for the planner, the server, and the UI.

Improvements over the schema sketched in the brief are marked **[+]**.

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

  skills: SkillId[]                      // 0..n — multi-select. Resolved against the
                                         // SkillRegistry (§10). A skill NEVER carries
                                         // a model; model is assigned here, on the task.
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
    worktree: { mode: "none" | "shared" | "dedicated",
                branch_hint?: string }
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

Note what is **absent** by design: no `status`, no timestamps, no actual usage, no worktree path. Those belong to the runtime record per the immutability contract above. The plan is the allocation decision; the `tasks` row is the execution record.

---

## 9. Model catalog design

A **seeded, editable table** — not a hardcoded map, not a scraped API. Capability is expressed as **tags and coarse tiers we chose**, never as invented numeric scores.

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

**Seed rows.** Anthropic prices are published per-MTok. Codex/Gemini prices are marked `subscription-no-marginal-cost` because the local auth is OAuth/subscription — the UI shows *equivalent* cost from the published API rate where one exists, always labelled.

| id | provider | harnesses | in/out $/MTok | tier | capabilities |
|---|---|---|---|---|---|
| `claude-opus-5` | anthropic | claude-code | 5 / 25 | premium | architecture, review, long-context, structured-output |
| `claude-sonnet-5` | anthropic | claude-code | 3 / 15 | high | coding, review, tool-use |
| `claude-haiku-4-5` | anthropic | claude-code | 1 / 5 | low | repo-exploration, extraction |
| `gpt-5.6-sol` | openai | codex | subscription | high | coding, implementation, refactoring, tests |
| `gpt-5.4-mini` | openai | codex | subscription | low | bounded edits, tests |
| `gemini-2.5-flash` | google | gemini-cli | subscription | low | repo-exploration, broad reading, extraction |
| `gemini-2.5-pro` | google | gemini-cli | subscription | high | analysis, long-context |

Anthropic IDs and prices are taken from the current model catalog. Codex slugs are read from the machine's own `~/.codex/models_cache.json` (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`), so they are real for this install rather than guessed.

**Availability probe at boot** (`harness/detect.ts`): `which` each binary + a cheap `--version`; mark rows `not-installed` / `unauthenticated` accordingly. Unavailable models are filtered out of the planner's catalog, which is *why the planner cannot assign something that won't run*.

Editable from the Settings screen, so the catalog can evolve during the hackathon without a code change.

---

## 10. Skill registry design — discovery-first, never model-bound

A skill is **reusable procedural knowledge**, injected as text into a worker's task context. It is not a model, not a tool, and not a harness.

### Skills are discovered from the workspace and the user, not authored by this app

The application is **not** the primary source of skills. Real repos and real users already have reusable procedural knowledge on disk, and duplicating it into `server/src/skills/*.md` would fork it and let it rot. The skill layer **discovers and normalizes** instead.

**Scan order (precedence: first match wins on id collision):**

| Precedence | Location | Scope |
|---|---|---|
| 1 (highest) | `<workspace>/.agents/skills/` | Project-specific, checked into the repo |
| 2 | `<workspace>/.claude/skills/` | Project-specific, Claude Code convention |
| 3 | `~/.agents/skills/` | User-level |
| 4 | `~/.claude/skills/` | User-level (this machine already has ~24 skills here) |
| 5 (lowest) | app built-ins | **Fallback only** |

A workspace or user skill **shadows** a built-in of the same id. Built-ins exist so a bare repo with no skills directory still produces a sensible plan — they are a floor, not the source of truth.

**Read in place. Never copied.** The registry stores a *pointer* (`source_path`, `source_scope`, `mtime`, `content_hash`) and the normalized fields. Instruction text is read from the original file at context-packet build time, so editing `<repo>/.claude/skills/testing/SKILL.md` changes worker behavior on the next run with no re-import step. Re-scan on workspace registration, on a Settings refresh, and when a cached `mtime`/hash no longer matches.

**Formats accepted** (both are normalized to the same shape):
- **Directory form** — `<dir>/SKILL.md` with YAML front-matter (`name`, `description`, optional `languages`, `roles`). Sibling files in the directory are treated as skill resources and their paths are passed through.
- **Flat form** — `<name>.md`, front-matter optional; falls back to filename as id and first heading/paragraph as description.

Unparseable files are skipped with a warning, never fatal — a malformed skill in someone's home directory must not break planning.

### Normalized shape

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
  resource_paths: string[]      // sibling files, passed as paths (worker can read them)
  applies_to_languages: string[] | null
  applies_to_roles: AgentRole[] | null
  // NOTE: there is deliberately NO `model` field, and no `harness` field.
}
```

**No skill may have a model permanently attached to it.** This is a hard invariant, not a convention: `Skill` has no `model` key, the Zod schema is `.strict()` so a discovered file declaring `model:` in its front-matter has that key rejected (with a warning naming the file), and a unit test asserts it. A skill describes *how to do a kind of work*; the planner decides *who does it and on what engine*, per task. Binding a model to a skill would collapse the product back into static routing, which is precisely the thing this system is not.

### Selection and injection

- **The planner sees** `id`, `name`, `description`, `applies_to_*` for every discovered skill — never the full instruction text, which would blow up the planning prompt for no benefit.
- **A task selects zero or more skills.** Multi-select is normal: an implementer task might carry `typescript-coding` + `testing` + a workspace-specific `house-style`.
- **The worker receives** the resolved instruction text in its context packet (§15), plus `resource_paths` it can read from disk itself.

**Injection is harness-specific** — the text is identical, only the transport differs:

| Harness | Mechanism |
|---|---|
| Claude Code | `--append-system-prompt` (keeps the objective prompt clean) |
| Codex | prepended `## Skills` block in the stdin prompt |
| Gemini | prepended `## Skills` block in the positional prompt |

Built-in fallbacks shipped with the app (used only when nothing shadows them): `repo-exploration`, `code-implementation`, `testing`, `architecture-review`, `security-review`, `git-review`. Deliberately generic and language-agnostic — anything project-specific belongs in the workspace, where it can be version-controlled by the people who own it.

### The five-way distinction — enforced in the type system, not just documented

This vocabulary is used consistently in code, DB columns, API fields, and UI labels. Where the type system can enforce a separation, it does.

| Concept | Definition | Where it lives | Enforcement |
|---|---|---|---|
| **PlannedTask** | The unit that **binds** objective + skills + harness + model + context + permissions | `plan.tasks[]` | The only place `model` and `harness` may co-occur with `skills` |
| **Skill** | Reusable procedural knowledge — *how* to do a kind of work | `SkillRegistry`, sourced from disk (§10) | `Skill` type has **no** `model` and **no** `harness` field; `.strict()` rejects them |
| **Tool** | A capability/action a worker may perform | `permissions` + harness tool flags | Mapped to each harness's own sandbox/allow flags |
| **Harness** | The coding-agent **execution environment** that runs the agent loop | `CodingHarness` adapter → an OS process | One adapter per CLI; never a Claude native subagent (§11) |
| **Model** | The **inference/reasoning resource** | `task.model` → the harness's `--model` flag | Must exist in the catalog *and* be supported by the assigned harness |

Read the failure modes this prevents: a skill with a model attached is static routing; a model without a harness is unrunnable; a harness that is really a nested subagent isn't multi-vendor; and a task that doesn't bind all four isn't an allocation decision.

---

## 11. Harness adapter architecture

### What a "worker" is — and what it is not

At the **product level** we say *agent*, *worker*, or *subagent* interchangeably for one executing `PlannedTask`, and the UI uses that language. At the **implementation level** the distinction below is load-bearing and must not be blurred in code, types, logs, or docs:

| | Claude Code **native subagent** | This system's **worker** |
|---|---|---|
| What it is | Claude Code's own `Agent` tool / `--agents` definitions, spawned *inside* one Claude Code session | A `PlannedTask` executed by a harness adapter as a **separate OS process** |
| Who controls it | The Claude model, mid-conversation | Our scheduler, from the frozen plan |
| Model | Whatever Claude Code assigns internally | Whatever the **plan** assigned to that task |
| Process | Same process | Own PID, own process group, own `cwd`/worktree |
| Used here? | **No** — not for cross-harness work | **Yes** — this is the execution unit |

**There is no such thing as `Agent(model="codex")` in this system, and the plan must never be read as implying one.** Concretely:

- A task with `harness: "codex"` → `CodexAdapter` → `spawn("codex", ["exec", ...])`. A real OS process running OpenAI's CLI, authenticated by OpenAI's own credential store.
- A task with `harness: "gemini-cli"` → `GeminiAdapter` → `spawn("gemini", [...])`. A real OS process running Google's CLI.
- A task with `harness: "claude-code"` → `ClaudeCodeAdapter` → `spawn("claude", ["-p", ...])`. A **top-level** Claude Code process — still one process per task, still driven by our scheduler. It is *not* a nested subagent of the planner session, and the planner session has long since exited by the time workers run.

Claude Code's native subagent machinery is **not used**: no `--agents` JSON is passed, and the Agent tool is not in any worker's `--allowedTools`. Every worker is a peer process under our supervisor. This is what makes the system genuinely multi-vendor rather than Claude-with-extra-steps, and it is why the harness layer is an adapter interface rather than a Claude configuration.

The one place Claude Code *is* privileged: it runs the **planner** (§7), because it is the best read-only, repo-aware, JSON-Schema-validated planning surface available on this machine. That is an implementation choice about the planning step, not a constraint on workers.

### The adapter interface

```ts
interface CodingHarness {
  readonly id: HarnessId;
  detect(): Promise<{ installed: boolean; version?: string; authenticated: boolean }>;
  supportsModel(modelId: string): boolean;

  execute(input: {
    task: PlannedTask;
    packet: ContextPacket;      // §15
    cwd: string;                // repo root or dedicated worktree
    signal: AbortSignal;
  }): AsyncIterable<HarnessEvent>;

  // cancel() is deliberately absent — cancellation is the AbortSignal.
  // Uniform process-tree kill lives in one place (§29), not per adapter.
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

Every adapter is a thin translator: build argv → spawn → parse the harness's own stream → emit `HarnessEvent`. All process supervision, timeout, and cancellation is shared (§17).

**Design note:** `costIsExact` on `finished` is what lets the usage dashboard be honest without special-casing providers in the UI.

---

## 12. Claude Code integration

Verified against `claude --help` (v2.1.224) and the current headless docs.

**Worker invocation:**

```bash
claude -p "<objective + context packet>" \
  --model <catalog model id or alias> \
  --output-format stream-json --verbose \
  --permission-mode <acceptEdits | dontAsk> \
  --allowedTools "<Read,Grep,Glob[,Edit,Write,Bash(...)]>" \
  --append-system-prompt "<skills>" \
  --add-dir "<worktree>" \
  --max-turns <n> \
  --no-session-persistence \
  --session-id <uuid>
```
`cwd` = the task's worktree.

| Requirement | Answer |
|---|---|
| Pass prompt | Positional arg after `-p` (stdin also works, ≤10MB) |
| Specify model | `--model` (alias `opus`/`sonnet`, or full id) |
| Working directory | Process `cwd` + `--add-dir` |
| Non-interactive | `-p` / `--print` |
| Structured output | `--json-schema` + `--output-format json` → `structured_output` |
| Stream stdout | `--output-format stream-json --verbose`, NDJSON |
| Cancellation | SIGTERM → aborts turn, kills the Bash process tree, exits **143** |
| Exit status | 0 success, non-zero failure |
| **Token usage** | `result` event `usage` |
| **Cost** | `result` event **`total_cost_usd`** + per-model breakdown — **exact dollars** |
| Permissions | `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--tools` |
| Worktrees | Has native `-w/--worktree`, **not used** — we manage worktrees ourselves for cross-harness uniformity |

**Extras worth using:** `--max-budget-usd` as a per-task hard cap; `--effort` mapped from `execution.effort`; `--bare` is *not* used for workers (we want the workspace's `CLAUDE.md` loaded) but *is* worth considering for the planner if cross-machine reproducibility becomes an issue.

**Stream parsing:** read NDJSON lines; `system/init` → `started`; `assistant` messages → `tool` events built from `tool_use` blocks; **`thinking` blocks are dropped** (§30); `result` → `finished` with `costIsExact: true`.

---

## 13. Codex integration

Verified against `codex exec --help` (codex-cli 0.146.0).

```bash
codex exec "<objective + context packet>" \
  --model <gpt-5.6-sol | gpt-5.4-mini | ...> \
  -c model_reasoning_effort="<low|medium|high|xhigh|max>" \
  --cd "<worktree>" \
  --sandbox <read-only | workspace-write> \
  --json \
  --output-last-message "<runs/.../last_message.txt>" \
  --skip-git-repo-check
```

| Requirement | Answer |
|---|---|
| Pass prompt | Positional, or stdin when omitted / `-` |
| Specify model | `-m/--model` |
| Working directory | **`-C/--cd <DIR>`** (native — plus `--add-dir` for extra writable dirs) |
| Non-interactive | `codex exec` |
| Structured output | **`--output-schema <FILE>`** — a JSON Schema file for the final response |
| Stream stdout | `--json` → JSONL events (`thread.started`, `item.started/updated/completed`, `turn.completed`) |
| Cancellation | SIGTERM on the process group |
| Exit status | standard |
| **Token usage** | `turn.completed` → `usage { input_tokens, cached_input_tokens, output_tokens }` — **cumulative for the session** |
| **Cost** | **Not returned.** Derived from tokens × catalog price, flagged estimated |
| Permissions | `--sandbox read-only \| workspace-write \| danger-full-access` — maps cleanly to our `permissions.filesystem` |
| Worktrees | No native support; ours, via `--cd` |

**Two implementation notes:**
- `turn.completed.usage` is **cumulative**, so the last event wins — don't sum across turns or you'll double-count.
- Reasoning items appear in the JSONL stream; filter `item.type === "reasoning"` before writing logs.
- `--dangerously-bypass-approvals-and-sandbox` exists and is **never** used.

---

## 14. Gemini integration

Verified against `gemini --help` (v0.22.5).

```bash
gemini "<objective + context packet>" \
  --model <gemini-2.5-flash | gemini-2.5-pro> \
  --output-format json \
  --approval-mode <default | auto_edit | yolo> \
  --include-directories "<worktree>"
```
`cwd` = the task's worktree.

| Requirement | Answer |
|---|---|
| Pass prompt | **Positional** (`-p/--prompt` is deprecated); stdin is appended |
| Specify model | `-m/--model` |
| Working directory | **No `--cd` flag** — must set the spawn `cwd`; `--include-directories` adds scope |
| Non-interactive | Positional query defaults to one-shot |
| Structured output | No JSON-Schema flag; use a prompted JSON contract + Zod parse (read-only roles only) |
| Stream stdout | `--output-format stream-json` (json for one-shot) |
| Cancellation | SIGTERM on the process group |
| **Token usage** | `stats.models[<model>].tokens { prompt, candidates, cached, total, thoughts, tool }` |
| **Cost** | Not returned. Derived; flagged estimated |
| Permissions | `--approval-mode default\|auto_edit\|yolo`, `--allowed-tools <array>`; `--yolo` never used |
| Worktrees | No native support; ours, via `cwd` |

**Token mapping:** `prompt → inputTokens`, `candidates → outputTokens`, `cached → cachedInputTokens`, `thoughts → reasoningTokens`. Note `total` already includes `thoughts` and `tool` — recompute rather than trusting it, so the three harnesses normalize identically.

**Role fit:** Gemini is the exploration/extraction harness in the MVP (cheap, fast, broad reading, read-only). Not the implementer.

---

## 15. Context-packet design

Two rules govern this layer:

1. **The planner's conversation is never copied into workers.** Each worker gets a compact, purpose-built packet — not a transcript.
2. **The worker gets repository context by *running in the repository*, not by having it pasted into a prompt.** Every harness is a real coding agent with real filesystem tools, executing with `cwd` set to the workspace or the task's worktree. So the packet carries **pointers and facts** — paths, a profile, a directory shape — and lets the worker `Read`/`Grep`/`Glob` for itself. Inlining source files would waste tokens, go stale the moment an upstream task writes, and duplicate a capability the worker already has.

The one thing that *is* inlined is what the worker cannot obtain from the filesystem: skill instructions and upstream task summaries.

```ts
ContextPacket {
  run_id, task_id
  workspace_path: string                 // the cwd the worker will actually run in
                                         // (repo root for read-only, worktree for writers)
  objective: string
  acceptance_criteria: string[]
  constraints: string[]                  // permission summary in plain English
  project_instructions: string | null    // CLAUDE.md / AGENTS.md — inlined; it is
                                         // instruction, not source, and is short
  repo_facts: RepoProfile                // ~2KB of derived facts, NOT file contents
  relevant_paths: string[]               // POINTERS — "look here first", not contents.
                                         // Non-binding: the worker may read anything
                                         // its permissions allow.
  upstream: Array<{                      // one per context_from entry — inlined, because
    task_id, task_name, summary,         // a sibling task's reasoning exists nowhere
    key_findings: string[],              // on disk the worker can reach
    artifact_paths: string[]             // ...but its artifacts are passed as paths
  }>
  skills: Array<{ id, name, instructions, resource_paths }>
                                         // instructions inlined (read from source at
                                         // build time per §10); resources as paths
  expected_output: string                // exact contract, incl. the summary block
  assignment: { harness, model, effort }
}
```

**Consequence for diffs.** A reviewer task does not get the implementation's source pasted in — it gets the worktree path plus `patch.diff`'s path, and reads them itself with the tools it already has. This keeps review packets small and, more importantly, keeps the reviewer looking at the *actual* current state of the tree rather than a snapshot taken at packet-build time.

Rendered by `context/render.ts` into a single markdown prompt string, ordered stable-first (project instructions → repo facts → skills → upstream → objective) so any harness-side prompt caching can actually hit.

**RepoProfile** (`workspace/profile.ts`) — cheap, deterministic, no LLM:
git branch/HEAD/dirty state · root file listing · detected languages by extension histogram · package manager · framework hints from `package.json` deps · test runner · presence of `CLAUDE.md`/`AGENTS.md`/`README.md` · top-level directory tree to depth 2 · LOC by language. Target ≤ 2 KB.

**Worker output contract.** Every worker is instructed to end its response with a fenced block:

````
```agentplan-summary
{ "summary": "...", "key_findings": ["..."], "artifacts": ["..."],
  "status": "completed" | "blocked", "blockers": ["..."] }
```
````

Parsed by `context/summary.ts`. If missing or malformed, the harness's own final message is stored as `summary` and `key_findings` is left empty — degraded, never fatal. Claude Code tasks can additionally use `--json-schema` for a guaranteed shape; Codex can use `--output-schema`. Gemini relies on the prompted contract.

**Artifact persistence — files on disk, rows in SQLite pointing at them:**

```
~/.agentplan/runs/<runId>/
  plan.json
  planner-stdout.json
  tasks/<taskId>/
    context-packet.md
    summary.json
    output.md
    patch.diff
    events.ndjson
    stderr.log
```

Rationale: diffs and logs are large, awkward blobs; SQLite holds the queryable facts and the path. This keeps the usage dashboard's aggregate queries fast and makes artifacts trivially inspectable during a demo.

---

## 16. Dependency / DAG execution

`scheduler/scheduler.ts`, a straightforward ready-set loop:

1. Build adjacency + indegree from `dependencies`. Cycles already rejected at validation.
2. `ready` = tasks with `status = "queued"` and all deps `completed`.
3. Dispatch from `ready` while `running.size < concurrency_limit`.
4. **Worktree serialization:** at most one `dedicated`-worktree task per branch at a time; `none`/`shared` tasks may run freely in parallel against the main repo (they cannot write).
5. On task completion → persist artifacts → recompute ready set → repeat.
6. On task failure → mark dependents `blocked` (transitively), leave independent branches running.
7. Run terminates when nothing is running and nothing is ready.

**Lifecycle:** `planned → queued → running → completed | failed | blocked | cancelled`

`planned` is the state at plan-emit time. `queued` on Start Run. `blocked` means an upstream dependency failed (distinct from `failed`). `cancelled` is user-initiated. Recorded on both `runs` and `tasks`.

Default `concurrency_limit` = 3 (planner may lower it; server clamps to a Settings max), chosen to keep three provider CLIs' rate limits and a laptop's CPU comfortable.

---

## 17. Local process management

One `ProcessSupervisor` (`harness/supervisor.ts`) for all three adapters — the adapters never call `spawn` directly.

- `spawn(cmd, args, { cwd, env, detached: true })` — `detached` gives a process group, so we can kill children (a CLI that spawned `npm test`) rather than orphaning them.
- **stdout** through a line-delimited NDJSON transform; malformed lines logged and skipped, never fatal.
- **stderr** captured to `stderr.log` and tailed into the UI at `warn`.
- **Env hygiene:** pass a curated env — `PATH`, `HOME`, `TERM`, plus explicit per-harness vars. Never forward the whole `process.env` (§30).
- **Timeout:** `execution.timeout_seconds` → `SIGTERM` to `-pid` (the group) → 10s grace → `SIGKILL`.
- **Cancellation:** an `AbortController` per task; a run-level controller aborts all children.
- **Backpressure:** cap in-memory events per task (ring buffer, e.g. 500) for the UI; the full stream always goes to `events.ndjson`.
- **Crash safety:** on boot, any `running` task/run in the DB is marked `failed` with `interrupted_by_restart` — no zombie state after a laptop sleep.

---

## 18. Git worktree / workspace strategy

**Worktrees are the correct MVP choice.** Every candidate harness accepts an arbitrary working directory (`cwd`, `--cd`, `--add-dir`), a worktree is a real checkout so builds and tests work unmodified, creation is fast because the object store is shared, and removal is a single command. Cloning is slower and wastes disk; a shared working tree would let two writers stomp each other; container isolation is out of scope for a hackathon.

**Rules (deliberately conservative):**

- Read-only tasks (`permissions.filesystem ∈ {none, read}`) run in the **main repo** with the harness in read-only mode. No worktree, no branch.
- Each writing task gets a **dedicated worktree**:
  ```bash
  git worktree add -b agentplan/<runId>/<taskId> \
      "<repo>/.worktrees/<runId>/<taskId>" HEAD
  ```
- **Preflight:** refuse to start a run if `git status --porcelain` is non-empty, unless the user explicitly ticks "I know, proceed" in the New Run screen. Surfaced as a blocking dialog, not a silent warning.
- **After a writing task:** `git -C <wt> add -A && git -C <wt> diff --cached > patch.diff`, and optionally commit inside the worktree. **Never push. Never merge. Never rebase. Never resolve conflicts.**
- **Downstream review tasks** get the diff *as text in their context packet* plus read access to the worktree — they do not need to merge anything.
- **Cleanup:** worktrees are **kept** after a run (they're the deliverable). The Settings screen has an explicit "Remove worktrees for run X" action → `git worktree remove --force` + `git worktree prune`. Manual on purpose: auto-deleting a user's generated code is the kind of destructive default that ruins trust.
- `.worktrees/` is added to the workspace's `.git/info/exclude` at registration, so we never dirty the user's `.gitignore`.

**Post-hackathon (explicit non-goal now):** automatic integration, conflict resolution, stacked branches, PR creation.

---

## 19. Local persistence

**`node:sqlite`, built into Node 25 — verified working on this machine.** Chosen over `better-sqlite3` because it needs no native compile step; a `node-gyp` failure mid-hackathon is a real, avoidable risk. (It prints an `ExperimentalWarning`; suppress with `--no-warnings=ExperimentalWarning` in the dev script. If it misbehaves, `better-sqlite3` is a drop-in with nearly the same synchronous API — noted as the fallback.)

Chosen over JSON files because the Usage dashboard is fundamentally `GROUP BY model / workspace / run` — aggregation is the whole feature. Chosen over Postgres/Supabase because local-first with zero ops is an explicit requirement.

**Four separated concerns — the separation is a hard rule:**

| Concern | Location | Contains secrets? |
|---|---|---|
| **1. Secrets** | OS environment + the CLIs' own credential stores (`~/.claude`, `~/.codex/auth.json`, `~/.gemini`) | Yes — and we never read or write them |
| **2. App configuration** | `~/.agentplan/config.json` (0600) — workspaces, catalog overrides, EverOS URL, concurrency | No |
| **3. Telemetry / run history** | `~/.agentplan/agentplan.db` | **Never** |
| **4. Task artifacts** | `~/.agentplan/runs/<runId>/...` | Never intentionally; see §30 |

Everything under `~/.agentplan/`, not in the user's repo, so the tool never pollutes the workspace it operates on.

Migrations: a single `schema.sql` applied idempotently at boot with a `user_version` pragma check. No migration framework for the MVP.

---

## 20. Secret management

**The design goal is that this app holds no provider API keys at all**, and the local toolchain makes that achievable:

- **Execution keys: not ours.** `claude`, `codex`, and `gemini` are each already authenticated on this machine via their own credential stores. We spawn them; they authenticate themselves. This is why no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` is set in the environment — and it should stay that way.
- **EverOS provider keys: EverOS's, not ours.** They live in EverOS's own `.env` (`EVEROS_LLM__API_KEY`, `EVEROS_EMBEDDING__API_KEY`, …), read by the EverOS server process. We only talk to `http://127.0.0.1:8000`.

**Hard rules:**

1. **Never `localStorage`, never `sessionStorage`, never a cookie, never in a bundled JS file.** The browser is untrusted; the SPA talks only to `localhost:8787`.
2. **No secret is ever sent to the frontend.** The Settings API returns `{ configured: boolean, source: "env" | "cli-credential-store" | "missing" }` — a status, never a value.
3. **No secret in SQLite, plans, artifacts, or logs.**
4. If a secret is ever genuinely required (e.g. an EverOS Cloud key later), it goes in the process environment via a `.env` read by the *server only*, with `.env` in `.gitignore` and the file mode checked at boot. Never a DB column.
5. Settings is a **detection and diagnostics screen** — "Claude Code: installed 2.1.224, authenticated ✓" — plus a "how to fix" link. It is not a key-entry form.

**Why not OS keychain for the MVP:** it adds a native dependency and per-platform code for zero benefit, because we hold nothing worth storing. Documented as a post-hackathon step for the day a first-party key is genuinely needed.

---

## 21. Usage / token / cost accounting

**Normalization.** Each adapter maps its harness's fields into `NormalizedUsage` (§11). Traps handled explicitly:
- Codex `turn.completed.usage` is **cumulative** → last-event-wins, not summed.
- Gemini `stats.tokens.total` **includes** `thoughts` and `tool` → recompute rather than trust.
- Claude Code cache fields are separate from `input_tokens` → keep `cachedInputTokens` distinct so cost math can price it differently later.

**Cost resolution, in strict priority order** (`usage/cost.ts`):

1. **Exact** — the harness returned dollars. Only Claude Code (`total_cost_usd`). → `cost_is_estimated = 0`.
2. **Derived** — catalog has published per-MTok prices → `input/1e6 × in + output/1e6 × out`. → `cost_is_estimated = 1`.
3. **Unknown** — no price (subscription-auth models with no published rate) → cost `null`, tokens still recorded. The UI shows "— (tokens only)", never `$0.00`. Showing zero would be a lie that flatters the savings number.

**Every dollar figure in the UI carries a provenance badge**: `exact` / `est.` / `tokens only`. One shared `<Cost>` component enforces this — it cannot render a number without a provenance prop.

**Aggregations** (plain SQL over `tasks`): per run, per model, per harness, per workspace, per day; agent count; model distribution; wall-clock duration; success/failure counts. Wall-clock run duration is `max(completed_at) − min(started_at)`, which is *less* than the sum of task durations when tasks ran in parallel — the dashboard shows both and labels them.

---

## 22. Baseline-vs-actual cost methodology

**The claim, stated precisely:**

> **Baseline** — what this same run would have cost if *every LLM-driven task* had been executed by the planner-class frontier model, holding the observed token counts constant.
> **Actual** — the sum of resolved per-task costs under the planner's assignments.
> **Savings** — `(baseline − actual) / baseline`.

```
baseline_cost = Σ_tasks ( in_tokens/1e6 × frontier_in + out_tokens/1e6 × frontier_out )
actual_cost   = Σ_tasks ( resolved cost per §21 )
```

**Assumptions, printed in the UI next to the number — not buried in a doc:**

1. Token counts are held constant across models. A frontier model may use fewer or more tokens for the same task, so this is an approximation, not a measurement.
2. The frontier reference is `claude-opus-5` at published API rates.
3. Tasks whose actual cost is `tokens only` are priced at their catalog rate for the *actual* side where one exists; where none exists, they are **excluded from both sides** and the count of excluded tasks is displayed. Excluding from both sides is what keeps the ratio honest.
4. Planning cost is included in `actual` (it is real, exact, and part of the approach) and in `baseline` (the planner is frontier by definition, so it is identical on both sides — it dilutes the savings percentage rather than inflating it, which is the conservative direction).

**UI treatment:**

```
Baseline (all-frontier, estimated)   $1.84
Actual routed plan cost              $0.42   ($0.11 exact · $0.31 est.)
Savings                              77%
⚠ Estimated. Token counts held constant across models. 1 task excluded (no published rate).
```

The `⚠` line is not optional chrome. A judge who asks "how do you know?" should find the answer already on screen.

**Anti-goal:** never compare against a fabricated "what a human would have spent" or a made-up per-task frontier token count.

---

## 23. EverMind / EverOS integration

**Verified facts** (repo `EverMind-AI/EverOS`, Apache-2.0, Python, ~11.9k stars, active): local-first, Markdown is the source of truth, SQLite + LanceDB indexes, hybrid BM25 + vector retrieval, FastAPI HTTP server.

**Setup (documented in the README, not invented):**
```bash
uv pip install everos          # Python 3.12+ — machine has 3.12.3 ✓
everos init                    # writes ./.env
everos server start            # http://127.0.0.1:8000
curl http://127.0.0.1:8000/health          # → {"status":"ok"}
```
Requires an OpenRouter key (`EVEROS_LLM__API_KEY`, `EVEROS_MULTIMODAL__API_KEY`) and a DeepInfra key (`EVEROS_EMBEDDING__API_KEY`, `EVEROS_RERANK__API_KEY`), or any OpenAI-compatible endpoints via the `*__BASE_URL` fields. **This is a prerequisite to flag early** — without it only `everos demo` works, not add/search.

**Endpoints used (v2; `/api/v1` is a legacy alias — write v2):**

| Endpoint | Use |
|---|---|
| `GET /health` | Availability probe at boot and before each write |
| `POST /api/v2/memory/add` | Write run outcome — `{session_id, app_id, project_id, messages[{sender_id, role, timestamp, content}]}` |
| `POST /api/v2/memory/flush` | Force extraction so the memory is searchable immediately (essential for a live demo) |
| `POST /api/v2/memory/search` | Retrieve prior memories — `{query, user_id \| agent_id, app_id, project_id, top_k, method:"hybrid"}` |

**This is operational memory for the planner, not decorative chat memory.** The orthogonal retrieval axes map onto our domain almost exactly:

| EverOS axis | Our meaning |
|---|---|
| `app_id` | `"agentplan"` (constant) |
| `project_id` | workspace id — memory is per-repository |
| `agent_id` | the agent role (`implementer`, `reviewer`, …) — enables role-scoped recall |
| `session_id` | the run id |
| `sender_id` | `"orchestrator"` |

**Write-after-run** (`memory/write.ts`) — one message per completed task plus one run-level summary, each a factual sentence built from real telemetry:

> "On workspace `acme-api` (TypeScript, Express, Vitest), a bounded test-writing task assigned to `gpt-5.6-sol` via the Codex harness completed successfully in 94s using 41.2k tokens. A read-only repository scan assigned to `gemini-2.5-flash` was sufficient and cost an estimated $0.004. The architecture task on `claude-opus-5` produced the design that the implementation followed without rework."

**Read-before-plan** (`memory/read.ts`) — before building the planner prompt, `POST /memory/search` with a query derived from the goal + repo profile, `project_id` = workspace, `top_k` = 5. Hits are injected into the planner prompt under a `## Prior execution memory` heading, clearly framed as **advisory observations, not instructions** (a memory that says "use model X" must not override the catalog).

**The demo moment this creates:** run the same goal twice on the same repo; the second plan visibly cites prior memory in `rationale_summary`. That is a concrete "learning that compounds" story rather than a logo on a slide.

**Graceful degradation:** if `/health` fails, memory reads return `[]` and writes are appended to a local outbox (`~/.agentplan/everos-outbox.ndjson`) with a "Retry EverOS sync" button in Settings. **The product is fully usable with EverOS down.**

---

## 24. Snowflake integration

**Out of scope for the MVP, by the user's decision.** Not implemented, not stubbed with fake calls, not claimed in the UI.

**What is done instead — keeping the door open at near-zero cost:** the `tasks` table is deliberately shaped as a flat, denormalized fact table matching the columns the brief listed (`run_id, task_id, workspace_id, harness, model, provider, input_tokens, output_tokens, cached_tokens, estimated_cost_usd, latency_ms, status, success, started_at, completed_at`), and carries a `synced_at TIMESTAMP NULL` column that nothing currently writes.

Adding Snowflake later is therefore: `pnpm add snowflake-sdk` → a `SELECT ... WHERE synced_at IS NULL` → batched `INSERT` → `UPDATE synced_at`. Roughly 60 lines, no schema change. Auth would be key-pair (`authenticator: 'SNOWFLAKE_JWT'`, `privateKeyPath`), which is the recommended local-app method and avoids storing a password.

Listed in §40 as the first post-hackathon extension.

---

## 25. Frontend information architecture

Six screens, one nav rail. Deliberately small.

| Route | Purpose | Key elements |
|---|---|---|
| `/` **Dashboard** | Orientation | Active workspace, live run card, total spend + tokens, last 5 runs |
| `/new` **New Run** | Start work | Workspace selector, goal textarea, optional budget, dirty-tree warning, **Create Plan** |
| `/runs/:id/plan` **Plan View** | *The differentiator screen* | DAG + task cards, per-task model/harness/skills/deps/permissions/estimate/**rationale**, plan totals, **Start Run** |
| `/runs/:id` **Execution** | Watch it work | Live agent cards, statuses, elapsed, tokens, cost, worktree path, event log |
| `/usage` **Usage** | Economics | Cost by model, tokens by model, runs table, duration, success/fail, **baseline vs actual** |
| `/settings` **Settings** | Configure | Workspaces, harness detection, model catalog toggles, **discovered skills grouped by source scope with their file paths**, EverOS status, worktree cleanup |

Design language: dark, dense, monospace for identifiers, colour used **only** for status. Demo-legible at projector distance. Tailwind, no component library — a UI kit is a time sink at this size.

---

## 26. Important UI components

- **`<PlanGraph>`** — the one visual worth investing in. **Layered list-graph hybrid, not a physics graph.** Tasks bucketed by topological depth into columns; dependency edges drawn as SVG paths between card anchors. Deterministic, readable, no layout library, ~150 lines. A force-directed graph is the classic hackathon time sink; explicitly avoided.
- **`<AgentCard>`** — one worker: harness badge · model chip · role · status pill · elapsed · in/out tokens · cost with provenance badge · worktree path · dependency chips. Used identically in Plan View (planned state) and Execution (live state).
- **`<Cost>`** — renders money. **Requires** a `provenance` prop (`exact` | `estimated` | `unknown`); renders `— tokens only` for unknown. Makes honest labelling structurally unavoidable.
- **`<EventLog>`** — virtualized, filterable by level, auto-scroll with pause-on-scroll-up.
- **`<UsageBars>`** — plain CSS-grid horizontal bars for cost/tokens by model. No charting dependency.
- **`<BaselinePanel>`** — baseline / actual / savings % + the assumptions block (§22).
- **`<HarnessStatus>`** — per-CLI installed/version/authenticated row for Settings.

---

## 27. Backend / API / event-streaming design

REST for commands and reads; **SSE** for live updates. SSE over WebSockets: unidirectional server→client is all we need, it's plain HTTP, it auto-reconnects natively, and it survives a Vite proxy without extra config.

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

**Event bus:** a single in-process `EventEmitter`; SSE handlers subscribe by `runId`. Each SSE message is `{ type, runId, taskId?, seq, ts, payload }` with a monotonic `seq` so a reconnecting client can request a replay from `~/.agentplan/runs/<id>/events.ndjson` via `Last-Event-ID`. Types: `run.status`, `task.status`, `task.log`, `task.tool`, `task.usage`, `task.artifact`, `plan.ready`, `plan.invalid`.

**Why a single process:** the child-process registry, the SSE bus, and the scheduler must share memory. Splitting them across serverless-style handlers would require external coordination for no benefit in a local app.

---

## 28. Data model

`~/.agentplan/agentplan.db` (SQLite). Abbreviated DDL:

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
  default_branch TEXT, profile_json TEXT, created_at TEXT NOT NULL);

CREATE TABLE runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  goal TEXT NOT NULL, status TEXT NOT NULL,             -- planning|planned|running|completed|failed|cancelled
  plan_json TEXT, plan_valid INTEGER, plan_errors_json TEXT,
  budget_usd REAL,
  planner_model TEXT, planner_cost_usd REAL, planner_input_tokens INTEGER,
  planner_output_tokens INTEGER, planner_session_id TEXT,
  concurrency_limit INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);

-- Flat fact table: one row per task. Snowflake-shaped on purpose (§24).
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
-- files (§10) and are read at packet-build time. Deliberately no `model` column.
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

## 29. Error handling and cancellation

| Failure | Handling |
|---|---|
| Planner returns invalid JSON / schema mismatch | Store raw stdout; surface field-level errors; **one** automatic re-plan with errors appended; then stop |
| Planner invents a model/harness/skill | Rejected at gate 2; the invalid identifier is named in the UI |
| Plan has a dependency cycle | Rejected at gate 3 with the cycle path printed |
| Plan over budget | Returned as `over_budget`; user accepts or re-plans. Never silently truncated |
| Harness binary missing / unauthenticated | Detected at boot; those models filtered from the catalog so the planner can't pick them |
| Worker non-zero exit | Task `failed`; stderr captured; dependents → `blocked`; independent branches continue |
| Worker timeout | SIGTERM to the process group → 10s → SIGKILL; task `failed` with `timeout` |
| Worker emits no summary block | Fall back to the final assistant message; `key_findings: []`. Degraded, not fatal |
| Dirty working tree at run start | Blocking dialog; explicit user override required |
| Worktree create fails (branch exists) | Suffix the branch name; retry once; then fail the task with a clear message |
| EverOS unreachable | Reads → `[]`; writes → outbox; banner in Settings. Run unaffected |
| SSE client disconnects | Server keeps running; client reconnects and replays from `Last-Event-ID` |
| Server restart mid-run | Boot marks orphaned `running` rows `failed` (`interrupted_by_restart`); worktrees preserved |
| User cancels | Run-level `AbortController` → SIGTERM to every group → tasks `cancelled` → worktrees preserved |

**Principle:** a failure degrades to a clear message plus preserved artifacts. Nothing is auto-deleted, auto-merged, or auto-retried more than once.

---

## 30. Security considerations

1. **Bind to `127.0.0.1` only.** Never `0.0.0.0`. A local orchestrator that spawns shell-capable agents must not be reachable from the LAN.
2. **CORS restricted** to the Vite dev origin; in production the SPA is served same-origin from the Node process.
3. **No secrets in the browser** (§20). Settings returns booleans.
4. **Env allow-list for children.** Curated env only; never spread `process.env` into a spawned coding agent.
5. **Workspace path validation.** Registration requires an existing directory containing `.git`; the resolved realpath is stored. Reject paths escaping the registered root when constructing worktree paths.
6. **`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, and `--yolo` are never emitted.** Add a unit test asserting no adapter can produce those strings — a guardrail that survives future edits.
7. **Least privilege per task.** `permissions.filesystem` maps to the harness's own sandbox flag (`--sandbox read-only`, `--permission-mode dontAsk`, `--approval-mode default`). Read-only tasks are read-only *at the harness level*, not by convention.
8. **Shell allow-lists** are passed through as `Bash(cmd *)` rules where the harness supports them, rather than blanket bash access.
9. **No chain-of-thought in logs.** Claude `thinking` blocks dropped; Codex `item.type === "reasoning"` filtered; Gemini exposes only a `thoughts` token *count*. Logs contain operational events, tool names/results, and summaries. Reasoning **tokens** are still counted for cost — counting is not exposing.
10. **Artifact redaction pass.** Before writing `output.md` / `summary.json`, run a regex scan for common key shapes (`sk-`, `ghp_`, `AKIA`, `-----BEGIN ... PRIVATE KEY-----`) and replace with `[REDACTED]`. Cheap insurance against an agent echoing a `.env` it read.
11. **SSE has no auth** — acceptable only because of rule 1. Documented as a constraint, not an oversight.

---

## 31. Real vs. mocked in the hackathon MVP

| Component | Status |
|---|---|
| Workspace registration + git profiling | **Real** |
| Skill discovery from `.agents/skills`, `.claude/skills`, user dirs | **Real** |
| Planner (`claude -p --json-schema`) | **Real** |
| `plan.json` as an immutable persisted artifact | **Real** |
| Plan validation against the catalog + skill registry | **Real** |
| DAG scheduler + parallel execution | **Real** |
| Claude Code adapter | **Real** |
| Codex adapter | **Real** |
| Gemini adapter | **Real** |
| Git worktree isolation | **Real** |
| SQLite persistence + run history | **Real** |
| SSE live streaming | **Real** |
| Token accounting | **Real** (parsed from each harness) |
| Cost — Claude Code | **Real, exact** (`total_cost_usd`) |
| Cost — Codex / Gemini | **Estimated** from a curated catalog; labelled in the UI |
| Baseline vs actual | **Real arithmetic** over real tokens; assumptions displayed |
| EverOS write + read | **Real** (needs EverOS running + provider keys) |
| Model catalog capability tags | **Curated by us** — presented as our tags, not benchmarks |
| Snowflake | **Not built** (user decision) — schema is sync-ready |
| Escalation / replanning | **Schema field only**, not executed |
| Auth / multi-user | **Not built** — non-goal |

Nothing is fake-but-presented-as-real. Anything estimated says so on screen.

---

## 32. Exact MVP scope

1. Register/select a local git workspace.
2. Detect installed + authenticated harnesses; seed the model catalog; **discover skills** from the workspace (`.agents/skills`, `.claude/skills`) and user-level directories, with built-ins as fallback.
3. Enter an engineering goal (+ optional budget).
4. Planner inspects the real repo read-only and **jointly decides decomposition and per-task model/harness assignment** in one pass.
5. Plan validated against schema, model catalog, skill registry, graph, permissions, budget — then frozen as an immutable `plan.json`.
6. Plan View shows every agent with model, harness, skills, deps, permissions, estimate, and rationale — **before execution**.
7. Execute 3–4 tasks across **at least two** harness/model configurations, in parallel where the DAG allows.
8. Stream status, tool events, tokens, and cost live over SSE.
9. Writing tasks run in dedicated git worktrees; a diff artifact is produced.
10. Persist runs/plans/tasks/usage to SQLite; history survives a restart.
11. Write execution memory to EverOS; retrieve it on the next plan for the same repo.
12. Usage screen: cost/tokens by model, run history, and baseline vs actual with assumptions.

---

## 33. Ordered implementation phases

Each phase ends in something runnable.

### Phase 0 — Scaffold *(~45 min)*
**Objective:** an empty app that boots.
**Files:** ~~`plan.md`~~ (done) · `package.json` (pnpm workspaces) · `pnpm-workspace.yaml` · `tsconfig.base.json` · `.gitignore` · `packages/core/{package.json,src/index.ts}` · `server/{package.json,src/index.ts}` · `web/` (Vite React TS scaffold) · `vitest.config.ts`
**Deps:** `hono`, `@hono/node-server`, `zod`, `zod-to-json-schema`, `nanoid`, `tsx`, `typescript`, `vitest`, `react`, `react-dom`, `react-router-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`
**APIs:** `GET /api/health`
**Tests:** health returns 200.
**Done when:** `pnpm dev` serves `:8787` and `:5173` with the proxy working.

### Phase 1 — Persistence + workspaces *(~1 h)*
**Objective:** register a repo and profile it.
**Files:** `server/src/db/{schema.sql,index.ts}` · `server/src/workspace/{register.ts,profile.ts,git.ts}` · `server/src/http/workspaces.ts` · `web/src/pages/Settings.tsx`
**Structures:** `workspaces`, `runs`, `tasks`, `model_catalog`, `skills`, `memory_outbox`.
**APIs:** `POST/GET/DELETE /api/workspaces`
**Tests:** schema applies idempotently; profiling this repo yields correct language/PM/framework; non-git path rejected.
**Done when:** a repo is registered and its profile renders in Settings.

### Phase 2 — Catalog, skill discovery, harness detection *(~1.5 h)*
**Objective:** the planner's option space is real *and sourced from the user's own machine*.
**Files:** `server/src/catalog/{seed.ts,index.ts}` · `server/src/skills/{discover,normalize,registry,resolve}.ts` + `builtin/*.md` · `server/src/harness/detect.ts` · `server/src/http/{models,skills,harnesses}.ts` · `web/src/components/HarnessStatus.tsx`
**APIs:** `GET /api/harnesses`, `GET/PATCH /api/models`, `GET /api/skills?workspaceId=`
**Tests:** detection handles a missing binary; unavailable harness ⇒ its models excluded; **skill discovery across all five locations with precedence resolution**; a workspace skill shadows a same-id built-in; malformed front-matter is skipped with a warning not a throw; **a skill file declaring `model:` has that key rejected**; `mtime` change triggers a re-read.
**Done when:** Settings lists discovered skills grouped by scope with their source paths, and this machine's `~/.claude/skills/*` show up without being copied anywhere.

### Phase 3 — Plan schema + planner *(~2 h — the core)*
**Objective:** a goal produces a validated DAG.
**Files:** `packages/core/src/plan.ts` (Zod) · `server/src/planner/{prompt.ts,run.ts,validate.ts}` · `server/src/http/runs.ts` · `web/src/pages/NewRun.tsx`
**APIs:** `POST /api/runs`, `GET /api/runs/:id`
**Tests (highest value in the project):** Zod round-trip; cycle detection; unknown model/harness/skill rejected; `context_from ⊄ dependencies` rejected; write-permission-without-worktree rejected; budget overrun flagged. **Use a checked-in fixture plan so these run without spending money.**
**Done when:** a real goal against a real repo returns a schema-valid plan and its exact planner cost.

### Phase 4 — Plan View *(~1.5 h)*
**Objective:** the differentiator is visible.
**Files:** `web/src/pages/PlanView.tsx` · `web/src/components/{PlanGraph,AgentCard,Cost}.tsx`
**Done when:** the DAG renders with model, harness, skills, deps, permissions, estimate, and rationale per task, plus plan totals and a **Start Run** button.

### Phase 5 — Harness adapters + supervisor *(~2.5 h)*
**Objective:** run one task through each CLI.
**Files:** `server/src/harness/{types.ts,supervisor.ts,claude.ts,codex.ts,gemini.ts,index.ts}` · `server/src/usage/normalize.ts`
**Tests:** parse checked-in stdout fixtures per harness → expected `NormalizedUsage`; Codex cumulative-usage handled as last-wins; Gemini `total` recomputed; no adapter can emit a dangerous flag.
**Done when:** each adapter runs a trivial read-only task in a scratch repo and reports correct tokens.

### Phase 6 — Worktrees + context packets *(~1.5 h)*
**Objective:** safe parallel writes and real inter-task context.
**Files:** `server/src/workspace/worktree.ts` · `server/src/context/{build.ts,render.ts,summary.ts}`
**APIs:** artifact fetch endpoint.
**Tests:** worktree create/diff/remove against a temp repo; dirty-tree detection; summary-block parse incl. the malformed path.
**Done when:** a writing task produces `patch.diff` in an isolated worktree and a downstream task receives its summary.

### Phase 7 — Scheduler + SSE *(~2 h)*
**Objective:** the run actually orchestrates.
**Files:** `server/src/scheduler/scheduler.ts` · `server/src/bus/index.ts` · `server/src/http/events.ts` · `web/src/pages/Execution.tsx` · `web/src/hooks/useRunEvents.ts`
**APIs:** `POST /api/runs/:id/start`, `/cancel`, `GET /api/runs/:id/events`
**Tests:** ready-set ordering on a fixture DAG; failure → dependents `blocked`; concurrency cap respected; cancellation kills the group.
**Done when:** a 4-task plan executes with visible parallelism and live updates.

### Phase 8 — Usage + baseline *(~1.5 h)*
**Objective:** the economics story.
**Files:** `server/src/usage/{cost.ts,aggregate.ts,baseline.ts}` · `server/src/http/usage.ts` · `web/src/pages/Usage.tsx` · `web/src/components/{UsageBars,BaselinePanel}.tsx`
**Tests:** exact-vs-derived-vs-unknown resolution; excluded tasks removed from **both** sides of the baseline; totals match the sum of task rows.
**Done when:** Usage shows cost/tokens by model and baseline vs actual with the assumptions block.

### Phase 9 — EverOS memory *(~1.5 h)*
**Objective:** memory that changes the next plan.
**Files:** `server/src/memory/{client.ts,write.ts,read.ts,outbox.ts}` · `server/src/http/memory.ts` · Settings panel
**APIs:** `GET /api/memory/status`, `POST /api/memory/retry`
**Tests:** client against a mocked EverOS (add/flush/search); health-fail → outbox, run unaffected.
**Done when:** run twice on one repo and the second plan's `rationale_summary` cites prior memory.

### Phase 10 — Demo polish *(~1 h)*
Dashboard, seed script for a demo repo, empty/error states, README with the exact demo script, a `demo:reset` command.

---

## 34. File-by-file proposed changes

```
plan.md                                  this document
package.json                             workspaces, dev/build/test scripts
pnpm-workspace.yaml
tsconfig.base.json
.gitignore                               node_modules, dist, .env, .worktrees

packages/core/src/
  plan.ts            Zod ExecutionPlan + PlannedTask; JSON Schema export
  catalog.ts         ModelCatalogEntry, HarnessId, ModelId types
  events.ts          SSE event union
  usage.ts           NormalizedUsage, CostResolution
  index.ts

server/src/
  index.ts           Hono app, 127.0.0.1 bind, static SPA in prod
  db/schema.sql      DDL from §28
  db/index.ts        node:sqlite open, pragma, idempotent migrate, typed helpers
  http/{workspaces,runs,events,models,skills,harnesses,usage,memory}.ts
  workspace/{register,profile,git,worktree}.ts
  catalog/{seed,index}.ts
  skills/discover.ts                     scan workspace + user locations (§10)
  skills/normalize.ts                    SKILL.md front-matter + flat .md → Skill
  skills/registry.ts                     precedence resolution, mtime/hash cache
  skills/resolve.ts                      id[] → instruction text at packet-build time
  skills/builtin/*.md                    FALLBACK ONLY — shadowed by workspace/user
  planner/{prompt,run,validate}.ts
  planner/plan.schema.json               generated from Zod at build
  scheduler/scheduler.ts
  harness/{types,supervisor,detect,claude,codex,gemini,index}.ts
  context/{build,render,summary}.ts
  usage/{normalize,cost,aggregate,baseline}.ts
  memory/{client,write,read,outbox}.ts
  bus/index.ts
  util/{redact,ndjson,ids}.ts

web/src/
  main.tsx, App.tsx, api/client.ts, hooks/useRunEvents.ts
  pages/{Dashboard,NewRun,PlanView,Execution,Usage,Settings}.tsx
  components/{PlanGraph,AgentCard,Cost,EventLog,UsageBars,BaselinePanel,HarnessStatus}.tsx
  styles.css

server/test/fixtures/
  claude-stream.ndjson  codex-events.jsonl  gemini-output.json  plan-valid.json
  plan-cycle.json       plan-unknown-model.json
```

---

## 35. Dependencies to add

**Server:** `hono`, `@hono/node-server`, `zod`, `zod-to-json-schema`, `nanoid`
**Web:** `react`, `react-dom`, `react-router-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`
**Dev:** `typescript`, `tsx`, `vitest`, `@types/node`

**Deliberately not added:** a SQLite driver (`node:sqlite` is built in), a charting library (CSS grid bars), a graph-layout library (topological columns), a state manager (SSE + `useState` suffices), a component library, `snowflake-sdk` (§24), `@anthropic-ai/claude-agent-sdk` (the CLI is the interface, and it gives us `total_cost_usd` for free).

Total new direct dependencies: **~13.** Small on purpose — every dependency is a hackathon risk.

---

## 36. Testing strategy

**Vitest**, unit-first. The rule: *anything that spends money is behind a fixture.*

- **Schema/validation (highest value)** — cycles, unknown ids, permission/worktree contradictions, `context_from ⊄ dependencies`, budget overrun. Fixture plans, zero API calls.
- **Plan immutability boundary** — assert the `ExecutionPlan` Zod schema contains **no** runtime key (`status`, `started_at`, `completed_at`, `cost_usd`, `input_tokens`, `worktree_path`, `exit_code`); assert a written `plan.json` is mode `0444` and that a re-plan creates a new run rather than mutating the existing file.
- **Skill registry** — precedence across all five locations; workspace skill shadows same-id built-in; malformed front-matter skipped not thrown; **`model:` in a skill file is rejected**; `Skill` type has no `model`/`harness` key; mtime/hash change forces a re-read; instruction text is resolved from the source path, not from the DB.
- **Worker/subagent boundary** — assert no adapter passes `--agents`, and that the Agent tool never appears in a worker's `--allowedTools`.
- **Adapter parsers** — checked-in stdout fixtures per harness → expected `NormalizedUsage`. Catches the Codex-cumulative and Gemini-`total` traps that would otherwise silently corrupt every cost number.
- **Cost + baseline** — exact/derived/unknown resolution; excluded tasks removed from both sides; aggregates match row sums.
- **Scheduler** — fixture DAG: ready-set order, concurrency cap, failure→`blocked` propagation, cancellation.
- **Git/worktree** — against a `mkdtemp` repo: create, diff, dirty detection, remove.
- **Security guardrail** — assert no adapter's argv can contain `--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, or `--yolo`.
- **EverOS client** — against a stubbed HTTP server; assert graceful degradation.
- **One live smoke test**, `pnpm test:live`, excluded from the default run: a trivial read-only task per harness, asserting exit 0 and non-zero tokens. **Run this first at implementation time** to confirm the three output schemas against the installed CLI versions before building parsers on top of them.

No E2E browser tests — wrong cost/benefit at this timescale.

---

## 37. Demo flow

*Target: 4 minutes.*

1. **Settings (25s)** — three harnesses detected, versions, authenticated: *"everything runs locally; the app never holds a provider key."* Scroll to Skills: they were **discovered** from the repo's own `.claude/skills/` and from user-level directories, shown with their real source paths. *"We didn't invent a skill format — we read the ones you already have. And none of them names a model: a skill is knowledge; the planner decides who applies it."*
2. **New Run (20s)** — select a prepared TypeScript repo. Goal: *"Find and fix the race condition in quote submission, and add a regression test."* Click **Create Plan**.
3. **Plan View (75s) — the centrepiece.** The DAG appears *before anything executes*. Walk one card: Explorer on Gemini Flash, read-only, `repo-exploration` skill — *"cheap model, this is scanning."* Then Architect on Claude Opus 5 — *"expensive model, the reasoning here is high-leverage."* Then Implementer on Codex `gpt-5.6-sol` in a dedicated worktree. Then Reviewer on Claude Sonnet 5 with the diff. **Read one `model_rationale` aloud.** "This isn't a router picking a model per prompt — the planner allocated a team, and it decided the split and the staffing in the same breath." Then open `~/.agentplan/runs/<id>/plan.json` in a terminal: *"this file is the product. It's frozen — nothing downstream can edit it, which is exactly why we can later ask whether the allocation was any good."*
4. **Execution (60s)** — Start Run. Two agents go green in parallel. Tokens and cost tick up live. Point at the worktree path: *"the implementer is writing in an isolated git worktree; nothing else can stomp it."*
5. **Result (20s)** — open `patch.diff` and the reviewer's summary.
6. **Usage (40s)** — cost by model; four different models on one goal. Baseline $1.84 → actual $0.42, 77% saved. **Point at the assumptions line**: "estimated, token counts held constant, one task excluded — we're not going to hand-wave the number."
7. **Memory (30s)** — re-run the same goal. The new plan's rationale cites prior EverOS memory: *"Codex handled bounded test-writing on this repo successfully."* Open `~/.everos` and show the Markdown file. "The memory is a file you own, not a vendor's database."

---

## 38. Risks and unknowns

| Risk | Severity | Mitigation |
|---|---|---|
| **Harness output schemas differ from docs on the installed versions** | **High** | Run `pnpm test:live` on day 1 and capture real fixtures *before* writing parsers. This is the single highest-value first action. |
| Codex/Gemini token fields shift between versions | Med | Parsers are defensive: missing field → 0 + a warn log, never a crash |
| Subscription auth means no true marginal cost | Med | Labelled everywhere (§21/22). Turned into a *credibility* asset by being explicit rather than a weakness |
| Planner emits a plausible but unexecutable plan | Med | Five validation gates + one bounded re-plan |
| Planner is slow (frontier + repo reads) | Med | `--effort high` not `max`; `--max-budget-usd`; the UI streams "planning…" with elapsed time |
| EverOS needs OpenRouter + DeepInfra keys | **Med-High** | **Verify on day 1.** Outbox + graceful degradation means the demo survives without it, but the EverMind story doesn't — so confirm keys early |
| `node:sqlite` is flagged experimental | Low | Verified working on Node 25.1.0; `better-sqlite3` is a same-API fallback |
| Worktree churn / branch-name collisions | Low | Run-scoped branch names; suffix-and-retry once |
| Parallel CLIs hit provider rate limits | Low-Med | Default concurrency 3; per-task failures don't kill the run |
| DAG visualization eats the schedule | Med | Layered columns, not force-directed. Timeboxed to Phase 4; a plain list is the acceptable fallback |
| Two of four agents write to the same files | Low | Planner is instructed toward disjoint file sets; worktrees make collisions non-destructive; no auto-merge |
| Snowflake absence costs judging points | Med | User's call. Mitigated by a sync-ready schema (§24) and an honest "here's the 60-line addition" answer if asked |

**Open unknowns to resolve on day 1:** exact `structured_output` placement in the `claude -p --json-schema --output-format json` payload; whether `gemini --output-format json` includes `stats` on every run or only with tool use; whether Codex `--output-schema` is worth using for implementer tasks or whether the prompted summary contract is enough.

---

## 39. Explicit non-goals

- Hosted/multi-user SaaS, auth, RBAC.
- A generic model-routing gateway or an OpenRouter-style API.
- Reimplementing any coding agent's inner loop.
- Automatic merging, rebasing, or conflict resolution.
- Automatic replanning or escalation at runtime (schema field only).
- Container/VM sandboxing beyond each harness's own sandbox flags.
- Fine-grained benchmark scores for models — we ship curated tags and say so.
- **Skills that carry a model or harness.** Structurally prohibited (§10), not merely discouraged.
- **An app-owned skill format.** We read `.agents/skills/` and `.claude/skills/` as they are; we do not define a competing one or import copies into the app.
- **Claude Code native subagents as the execution unit.** Workers are separate processes behind adapters (§11).
- Mutating a plan after validation — a re-plan creates a new run.
- Chain-of-thought display.
- Cost figures presented as exact when they are estimated.
- **Snowflake integration** (per user decision; schema kept sync-ready).
- Windows support (macOS/Linux; POSIX process groups assumed).

---

## 40. Post-hackathon extensions

1. **Snowflake telemetry sync** — the `synced_at` outbox drain described in §24. First on the list.
2. **Runtime escalation** — execute the `escalation` field: on failure, retry on a stronger model and record the delta as evidence for the catalog.
3. **Learned routing priors** — use accumulated EverOS memory to propose catalog tag adjustments per repo/task shape.
4. **Real A/B cost evidence** — run the same goal under the routed plan and an all-frontier plan and measure the true difference, replacing the held-constant-tokens assumption in §22.
5. **Merge assistance** — sequential worktree integration with conflict *detection* (still never auto-resolution).
6. **More harnesses** — `opencode` is already installed on this machine; the adapter interface takes it without redesign.
7. **Local models** — the catalog already has a `local` flag; an Ollama harness fits the same interface.
8. **Prompt-cache-aware planning** — order context packets so sibling tasks share a cacheable prefix.
9. **Plan diffing** — show what changed between re-plans of the same goal.
10. **OS keychain** — for the day a first-party API key is genuinely required.

---

## Verification

**Static:** `pnpm -r typecheck` · `pnpm -r test` (all fixture-driven, no spend).

**Live smoke — run this FIRST, before building parsers:**
```bash
# Confirm each harness's real output shape on the installed versions
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
4. New Run → goal → **Create Plan**; confirm ≥3 tasks, ≥2 distinct harnesses, every task has a `model_rationale`.
5. Plan View: DAG, dependencies, permissions, estimates all render.
6. **Start Run**; confirm real parallelism, live token/cost ticks, and a worktree at `<repo>/.worktrees/<runId>/<taskId>`.
7. Inspect `patch.diff` and `summary.json` under `~/.agentplan/runs/<runId>/tasks/<taskId>/`.
8. Usage: per-model cost, provenance badges, baseline vs actual with assumptions.
9. **Cancel test:** start a run, cancel mid-flight; confirm no orphaned processes (`pgrep -f codex`) and that worktrees survive.
10. **Restart test:** kill the server mid-run, restart; confirm the run is marked `failed (interrupted_by_restart)` and history is intact.
11. **Memory test:** re-run the same goal; confirm the new plan cites prior memory and `~/.everos` contains the Markdown.

---

## Recommended Hackathon Build Order

The smallest sequence that yields a real, demoable system. Build strictly in order; each step is demoable on its own.

### MUST HAVE — without these there is no product
1. **Live smoke test of all three CLIs + EverOS; capture real output fixtures.** *(30 min)* Everything downstream is built on these schemas. Do this before writing any parser.
2. **Phase 0 scaffold** — `pnpm dev` boots. *(45 min)*
3. **Phase 1 persistence + workspace registration** with git profiling. *(1 h)*
4. **Phase 2 catalog + skill discovery + harness detection.** *(1.5 h)*
5. **Phase 3 plan schema + planner + validation + frozen `plan.json`.** *(2 h)* — **the core differentiator.**
6. **Phase 4 Plan View** with per-task model/harness/skills/deps/**rationale**. *(1.5 h)* — the screen the demo is built around.
7. **Phase 5 adapters** for **at least Claude Code + one other**. *(2.5 h)*
8. **Phase 6 worktrees + context packets.** *(1.5 h)*
9. **Phase 7 scheduler + SSE Execution view.** *(2 h)*
10. **Phase 8 usage + baseline vs actual.** *(1.5 h)* — Track 1 requires the cost story.

*Cumulative: ~14.5 h. This is a complete, honest, demoable submission.*

### SHOULD HAVE — materially better submission
11. **Phase 9 EverOS memory** (write + read + memory-visible-in-second-plan). *(1.5 h)* — the sponsor requirement and the strongest narrative beat. Promote above #10 if EverOS keys are confirmed working early.
12. **Third harness adapter** (Gemini), so the plan visibly spans three providers. *(45 min)*
13. **`<PlanGraph>` upgrade** from list to layered DAG with edges. *(45 min)*
14. **Dashboard + run history.** *(45 min)*
15. **Cancellation + restart recovery.** *(45 min)*

### CUT IF TIME IS SHORT — in this order
16. **Dashboard page** → the Usage page covers it.
17. **DAG edges** → an indented, dependency-grouped list reads fine at projector distance.
18. **Third harness** → two harnesses already prove heterogeneous assignment.
19. **Model catalog editing UI** → seed-only; edit the DB directly.
20. **Artifact viewer in-app** → open files in an editor during the demo.
21. **Outbox retry UI** → log-only.
22. **Redaction pass** → keep the demo repo secret-free instead.
23. **Restart recovery** → don't kill the server during the demo.
24. **Escalation, replanning, plan diffing, merge assistance** → already non-goals.

**The one-line fallback if everything slips:** an immutable `plan.json` that visibly assigns **different models on different harnesses** to different work units — each with selected skills and a written rationale — then executes across at least two harnesses as separate processes, with a per-model cost breakdown. That is the whole idea. Ship that and cut everything else.
