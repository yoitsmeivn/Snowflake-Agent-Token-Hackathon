import { Box, Text } from "ink";

import type { RoutingSnapshot } from "../events/types";
import { formatCost, formatLatency, formatTokens } from "../lib/format";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="column" width={14}>
      <Text color="gray">{label}</Text>
      <Text bold>{value}</Text>
    </Box>
  );
}

export function Metrics({ snapshot }: { snapshot: RoutingSnapshot }) {
  const { summary } = snapshot;
  const totalTokens = summary.usage.inputTokens + summary.usage.outputTokens;
  const harnesses = new Set(
    snapshot.tasks.map((task) => task.harness).filter(Boolean),
  ).size;

  return (
    <Box flexWrap="wrap" marginBottom={1}>
      <Metric label="Tasks" value={String(summary.taskCount)} />
      <Metric label="Models" value={String(summary.modelsUsed.length)} />
      <Metric label="Harnesses" value={String(harnesses)} />
      <Metric label="Tokens" value={formatTokens(totalTokens)} />
      <Metric label="Cost" value={formatCost(summary.cost.withRouting)} />
      <Metric label="Avg latency" value={formatLatency(summary.averageLatencyMs)} />
    </Box>
  );
}
