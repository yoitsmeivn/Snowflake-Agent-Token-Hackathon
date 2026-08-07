import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessOf } from "../core/probe.js";
import type { ModelCatalogEntry } from "../core/types.js";

/** A delegated subtask is read-only. The parent agent does the writing. */
const CLAUDE_TOOLS = "Read,Grep,Glob";
const PER_TASK_BUDGET_USD = "0.50";
const TIMEOUT_MS = 120_000;

/**
 * Every worker is spawned with stdin IGNORED, not piped. opencode blocks
 * forever on an open stdin pipe — verified: zero bytes of output in 5 minutes,
 * then SIGTERM. Closing stdin fixes it, and costs the other harnesses nothing.
 */
async function spawnCapture(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 400) || "(no stderr)"}`));
    });
  });
}

export interface WorkerResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costIsExact: boolean;
}

export async function runWorker(
  model: ModelCatalogEntry,
  task: string,
  cwd: string,
): Promise<WorkerResult> {
  switch (harnessOf(model)) {
    case "claude":
      return runClaude(model, task, cwd);
    case "codex":
      return runCodex(model, task, cwd);
    case "opencode":
      return runOpencode(model, task, cwd);
    case "gemini":
      throw new Error("gemini harness is not installed on this machine");
  }
}

async function runClaude(
  model: ModelCatalogEntry,
  task: string,
  cwd: string,
): Promise<WorkerResult> {
  const { stdout } = await spawnCapture(
    "claude",
    [
      "-p",
      task,
      "--model",
      model.harness_model_arg,
      "--output-format",
      "json",
      "--allowedTools",
      CLAUDE_TOOLS,
      "--permission-mode",
      "dontAsk",
      "--max-budget-usd",
      PER_TASK_BUDGET_USD,
      "--no-session-persistence",
    ],
    cwd,
  );

  const envelope = JSON.parse(stdout) as {
    result?: string;
    is_error?: boolean;
    total_cost_usd?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  if (envelope.is_error) throw new Error(envelope.result ?? "claude worker failed");

  const usage = envelope.usage;
  // `input_tokens` counts ONLY uncached input. A real run reported 10 there
  // while 13.6k was cache_creation and 20.9k cache_read — reading the bare
  // field understates the true prompt by orders of magnitude and silently
  // corrupts every baseline comparison.
  const inputTokens =
    usage === undefined
      ? null
      : (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);

  return {
    text: envelope.result ?? "",
    inputTokens,
    outputTokens: usage?.output_tokens ?? null,
    costUsd: envelope.total_cost_usd ?? null,
    costIsExact: envelope.total_cost_usd !== undefined,
  };
}

/**
 * Codex `turn.completed.usage` is cumulative, so last-event-wins; summing would
 * double-count. The final assistant message comes from --output-last-message
 * rather than being reassembled from the event stream.
 */
async function runCodex(
  model: ModelCatalogEntry,
  task: string,
  cwd: string,
): Promise<WorkerResult> {
  const lastMessagePath = join(tmpdir(), `agentplan-${randomBytes(6).toString("hex")}.txt`);
  try {
    const { stdout } = await spawnCapture(
      "codex",
      [
        "exec",
        task,
        "-m",
        model.harness_model_arg,
        "--json",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--output-last-message",
        lastMessagePath,
        "--cd",
        cwd,
      ],
      cwd,
    );

    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (event.type === "turn.completed" && event.usage) {
          inputTokens = event.usage.input_tokens ?? inputTokens;
          outputTokens = event.usage.output_tokens ?? outputTokens;
        }
      } catch {
        // Non-JSON lines are informational; skip rather than fail the worker.
      }
    }

    let text = "";
    try {
      text = readFileSync(lastMessagePath, "utf8");
    } catch {
      text = stdout.slice(-4000);
    }

    // Subscription auth: tokens are real, marginal dollar cost is not.
    return { text, inputTokens, outputTokens, costUsd: 0, costIsExact: false };
  } finally {
    rmSync(lastMessagePath, { force: true });
  }
}

/** Local vLLM. No usage reported by the CLI, and no marginal cost to report. */
async function runOpencode(
  model: ModelCatalogEntry,
  task: string,
  cwd: string,
): Promise<WorkerResult> {
  const { stdout } = await spawnCapture(
    "opencode",
    ["run", "-m", model.harness_model_arg, task],
    cwd,
  );
  return {
    text: stdout.trim(),
    inputTokens: null,
    outputTokens: null,
    costUsd: 0,
    costIsExact: true,
  };
}
