#!/usr/bin/env node
// UserPromptSubmit hook. Runs on EVERY message in EVERY Claude session, so it
// is deliberately plain JS with zero imports and zero compilation: one file
// read, one write, exit. The text it prints is prepared by the dashboard or the
// MCP server (core/roster.ts), which are the things that actually probe.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const cache = JSON.parse(
    readFileSync(join(homedir(), ".agentplan", "roster.json"), "utf8"),
  );
  if (cache.additionalContext) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: cache.additionalContext,
        },
      })}\n`,
    );
  }
} catch {
  // No roster yet, or unreadable — inject nothing rather than break the prompt.
}
