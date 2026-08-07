#!/usr/bin/env -S npx tsx
import { render } from "ink";
import { App } from "./tui/App.js";

const command = process.argv[2];

switch (command) {
  case "mcp": {
    // stdio is the MCP transport — nothing else may write to stdout.
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer();
    break;
  }
  case "install": {
    const { install } = await import("./install.js");
    install();
    break;
  }
  case "install-preview": {
    const { describeInstall } = await import("./install.js");
    process.stdout.write(`${describeInstall()}\n`);
    break;
  }
  case "--help":
  case "-h":
    process.stdout.write(
      [
        "agentplan                 open the dashboard (MODELS + LIVE)",
        "agentplan install         register the MCP server + hook (changes global config)",
        "agentplan install-preview show what install would change, without doing it",
        "agentplan mcp             run the MCP server on stdio (Claude Code calls this)",
        "",
      ].join("\n"),
    );
    break;
  default:
    render(<App />);
}
