import { Box, Text } from "ink";
import { homedir } from "node:os";
import { CATALOG } from "../core/catalog.js";
import { computeSavings, FRONTIER_ID } from "../core/savings.js";
import type { DelegationRow } from "../core/store.js";
import { Rule, statusColor, statusIcon } from "./components/chrome.js";
import {
  clip,
  formatCost,
  formatCostGroup,
  formatLatency,
  formatPercent,
  formatTokens,
  relativeTime,
} from "./lib/format.js";

function shortCwd(cwd: string): string {
  return cwd.startsWith(homedir()) ? `~${cwd.slice(homedir().length)}` : cwd;
}

function ctxOf(modelId: string): string {
  const model = CATALOG.find((m) => m.id === modelId);
  if (!model) return "?";
  const n = model.context_window;
  return n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.floor(n / 1000)}k`;
}

/** What this one delegation would have cost on the frontier model. */
function rowSavingsPercent(row: DelegationRow): number | null {
  if (row.input_tokens === null || row.output_tokens === null) return null;
  const frontier = CATALOG.find((m) => m.id === FRONTIER_ID);
  const baseline =
    (row.input_tokens / 1_000_000) * (frontier?.price_input_per_mtok ?? 0) +
    (row.output_tokens / 1_000_000) * (frontier?.price_output_per_mtok ?? 0);
  if (baseline <= 0) return null;
  return ((baseline - (row.cost_usd ?? 0)) / baseline) * 100;
}

interface SessionGroup {
  key: string;
  cwd: string;
  rows: DelegationRow[];
  startedAt: string;
}

/**
 * One group per originating Claude session. Claude Code spawns one MCP server
 * process per session, so session_id identifies the terminal the work came
 * from — which is what makes "where did my task get routed?" answerable.
 */
function groupBySession(rows: DelegationRow[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const row of rows) {
    const key = row.session_id ?? `legacy:${row.cwd}`;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      if (row.started_at < group.startedAt) group.startedAt = row.started_at;
    } else {
      groups.set(key, { key, cwd: row.cwd, rows: [row], startedAt: row.started_at });
    }
  }
  return [...groups.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * One arrow per delegation, main agent at the root:
 *
 *   ● main agent (claude)
 *     ├─▶ ✓ claude-haiku-4-5 · claude · 200k ctx   ▼ 92%
 *     │     "How many .py files are under tests/?"
 *     │     65,028 in · 247 out · $0.0256 · 7.7s
 *     └─▶ …
 *
 * The trunk (│) runs on continuation lines of non-final branches, so the tree
 * stays connected however tall a node's detail block gets.
 */
function SubagentNode({
  row,
  last,
  active,
  tick,
  expanded,
}: {
  row: DelegationRow;
  last: boolean;
  active: boolean;
  tick: number;
  expanded: boolean;
}) {
  const color = statusColor(row.status);
  const saved = rowSavingsPercent(row);
  const showSavings = saved !== null && saved >= 0.5;
  const trunk = last ? "  " : "│ ";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">
          {"  "}
          {last ? "└─▶ " : "├─▶ "}
        </Text>
        <Text color={color}>{statusIcon(row.status, tick)} </Text>
        <Text bold={active} color="magenta">
          {row.model_id}
        </Text>
        <Text color="gray"> · </Text>
        <Text color="blue">{row.harness}</Text>
        <Text color="gray"> · {ctxOf(row.model_id)} ctx</Text>
        {showSavings ? (
          <Text color="green">
            {"  "}▼ {formatPercent(saved)}
          </Text>
        ) : null}
        {active ? <Text color="cyan"> ◂</Text> : null}
      </Box>

      <Box>
        <Text color="gray">
          {"  "}
          {trunk}
          {"    "}
        </Text>
        <Text color={active ? undefined : "gray"} dimColor={!active}>
          "{clip(row.task, expanded && active ? 300 : 68)}"
        </Text>
      </Box>

      <Box>
        <Text color="gray">
          {"  "}
          {trunk}
          {"    "}
        </Text>
        <Text color="gray" dimColor>
          {formatTokens(row.input_tokens)} in · {formatTokens(row.output_tokens)} out ·{" "}
          {formatCost(row.cost_usd)}
          {row.cost_usd !== null && row.cost_usd > 0 && !row.cost_is_exact ? " est" : ""} ·{" "}
          {formatLatency(row.duration_ms)}
        </Text>
      </Box>

      {row.error ? (
        <Box>
          <Text color="gray">
            {"  "}
            {trunk}
            {"    "}
          </Text>
          <Text color="red">{clip(row.error, expanded && active ? 300 : 80)}</Text>
        </Box>
      ) : null}

      {expanded && active && row.summary ? (
        <Box>
          <Text color="gray">
            {"  "}
            {trunk}
            {"    "}
          </Text>
          <Text color="gray">returned: {clip(row.summary, 300)}</Text>
        </Box>
      ) : null}

      {last ? null : (
        <Box>
          <Text color="gray">
            {"  "}
            {trunk}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function Live({
  rows,
  tick,
  error,
  cursor,
  expanded,
}: {
  rows: DelegationRow[];
  tick: number;
  error: string | null;
  cursor: number;
  expanded: boolean;
}) {
  if (error) return <Text color="red">store error: {error}</Text>;

  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No delegations yet — waiting for a Claude session.</Text>
        <Text color="gray" dimColor>
          Run `claude` in any terminal and ask for something wide. Every session on this
          machine reports here.
        </Text>
      </Box>
    );
  }

  const now = Date.now();
  const groups = groupBySession(rows);
  const savings = computeSavings(rows);
  const flat = groups.flatMap((g) => g.rows);
  const selected = flat[cursor];
  const [saved, baseline, actual] = formatCostGroup(
    savings.savedUsd,
    savings.baselineUsd,
    savings.actualUsd,
  );

  return (
    <Box flexDirection="column">
      {groups.map((group) => (
        <Box key={group.key} flexDirection="column" marginBottom={1}>
          <Rule label={`${shortCwd(group.cwd)} · ${relativeTime(group.startedAt, now)}`} />

          <Box>
            <Text color="green">● </Text>
            <Text bold>main agent</Text>
            <Text color="gray">
              {" "}
              (claude) · {group.rows.length} subagent{group.rows.length === 1 ? "" : "s"}
            </Text>
          </Box>

          {group.rows.map((row, index) => (
            <SubagentNode
              key={row.id}
              row={row}
              last={index === group.rows.length - 1}
              active={row.id === selected?.id}
              tick={tick}
              expanded={expanded}
            />
          ))}
        </Box>
      ))}

      {savings.measured ? (
        <Text color="gray">
          spend {formatCost(savings.actualUsd)} · saved{" "}
          <Text color="green">
            {saved} ({formatPercent(savings.savingsPercent)})
          </Text>{" "}
          vs all-{FRONTIER_ID} {baseline} → {actual} · tokens held constant
          {savings.excludedRows > 0 ? ` · ${savings.excludedRows} excluded (no counts)` : ""}
        </Text>
      ) : null}
    </Box>
  );
}
