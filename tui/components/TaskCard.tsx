import { Box, Text } from "ink";

import type { Task } from "../events/types";
import { formatCost, formatPercent, formatTokens } from "../lib/format";
import { statusColor, statusIcon } from "./StatusBadge";

interface TaskCardProps {
  task: Task;
  /** The task currently executing gets a pointer and brighter text. */
  active: boolean;
}

export function TaskCard({ task, active }: TaskCardProps) {
  const color = statusColor(task.status);
  const started = task.status !== "queued";
  const showSavings = Boolean(task.alternativeModel) && task.cost.savingsPercent >= 0.5;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color}>{active ? "▸" : " "}</Text>
        <Text color={color}> {statusIcon(task.status)} </Text>
        <Text bold={active} color={active ? undefined : "white"}>
          {task.name}
        </Text>
      </Box>

      <Box marginLeft={4}>
        <Text color="gray">{task.model.displayName}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">{task.harness ?? "unassigned"}</Text>
        {showSavings && (
          <Text color="green">
            {"  "}▼ {formatPercent(task.cost.savingsPercent)}
          </Text>
        )}
      </Box>

      {started && (
        <Box marginLeft={4}>
          <Text color="gray" dimColor>
            {formatTokens(task.usage.inputTokens)} in ·{" "}
            {formatTokens(task.usage.outputTokens)} out · {formatCost(task.cost.withRouting)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
