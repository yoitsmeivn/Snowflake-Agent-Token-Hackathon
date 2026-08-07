import { Box, Text } from "ink";

import type { Task } from "../events/types";
import { useTerminalWidth } from "../hooks/useTerminalWidth";
import { TaskCard } from "./TaskCard";

function Rule({ label }: { label: string }) {
  const width = useTerminalWidth();
  // 4 for the leading dashes and spaces, 2 for the App's horizontal padding.
  const trailing = Math.max(2, width - label.length - 8);

  return (
    <Box marginBottom={1}>
      <Text color="gray">── {label} </Text>
      <Text color="gray">{"─".repeat(trailing)}</Text>
    </Box>
  );
}

export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <Box flexDirection="column">
      <Rule label={`TASKS (${tasks.length})`} />
      {tasks.length === 0 ? (
        <Text color="gray">No tasks yet — waiting for the planner.</Text>
      ) : (
        tasks.map((task) => (
          <TaskCard key={task.id} task={task} active={task.status === "running"} />
        ))
      )}
    </Box>
  );
}

export { Rule };
