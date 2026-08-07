import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AGENTPLAN_DIR } from "./catalog.js";
import type { HarnessId } from "./types.js";

// node:sqlite emits an ExperimentalWarning on import. On the MCP transport that
// is harmless (stderr), but in the TUI it smears the first frame — so it is
// filtered before the lazy require below pulls the module in.
const originalEmit = process.emit.bind(process);
process.emit = function patchedEmit(this: unknown, ...args: unknown[]) {
  const [name, data] = args;
  if (
    name === "warning" &&
    data instanceof Error &&
    data.name === "ExperimentalWarning" &&
    data.message.includes("SQLite")
  ) {
    return false;
  }
  return (originalEmit as (...a: unknown[]) => boolean)(...args);
} as typeof process.emit;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export const DB_PATH = join(AGENTPLAN_DIR, "live.db");

export type DelegationStatus = "running" | "completed" | "failed";

export interface DelegationRow {
  id: string;
  session_id: string | null;
  cwd: string;
  task: string;
  model_id: string;
  harness: HarnessId;
  status: DelegationStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  cost_is_exact: number;
  error: string | null;
  summary: string | null;
}

/**
 * One shared log, appended to by every MCP server instance (one per Claude
 * session) and read by the dashboard. WAL is what makes that concurrency safe.
 */
export function openStore() {
  mkdirSync(AGENTPLAN_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      cwd TEXT NOT NULL,
      task TEXT NOT NULL,
      model_id TEXT NOT NULL,
      harness TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      cost_is_exact INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      summary TEXT
    )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_started ON delegations(started_at DESC)");
  return db;
}

export function insertDelegation(
  db: ReturnType<typeof openStore>,
  row: Pick<DelegationRow, "id" | "session_id" | "cwd" | "task" | "model_id" | "harness">,
): void {
  db.prepare(
    `INSERT INTO delegations (id, session_id, cwd, task, model_id, harness, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
  ).run(
    row.id,
    row.session_id,
    row.cwd,
    row.task,
    row.model_id,
    row.harness,
    new Date().toISOString(),
  );
}

export function completeDelegation(
  db: ReturnType<typeof openStore>,
  id: string,
  result: {
    status: "completed" | "failed";
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    costIsExact: boolean;
    error?: string;
    summary?: string;
  },
): void {
  db.prepare(
    `UPDATE delegations SET status = ?, completed_at = ?, duration_ms = ?,
       input_tokens = ?, output_tokens = ?, cost_usd = ?, cost_is_exact = ?,
       error = ?, summary = ? WHERE id = ?`,
  ).run(
    result.status,
    new Date().toISOString(),
    result.durationMs,
    result.inputTokens,
    result.outputTokens,
    result.costUsd,
    result.costIsExact ? 1 : 0,
    result.error ?? null,
    result.summary ?? null,
    id,
  );
}

export function recentDelegations(
  db: ReturnType<typeof openStore>,
  limit = 40,
): DelegationRow[] {
  return db
    .prepare("SELECT * FROM delegations ORDER BY started_at DESC LIMIT ?")
    .all(limit) as unknown as DelegationRow[];
}

export interface ModelTotals {
  model_id: string;
  harness: HarnessId;
  runs: number;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export function totalsByModel(db: ReturnType<typeof openStore>): ModelTotals[] {
  return db
    .prepare(
      `SELECT model_id, harness, COUNT(*) AS runs, SUM(cost_usd) AS cost_usd,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM delegations GROUP BY model_id, harness ORDER BY runs DESC`,
    )
    .all() as unknown as ModelTotals[];
}
