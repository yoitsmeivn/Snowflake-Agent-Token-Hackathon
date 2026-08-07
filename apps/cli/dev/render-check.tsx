// Renders the PLAN view from a persisted plan.json, no planner call.
import { readFileSync } from "node:fs";
import { render, Box, useStdout } from "ink";
import type { StoredPlan } from "../src/core/plan.js";
import { Plan } from "../src/tui/Plan.js";

const plan = JSON.parse(readFileSync(process.argv[2] as string, "utf8")) as StoredPlan;

// The verification pty has no size; force one so Ink lays out realistically.
Object.defineProperty(process.stdout, "columns", { value: Number(process.env.W ?? 150) });
Object.defineProperty(process.stdout, "rows", { value: 60 });

function Harness() {
  const { stdout } = useStdout();
  return (
    <Box paddingX={1}>
      <Plan plan={plan} cursor={3} expanded={false} width={stdout?.columns ?? 120} />
    </Box>
  );
}

const app = render(<Harness />);
setTimeout(() => app.unmount(), 400);
