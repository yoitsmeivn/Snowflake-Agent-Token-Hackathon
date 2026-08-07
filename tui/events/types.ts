import type { RoutingEvent as RoutingSnapshot } from "../../shared/types";

export type { RoutingSnapshot };
export type { Task, TaskStatus, ModelRef } from "../../shared/types";

export type ConnectionStatus = "connecting" | "connected" | "error";

/**
 * One step of an orchestration run.
 *
 * Each event carries a *complete* snapshot of run state rather than a delta.
 * That keeps the UI a pure function of the latest event — no reducer, no
 * accumulated state to get out of sync — and a real scheduler can emit the
 * same shape by serialising whatever it currently holds.
 */
export interface RoutingEvent {
  id: string;
  /** 1-based position in the run. */
  step: number;
  /** Short narration, e.g. "Planner created 5 tasks". */
  label: string;
  /** Optional second line with more context. */
  detail?: string;
  snapshot: RoutingSnapshot;
}

/**
 * How the TUI receives orchestration events. This is the integration seam.
 *
 * TODO(scheduler): implement this against the real event bus — stdin JSON
 * stream, SSE, WebSocket, or direct in-process emitter. Then swap the instance
 * constructed in `hooks/useRouterEvents.ts`. No component touches a source
 * directly, so the UI needs no changes.
 */
export interface RoutingEventSource {
  /**
   * Advance to and return the next event. For a live source this is a no-op
   * that returns the current event — real runs advance on their own schedule.
   */
  next(): RoutingEvent;
  /** Returns an unsubscribe function. */
  subscribe(callback: (event: RoutingEvent) => void): () => void;
  /** The event currently in view. */
  current(): RoutingEvent;
  getStatus(): ConnectionStatus;
  /** True when the user can step manually (mock playback). */
  readonly supportsManualAdvance: boolean;
  /** Total steps, when known ahead of time. 0 for open-ended live runs. */
  readonly totalSteps: number;
}
