import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runWorker } from "../adapters/index.js";
import { assignableModels, loadCatalog } from "../core/catalog.js";
import { applyProbes, harnessOf, probeHarnesses } from "../core/probe.js";
import { writeRosterCache } from "../core/roster.js";
import { completeDelegation, insertDelegation, openStore } from "../core/store.js";
import type { ModelCatalogEntry } from "../core/types.js";

/** stdout is the MCP transport — every diagnostic must go to stderr. */
function log(message: string): void {
  process.stderr.write(`[agentplan-mcp] ${message}\n`);
}

function roster(models: ModelCatalogEntry[]): string {
  return models
    .map((m) => {
      const price =
        m.price_input_per_mtok === null
          ? m.price_source === "local-no-marginal-cost"
            ? "free (local GPU)"
            : "no marginal cost (subscription)"
          : `$${m.price_input_per_mtok}/$${m.price_output_per_mtok} per Mtok`;
      const ctx =
        m.context_window >= 1_000_000
          ? `${m.context_window / 1_000_000}M`
          : `${Math.floor(m.context_window / 1000)}k`;
      return `- ${m.id} (${harnessOf(m)}, ${ctx} ctx, ${price}, ${m.cost_tier} cost): ${m.capabilities.join(", ")}. ${m.reliability_notes}`;
    })
    .join("\n");
}

export async function startMcpServer(): Promise<void> {
  const models = applyProbes(loadCatalog(), await probeHarnesses());
  const assignable = assignableModels(models);
  const byId = new Map(assignable.map((m) => [m.id, m]));
  const ids = assignable.map((m) => m.id);

  writeRosterCache(models);
  log(`${ids.length} models assignable: ${ids.join(", ") || "(none)"}`);

  const db = openStore();

  // Claude Code spawns one MCP server process per session, so this process IS
  // the session. That identity is reliable; CLAUDE_SESSION_ID is not set here.
  const sessionId = `s_${randomBytes(4).toString("hex")}`;
  log(`session ${sessionId} in ${process.cwd()}`);

  const server = new McpServer({ name: "agentplan", version: "0.1.0" });

  server.registerTool(
    "delegate",
    {
      title: "Delegate a subtask to a cheaper model",
      description:
        "Hand a bounded, self-contained subtask to a cheaper or more specialised " +
        "model instead of doing it yourself. The worker runs read-only in the " +
        "current directory with file-reading and search tools, and returns its " +
        "findings as text.\n\n" +
        "Delegate work that is mechanical, wide, or well-specified: scanning a " +
        "codebase, enumerating call sites, extracting facts, summarising files, " +
        "drafting bounded text. Keep for yourself anything needing judgement " +
        "across the whole task, or that must write files.\n\n" +
        "Pick the cheapest model that can actually do the work, and respect " +
        "context windows — a task requiring broad reading must not go to a " +
        "small-window model.\n\nAVAILABLE MODELS\n" +
        (ids.length > 0 ? roster(assignable) : "(none available — check the dashboard)"),
      inputSchema: {
        task: z
          .string()
          .describe(
            "The complete, self-contained instruction for the worker. It sees " +
              "none of this conversation, so include everything it needs.",
          ),
        model_id:
          ids.length > 0
            ? z.enum(ids as [string, ...string[]]).describe("Which model runs this subtask.")
            : z.string().describe("Which model runs this subtask."),
      },
    },
    async ({ task, model_id }) => {
      const model = byId.get(model_id);
      if (!model) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Model "${model_id}" is not enabled or not available. Enabled right now: ${ids.join(", ") || "(none)"}.`,
            },
          ],
        };
      }

      const id = `d_${randomBytes(6).toString("hex")}`;
      const cwd = process.cwd();
      insertDelegation(db, {
        id,
        session_id: sessionId,
        cwd,
        task,
        model_id,
        harness: harnessOf(model),
      });
      log(`${id} → ${model_id} (${harnessOf(model)})`);

      const started = Date.now();
      try {
        const result = await runWorker(model, task, cwd);
        completeDelegation(db, id, {
          status: "completed",
          durationMs: Date.now() - started,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          costIsExact: result.costIsExact,
          summary: result.text.slice(0, 400),
        });
        log(`${id} completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return { content: [{ type: "text" as const, text: result.text }] };
      } catch (err) {
        const message = (err as Error).message;
        completeDelegation(db, id, {
          status: "failed",
          durationMs: Date.now() - started,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          costIsExact: false,
          error: message,
        });
        log(`${id} failed: ${message}`);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Delegation failed: ${message}` }],
        };
      }
    },
  );

  await server.connect(new StdioServerTransport());
  log("connected");
}
