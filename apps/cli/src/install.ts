import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_BIN = join(PKG_ROOT, "node_modules", ".bin", "tsx");
const CLI = join(PKG_ROOT, "src", "cli.tsx");
const HOOK_SCRIPT = join(PKG_ROOT, "src", "hooks", "roster.mjs");
const SETTINGS = join(homedir(), ".claude", "settings.json");

const HOOK_COMMAND = `node ${HOOK_SCRIPT}`;

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

export function describeInstall(): string {
  return [
    "This changes global Claude Code configuration and affects EVERY session on this machine.",
    "",
    "1. Registers an MCP server at user scope:",
    `     claude mcp add agentplan --scope user -- ${TSX_BIN} ${CLI} mcp`,
    "",
    `2. Adds a UserPromptSubmit hook to ${SETTINGS}:`,
    `     ${HOOK_COMMAND}`,
    "   (existing hooks are preserved; a .backup copy is written first)",
    "",
    "Undo:",
    "     claude mcp remove agentplan --scope user",
    "     remove the agentplan entry from hooks.UserPromptSubmit in settings.json",
  ].join("\n");
}

export function install(): void {
  process.stdout.write(`${describeInstall()}\n\n`);

  process.stdout.write("registering MCP server…\n");
  execFileSync(
    "claude",
    ["mcp", "add", "agentplan", "--scope", "user", "--", TSX_BIN, CLI, "mcp"],
    { stdio: "inherit" },
  );

  process.stdout.write("adding UserPromptSubmit hook…\n");
  const settings: Record<string, unknown> = existsSync(SETTINGS)
    ? (JSON.parse(readFileSync(SETTINGS, "utf8")) as Record<string, unknown>)
    : {};

  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.backup`);

  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const existing = hooks.UserPromptSubmit ?? [];

  const alreadyThere = existing.some((entry) =>
    entry.hooks.some((h) => h.command.includes("roster.mjs")),
  );
  if (alreadyThere) {
    process.stdout.write("hook already present — leaving settings.json untouched\n");
    return;
  }

  hooks.UserPromptSubmit = [
    ...existing,
    { matcher: "", hooks: [{ type: "command", command: HOOK_COMMAND }] },
  ];
  settings.hooks = hooks;
  writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  process.stdout.write(
    "\ndone. Restart any running Claude Code sessions to pick up both changes.\n",
  );
}
