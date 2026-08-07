// Connects to our MCP server exactly as Claude Code would.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

const transport = new StdioClientTransport({
  command: join(PKG, "node_modules", ".bin", "tsx"),
  args: [join(PKG, "src", "cli.tsx"), "mcp"],
  cwd: process.env.WS ?? process.cwd(),
});

const client = new Client({ name: "mcp-check", version: "0" });
await client.connect(transport);
console.log("connected ✓");

const { tools } = await client.listTools();
for (const tool of tools) {
  console.log(`\nTOOL: ${tool.name}`);
  console.log("input schema:", JSON.stringify(tool.inputSchema, null, 1));
  console.log("description (first 300):", tool.description?.slice(0, 300));
  console.log("…roster tail:", tool.description?.slice(-420));
}

// Every "model::task" arg runs on THIS connection, i.e. one session.
for (const spec of process.argv.slice(2).filter((a) => a.includes("::"))) {
  const [model, ...rest] = spec.split("::");
  const task = rest.join("::");
  console.log(`\ncalling delegate → ${model}`);
  const t0 = Date.now();
  const result = await client.callTool(
    { name: "delegate", arguments: { task, model_id: model } },
    undefined,
    { timeout: 180_000 },
  );
  console.log(`returned in ${((Date.now() - t0) / 1000).toFixed(1)}s, isError=${result.isError}`);
  console.log(JSON.stringify(result.content).slice(0, 240));
}

await client.close();
