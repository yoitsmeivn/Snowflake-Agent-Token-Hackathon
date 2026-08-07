import { Text } from "ink";

import type { TaskStatus } from "../events/types";

/**
 * Exhaustive by construction: adding a status to the shared `TaskStatus` union
 * makes this object a compile error until it's handled here.
 */
const STATUS_STYLE: Record<TaskStatus, { icon: string; label: string; color: string }> = {
  queued: { icon: "○", label: "Queued", color: "gray" },
  running: { icon: "●", label: "Running", color: "yellow" },
  completed: { icon: "✓", label: "Completed", color: "green" },
  failed: { icon: "✕", label: "Failed", color: "red" },
  cached: { icon: "◈", label: "Cached", color: "blue" },
};

export function statusColor(status: TaskStatus): string {
  return STATUS_STYLE[status].color;
}

export function statusIcon(status: TaskStatus): string {
  return STATUS_STYLE[status].icon;
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <Text color={style.color}>
      {style.icon} {style.label}
    </Text>
  );
}
