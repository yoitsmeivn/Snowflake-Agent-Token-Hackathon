import { Box, Text } from "ink";

import type { RoutingSnapshot } from "../events/types";
import { formatCostGroup, formatPercent } from "../lib/format";

/** 3x5 block font, enough for a percentage. */
const GLYPHS: Record<string, readonly string[]> = {
  "0": ["███", "█ █", "█ █", "█ █", "███"],
  "1": ["  █", "  █", "  █", "  █", "  █"],
  "2": ["███", "  █", "███", "█  ", "███"],
  "3": ["███", "  █", "███", "  █", "███"],
  "4": ["█ █", "█ █", "███", "  █", "  █"],
  "5": ["███", "█  ", "███", "  █", "███"],
  "6": ["███", "█  ", "███", "█ █", "███"],
  "7": ["███", "  █", "  █", "  █", "  █"],
  "8": ["███", "█ █", "███", "█ █", "███"],
  "9": ["███", "█ █", "███", "  █", "███"],
  "%": ["█ █", "  █", " █ ", "█  ", "█ █"],
};

function renderBig(text: string): string[] {
  const rows = ["", "", "", "", ""];
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (!glyph) continue;
    for (let row = 0; row < 5; row++) {
      rows[row] += `${glyph[row]} `;
    }
  }
  return rows;
}

interface SavingsHeroProps {
  snapshot: RoutingSnapshot;
}

/**
 * The centerpiece. Green is reserved for this and for completed tasks, so the
 * savings figure is the first thing the eye lands on.
 */
export function SavingsHero({ snapshot }: SavingsHeroProps) {
  const { cost } = snapshot.summary;
  const measured = cost.withoutRouting > 0;
  const rows = renderBig(measured ? formatPercent(cost.savingsPercent) : "0%");
  const [saved, baseline, actual] = formatCostGroup(
    cost.savings,
    cost.withoutRouting,
    cost.withRouting,
  );

  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      <Text color="gray">SAVINGS</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row, index) => (
          <Text key={index} color={measured ? "green" : "gray"} bold>
            {row}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        {measured ? (
          <Text>
            <Text color="gray">Saved </Text>
            <Text color="green" bold>
              {saved}
            </Text>
            <Text color="gray">
              {"  "}
              {baseline} → {actual}
            </Text>
          </Text>
        ) : (
          <Text color="gray">awaiting first dispatch</Text>
        )}
      </Box>
    </Box>
  );
}
