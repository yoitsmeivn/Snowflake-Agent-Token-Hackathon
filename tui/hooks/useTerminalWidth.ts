import { useEffect, useState } from "react";
import { useStdout } from "ink";

const FALLBACK_WIDTH = 80;

/** Tracks terminal width so rules and dividers span the viewport. */
export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  // `||` not `??`: a pty with no window size reports columns as 0, which would
  // otherwise pass the nullish check and collapse every rule to nothing.
  const [width, setWidth] = useState(stdout?.columns || FALLBACK_WIDTH);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setWidth(stdout.columns || FALLBACK_WIDTH);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return width;
}
