# Token Router — Terminal Monitor

Interactive TUI that visualizes an agent orchestration run: tasks created,
models assigned, harnesses used, token usage, and cost savings.

Runs in a second terminal alongside Claude Code. Built with Ink — it is a
terminal application, not a web view.

```bash
cd tui
npm install
npm run dev
```

Requires Node ≥ 22 (Ink 7) and a real TTY.

## Controls

| Key   | Action                        |
| ----- | ----------------------------- |
| `n`   | Advance to the next event     |
| `s`   | Toggle the settings modal     |
| `esc` | Close the modal               |
| `q`   | Quit                          |

The mock run has 8 steps and wraps, so the demo can be replayed without
restarting.

## What the run shows

A scripted orchestration of "build an authentication system" across 5 tasks,
5 models, and 3 harnesses (`claude-code`, `gemini-cli`, `codex`). Tasks appear
progressively: the planner creates them, each is dispatched in turn, and
metrics climb as work completes. It ends at **73% saved** against a
single-model baseline.

The run deliberately covers every task state — including a cache hit on the
repository scan and a failed test suite — so all five status icons appear:

| Icon | State     | Color  |
| ---- | --------- | ------ |
| `○`  | Queued    | gray   |
| `●`  | Running   | yellow |
| `✓`  | Completed | green  |
| `✕`  | Failed    | red    |
| `◈`  | Cached    | blue   |

Green is reserved for savings and completed work. Everything else is gray.

## Architecture

```
tui/
├── index.tsx                  render entry
├── App.tsx                    layout + keyboard handling
├── components/                Header, SavingsHero, Metrics, TaskList,
│                              TaskCard, StatusBadge, SettingsModal, Footer
├── events/
│   ├── types.ts               RoutingEventSource — the integration seam
│   └── MockEventSource.ts     scripted run
├── hooks/
│   ├── useRouterEvents.ts     binds a source to React
│   └── useTerminalWidth.ts
└── lib/format.ts
```

### Going live

`events/types.ts` defines the seam:

```ts
interface RoutingEventSource {
  next(): RoutingEvent;
  subscribe(callback: (event: RoutingEvent) => void): () => void;
  current(): RoutingEvent;
  getStatus(): ConnectionStatus;
  readonly supportsManualAdvance: boolean;
  readonly totalSteps: number;
}
```

To replace mock playback with real scheduler events:

1. Implement that interface over your transport — stdin JSON stream, SSE,
   WebSocket, or a direct in-process emitter.
2. Swap the instance constructed in `hooks/useRouterEvents.ts`.

That is the entire change. **No component imports the mock or the source**;
they receive a `RoutingEvent` as props from `App.tsx`.

Each event carries a *complete snapshot* of run state rather than a delta, so
the UI stays a pure function of the latest event — no reducer, nothing to fall
out of sync. A live scheduler emits the same shape by serialising whatever it
currently holds. Set `supportsManualAdvance: false` for a live source and the
`n` control disappears on its own.

### Shared contract

Task, model, and cost shapes come from `../shared/types.ts`, the same contract
the web frontend uses, so the two consumers can't drift. `harness` was added
there as an optional field for this work.

Imports are relative and type-only. Unlike `frontend/`, the TUI has no bundler
root restriction, so this is a plain TypeScript import with nothing special
about it.

## Cost figures

`MockEventSource` computes costs from a local pricing table rather than
hardcoding them, so displayed numbers are always self-consistent: tokens × rate
= cost, tasks sum to the summary, savings match the baseline. Running tasks
contribute half their eventual tokens, which is what makes metrics climb during
the run instead of jumping at the end.

A real source will receive these figures from the engine and simply pass them
through — the UI never computes cost.

## Settings modal

UI scaffolding only. Fields are display-only placeholders: nothing is read from
the environment, stored, validated, or sent anywhere.

## Not built

Real Claude/Codex/Gemini execution, scheduler, worktrees, persistence, and any
network layer. This is the presentation foundation only.
