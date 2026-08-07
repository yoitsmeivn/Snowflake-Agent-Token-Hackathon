import { Box, Text } from "ink";

import type { ConnectionStatus } from "../events/types";
import { titleCase } from "../lib/format";

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connecting: "yellow",
  connected: "green",
  error: "red",
};

interface HeaderProps {
  status: ConnectionStatus;
  strategy: string;
  step: number;
  totalSteps: number;
}

export function Header({ status, strategy, step, totalSteps }: HeaderProps) {
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      flexDirection="column"
      width="100%"
    >
      <Box justifyContent="space-between">
        <Text bold>TOKEN ROUTER MONITOR</Text>
        <Text color="gray">
          step {step}/{totalSteps}
        </Text>
      </Box>
      <Box gap={3}>
        <Text>
          <Text color="gray">Status </Text>
          <Text color={STATUS_COLOR[status]}>●</Text>
          <Text> {titleCase(status)}</Text>
        </Text>
        <Text>
          <Text color="gray">Strategy </Text>
          <Text>{titleCase(strategy)}</Text>
        </Text>
      </Box>
    </Box>
  );
}
