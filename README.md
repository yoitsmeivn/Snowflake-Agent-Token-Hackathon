# Snowflake × Beta Fund × EverMind — Agent & Token Economy Hackathon

Local-first coding-agent orchestration harness. See `PLAN.md` for the full architecture.

---

# EverOS Local Memory Setup

EverOS is the persistent memory layer for the Claude Code orchestrator. Every prompt
submitted in Claude Code is automatically enriched with relevant prior orchestration
experience, with no manual "search EverOS first" step:

```text
Claude Code user prompt
    ↓
UserPromptSubmit hook
    ↓
EverOS /api/v2/memory/search
    ↓
relevant agent cases / skills
    ↓
additionalContext
    ↓
Claude processes the prompt
```

> **This phase is retrieval only.** The hook reads from EverOS and never writes.
> Writing completed worker trajectories back to EverOS (`/memory/add`, `/memory/flush`)
> is a separate, later change.

Everything below was verified against this machine's actual install (EverOS **1.2.3**).

## Prerequisites

- **Python 3.12+** — EverOS requires it.
- **[`uv`](https://github.com/astral-sh/uv)** — used for the venv and install.
- **An OpenAI API key** — this project points EverOS's LLM and embedding providers
  directly at OpenAI. (EverOS's generated config template defaults to OpenRouter and
  DeepInfra; we override those. Neither is required here.)
- **Node.js 18+** — for the Claude Code hook. No npm packages are installed.
- A **local EverOS server**, running while you use Claude Code.

## Installation

```bash
uv venv .venv-everos --python 3.12
source .venv-everos/bin/activate
uv pip install everos
everos --help
everos init
```

`everos init` writes two starter config files:

```text
~/.everos/everos.toml
~/.everos/ome.toml
```

> There is **no `--xdg` flag** in EverOS 1.2.3. `everos init` accepts `--root`,
> `--force`, `--print`, and `--verbose`. Use `everos init --root <dir>` to write
> elsewhere. (Some public docs describe `--xdg`; it does not exist in this version.)

## Configuration

Edit `~/.everos/everos.toml`. Only these sections matter for this project:

```toml
[llm]
model = "gpt-4.1-mini"
api_key = "<OPENAI_API_KEY>"
base_url = "https://api.openai.com/v1"

[embedding]
model = "text-embedding-3-small"
api_key = "<OPENAI_API_KEY>"
base_url = "https://api.openai.com/v1"
timeout_seconds = 30.0
max_retries = 3
batch_size = 10
max_concurrent = 5

[memorize]
mode = "agent"
```

What these do:

- **`[llm]`** is EverOS's *internal* memory-extraction model — it distils conversations
  into memory. It is **not** the model assigned to coding workers; worker model
  assignment is a separate concern owned by the orchestration planner.
- **`[embedding]`** powers searchable memory (vector indexing).
- **`mode = "agent"`** enables the agent-memory track, which is what produces the
  `agent_case` and `agent_skill` records this integration retrieves.

### About `[rerank]` and `[multimodal]`

`everos init` scaffolds **four** provider sections — `[llm]`, `[embedding]`,
`[multimodal]`, `[rerank]` — all pre-pointed at OpenRouter / DeepInfra with placeholder
API keys. This project overrides `[llm]` and `[embedding]` to use OpenAI directly and
**leaves `[multimodal]` and `[rerank]` at their scaffold defaults**.

Because those two never receive a valid key, EverOS reports them as unavailable
(`rerank: false`, `multimodal_llm: false`). That is expected and fine here — so the
sections remain in the file but are inactive. Neither is needed for this integration.

> Keep your real API keys in `~/.everos/everos.toml`. Never put them in this repository.

## Start EverOS

```bash
source .venv-everos/bin/activate
everos server start
```

Leave it running in its own terminal. In another terminal:

```bash
curl http://127.0.0.1:8000/health
```

Verified response on this setup:

```json
{
  "status": "ok",
  "version": "1.2.3",
  "capabilities": {
    "llm": true,
    "embed": true,
    "rerank": false,
    "multimodal_llm": false,
    "parser": true
  },
  "disabled_features": ["agentic_search", "knowledge", "multimodal_upload"]
}
```

Reading that:

- **`llm: true` and `embed: true`** are the only capabilities this integration needs.
- **`rerank: false`** is intentional — see above.
- **`multimodal_llm: false`** is intentional.
- **`agentic_search` and `multimodal_upload` disabled** is acceptable; the hook uses
  neither.

## Claude Code integration

The project registers a `UserPromptSubmit` hook in:

```text
.claude/settings.json
```

which executes:

```text
.claude/hooks/everos-context.mjs
```

The hook is a single dependency-free ES module run by `node` — no build step, no
`npx`, no packages installed.

On **every** submitted Claude Code prompt (including prompts submitted in plan mode),
the hook:

1. reads the prompt and `cwd` from Claude Code's hook JSON on stdin;
2. derives a stable project ID from the Git workspace root;
3. queries the local EverOS v2 API;
4. searches the agent-memory track as `agent_id = "coding-orchestrator"`;
5. scopes to `app_id = "agentplan"`;
6. retrieves up to 5 relevant agent cases / skills;
7. injects only bounded, useful results through `additionalContext`;
8. **fails open** if EverOS is unavailable — the prompt always goes through.

### Request

```json
{
  "agent_id": "coding-orchestrator",
  "app_id": "agentplan",
  "project_id": "<stable-workspace-id>",
  "query": "<submitted prompt>",
  "method": "keyword",
  "top_k": 5,
  "enable_llm_rerank": false
}
```

`project_id` is derived from the Git repository root (basename plus a short hash of the
root path), sanitized to EverOS's scope charset. It is stable across prompts and across
subdirectories of the same repo, and never contains the absolute path.

### Why `method: "keyword"`

- **Hybrid agent-memory retrieval is unavailable in this configuration.** EverOS's
  `agent_hybrid` path requires the rerank provider, which is not enabled here; requesting
  `method: "hybrid"` returns `HTTP 422 PROVIDER_NOT_CONFIGURED`.
- **Keyword retrieval is very fast** — measured at 7–10 ms locally, so it keeps every
  Claude prompt responsive. `vector` needs a query-embedding round trip (~0.5 s warm,
  ~2.4 s cold), which would exceed the hook's timeout on the first prompt after idle.
- This can be revisited once a rerank provider is configured.

> **Retrieval is currently lexical (BM25), not semantic.** Matching is on word overlap
> between your prompt and stored memories. Set `EVEROS_METHOD=hybrid` to switch once
> `[rerank]` is configured — at the cost of added per-prompt latency.

### Environment overrides

All optional; production defaults are built in.

| Variable | Default | Purpose |
|---|---|---|
| `EVEROS_URL` | `http://127.0.0.1:8000` | EverOS base URL |
| `EVEROS_AGENT_ID` | `coding-orchestrator` | Agent-memory owner |
| `EVEROS_APP_ID` | `agentplan` | App scope |
| `EVEROS_METHOD` | `keyword` | Search method |
| `EVEROS_TOP_K` | `5` | Max results |
| `EVEROS_TIMEOUT_MS` | `1500` | HTTP timeout |
| `EVEROS_PROJECT_ID` | *(derived)* | Override the workspace scope |
| `EVEROS_HOOK_DEBUG` | *(unset)* | Emit diagnostics on stderr |

## Testing

```bash
node --test .claude/hooks/everos-context.test.mjs
```

Uses Node's built-in test runner — no dependencies and no `package.json`. All tests
inject `fetch` and `git`, so none touch the network or the live EverOS server.

> Pass the test **file**, not the directory: `node --test .claude/hooks/` fails because
> Node does not auto-discover test files inside a dot-directory.

Automated coverage:

- successful memory retrieval;
- agent cases;
- agent skills;
- empty results;
- server unavailable;
- timeout;
- malformed responses;
- non-2xx responses (including the real `422 PROVIDER_NOT_CONFIGURED` body);
- project ID sanitization;
- context bounding and truncation;
- request-body shape;
- no prompt echo, no metadata leakage.

### Debugging

To see what the hook is doing, run it directly with a sample payload:

```bash
printf '{"cwd":"%s","hook_event_name":"UserPromptSubmit","prompt":"test prompt"}' "$PWD" \
  | EVEROS_HOOK_DEBUG=1 node .claude/hooks/everos-context.mjs
```

Diagnostics go to **stderr** (stdout is reserved for the hook protocol), e.g.
`[everos-hook] ok: 0 case(s), 0 skill(s)`.

> `EVEROS_HOOK_DEBUG=1 claude` does set the variable and the hook does receive it —
> environment is inherited by hooks — but **Claude Code does not surface hook stderr**,
> so you will not see the diagnostics there. Use the piped form above instead.

With no memories stored yet, the hook correctly emits **nothing** and exits 0. Silence
means either "working, no hits" or "EverOS unreachable"; the debug output distinguishes
them.

## Security / local-only notes

- EverOS stays bound to **`127.0.0.1:8000`**. Do not change the host to `0.0.0.0`.
- **EverOS ships without built-in auth**, so it must not be exposed externally. Anything
  that can reach the port can read your memory.
- API keys live in **`~/.everos/everos.toml`**, outside this repository. Never commit
  them, and never copy them into application files.
- The hook talks only to the local server and holds no credentials of its own.
- **`.venv-everos/` must not be committed** — it is already in `.gitignore`.
