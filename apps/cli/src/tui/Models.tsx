import { Box, Text } from "ink";
import { harnessOf } from "../core/probe.js";
import type { ModelCatalogEntry } from "../core/types.js";

function ctx(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.floor(n / 1000)}k`;
}

function price(m: ModelCatalogEntry): string {
  if (m.price_input_per_mtok === null || m.price_output_per_mtok === null) {
    return m.price_source === "local-no-marginal-cost" ? "local" : "subscription";
  }
  return `${m.price_input_per_mtok} / ${m.price_output_per_mtok}`;
}

function statusOf(m: ModelCatalogEntry): { text: string; color: string } {
  switch (m.availability) {
    case "checking":
      return { text: "checking…", color: "gray" };
    case "available":
      return { text: "available", color: "green" };
    case "unauthenticated":
      return { text: m.availability_note ?? "unauthenticated", color: "yellow" };
    case "not-installed":
      return { text: "not-installed", color: "red" };
  }
}

function pad(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

/** Compact one-row-per-model table — dense on purpose; detail lives on the cursor row. */
export function Models({
  models,
  cursor,
}: {
  models: ModelCatalogEntry[];
  cursor: number;
}) {
  const assignable = models.filter((m) => m.enabled && m.availability === "available").length;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">
          {"     "}
          {pad("model", 20)}
          {pad("harness", 10)}
          {pad("ctx", 7)}
          {pad("$/MTok in/out", 15)}
          {pad("cost", 9)}
          status
        </Text>
      </Box>

      {models.map((m, i) => {
        const selected = i === cursor;
        const usable = m.availability === "available";
        const status = statusOf(m);
        const mark = !usable ? "✕" : m.enabled ? "✓" : "○";
        const markColor = !usable ? "red" : m.enabled ? "green" : "gray";

        return (
          <Box key={m.id}>
            <Text color={selected ? "cyan" : undefined}>{selected ? " ▸ " : "   "}</Text>
            <Text color={markColor}>{mark} </Text>
            <Text dimColor={!usable} bold={selected}>
              {pad(m.id, 18)}
            </Text>
            <Text dimColor={!usable} color={usable ? "blue" : undefined}>
              {pad(harnessOf(m), 10)}
            </Text>
            <Text dimColor={!usable}>
              {pad(ctx(m.context_window), 7)}
              {pad(price(m), 15)}
              {pad(m.cost_tier, 9)}
            </Text>
            <Text color={status.color}>{status.text}</Text>
          </Box>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {assignable} of {models.length} rows assignable — the delegate tool offers exactly
          these. Toggles apply to newly started Claude sessions.
        </Text>
        {models[cursor] ? (
          <Text color="gray" dimColor>
            {models[cursor].reliability_notes}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
