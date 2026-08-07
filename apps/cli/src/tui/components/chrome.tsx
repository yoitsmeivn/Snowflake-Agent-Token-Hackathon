import { Box, Text, useStdout } from "ink";
import type { DelegationStatus } from "../../core/store.js";

/**
 * Exhaustive by construction: adding a status to DelegationStatus makes this
 * object a compile error until it is handled here. From the tui-monitor branch.
 */
const STATUS_STYLE: Record<DelegationStatus, { icon: string; label: string; color: string }> = {
  running: { icon: "●", label: "Running", color: "yellow" },
  completed: { icon: "✓", label: "Completed", color: "green" },
  failed: { icon: "✕", label: "Failed", color: "red" },
};

const SPINNER = ["◐", "◓", "◑", "◒"] as const;

export function statusColor(status: DelegationStatus): string {
  return STATUS_STYLE[status].color;
}

export function statusIcon(status: DelegationStatus, tick: number): string {
  if (status === "running") return SPINNER[tick % SPINNER.length] as string;
  return STATUS_STYLE[status].icon;
}

export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  return stdout?.columns ?? 100;
}

export function Rule({ label }: { label: string }) {
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

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="column" width={16}>
      <Text color="gray">{label}</Text>
      <Text bold>{value}</Text>
    </Box>
  );
}

interface Control {
  key: string;
  label: string;
}

export function Footer({ controls }: { controls: readonly Control[] }) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} gap={2}>
      {controls.map((control) => (
        <Text key={control.key}>
          <Text bold color="white">
            {control.key}
          </Text>
          <Text color="gray"> {control.label}</Text>
        </Text>
      ))}
    </Box>
  );
}

export function Header({
  view,
  assignable,
  running,
}: {
  view: string;
  assignable: number;
  running: number;
}) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" width="100%">
      <Box justifyContent="space-between">
        <Text bold>ENSEMBLE — DELEGATION MONITOR</Text>
        <Text color="gray">{view}</Text>
      </Box>
      <Box gap={3}>
        <Text>
          <Text color="gray">Roster </Text>
          <Text color={assignable > 0 ? "green" : "red"}>●</Text>
          <Text> {assignable} available</Text>
        </Text>
        <Text>
          <Text color="gray">Active </Text>
          <Text color={running > 0 ? "yellow" : "gray"}>{running}</Text>
        </Text>
      </Box>
    </Box>
  );
}
