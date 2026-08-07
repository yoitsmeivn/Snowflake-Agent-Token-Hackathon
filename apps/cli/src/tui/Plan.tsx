import { Box, Text } from "ink";
import type { StoredPlan, StoredTask } from "../core/plan.js";

const NODE_WIDTH = 28;
const NODE_ROWS = 7; // 4 content lines + 2 border rows + 1 margin
const GUTTER_WIDTH = 3;

/** The DAG is drawn at fixed width or not at all — a squashed node is worse than a list. */
function dagFits(depth: number, width: number): boolean {
  return width >= depth * (NODE_WIDTH + GUTTER_WIDTH);
}

/**
 * Column index = dependency depth (longest path from a root). Deterministic,
 * no layout solver, no animation — a node must not move once drawn.
 */
export function layoutTasks(tasks: StoredTask[]): {
  columns: StoredTask[][];
  flat: StoredTask[];
} {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const task = byId.get(id);
    if (!task || task.dependencies.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    if (visiting.has(id)) return 0; // cycles are rejected by gate 3; guard anyway
    visiting.add(id);
    const d = Math.max(...task.dependencies.map(depth)) + 1;
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };

  const columns: StoredTask[][] = [];
  for (const task of tasks) {
    const d = depth(task.id);
    (columns[d] ??= []).push(task);
  }

  const filled = columns.map((c) => c ?? []);
  return { columns: filled, flat: filled.flat() };
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Node({ task, selected }: { task: StoredTask; selected: boolean }) {
  const est = task.estimates;
  const deps = task.dependencies.length > 0 ? `← ${task.dependencies.join(",")}` : "root";

  return (
    <Box
      width={NODE_WIDTH}
      flexShrink={0}
      flexDirection="column"
      borderStyle="round"
      borderColor={selected ? "cyan" : "gray"}
      marginBottom={1}
    >
      <Text bold={selected} color={selected ? "cyan" : undefined}>
        {clip(`${task.id}  ${task.name}`, NODE_WIDTH - 4)}
      </Text>
      <Text color="magenta">{clip(task.model_id, NODE_WIDTH - 4)}</Text>
      <Text color="blue">{clip(`${task.harness}  ${deps}`, NODE_WIDTH - 4)}</Text>
      <Text dimColor>
        {clip(
          `${tokens(est.expected_input_tokens)}→${tokens(est.expected_output_tokens)}  ` +
            `$${est.estimated_cost_usd.toFixed(4)}  ${est.confidence}`,
          NODE_WIDTH - 4,
        )}
      </Text>
    </Box>
  );
}

/** Box-drawing stubs into every node in the next column that has dependencies. */
function Gutter({ nodes }: { nodes: StoredTask[] }) {
  const lines: string[] = [];
  for (const node of nodes) {
    const connected = node.dependencies.length > 0;
    for (let row = 0; row < NODE_ROWS; row += 1) {
      lines.push(row === 2 && connected ? "───" : "   ");
    }
  }
  return (
    <Box flexDirection="column" width={GUTTER_WIDTH} flexShrink={0}>
      {lines.map((line, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function NarrowList({
  plan,
  selectedId,
  needed,
}: {
  plan: StoredPlan;
  selectedId?: string;
  needed: number;
}) {
  const { columns } = layoutTasks(plan.tasks);
  return (
    <Box flexDirection="column">
      <Text dimColor>graph needs {needed} cols — list fallback</Text>
      {columns.map((column, depth) =>
        column.map((task) => (
          <Text key={task.id} color={task.id === selectedId ? "cyan" : undefined}>
            {"  ".repeat(depth)}
            {task.id === selectedId ? "▸ " : "  "}
            {task.id} {clip(task.name, 24)} · {task.model_id} · {task.harness}
          </Text>
        )),
      )}
    </Box>
  );
}

export function Plan({
  plan,
  cursor,
  expanded,
  width,
}: {
  plan: StoredPlan;
  cursor: number;
  expanded: boolean;
  width: number;
}) {
  const { columns, flat } = layoutTasks(plan.tasks);
  const selected = flat[cursor];

  const total = plan.tasks.reduce((sum, t) => sum + t.estimates.estimated_cost_usd, 0);
  const spread = new Map<string, number>();
  for (const t of plan.tasks) spread.set(t.model_id, (spread.get(t.model_id) ?? 0) + 1);

  return (
    <Box flexDirection="column">
      {!dagFits(columns.length, width) ? (
        <NarrowList
          plan={plan}
          selectedId={selected?.id}
          needed={columns.length * (NODE_WIDTH + GUTTER_WIDTH)}
        />
      ) : (
        <Box flexDirection="row">
          {columns.map((column, depth) => (
            <Box key={depth} flexDirection="row">
              {depth > 0 ? <Gutter nodes={column} /> : null}
              <Box flexDirection="column">
                {column.map((task) => (
                  <Node key={task.id} task={task} selected={task.id === selected?.id} />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          {plan.tasks.length} tasks · {spread.size} distinct models ·{" "}
          {[...spread.entries()].map(([id, n]) => `${id}×${n}`).join("  ")} · est $
          {total.toFixed(4)}
        </Text>
        {selected ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text color="cyan">{selected.id}</Text>
              <Text dimColor> why {selected.model_id}: </Text>
              <Text>{expanded ? selected.model_rationale : clip(selected.model_rationale, 96)}</Text>
            </Text>
            {expanded ? <Text dimColor>objective: {selected.objective}</Text> : null}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
