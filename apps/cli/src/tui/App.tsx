import { useEffect, useState } from "react";
import { Box, useApp, useInput } from "ink";
import { assignableModels, loadCatalog, saveOverlay } from "../core/catalog.js";
import { applyProbes, probeHarnesses } from "../core/probe.js";
import { writeRosterCache } from "../core/roster.js";
import type { ModelCatalogEntry } from "../core/types.js";
import { Footer, Header } from "./components/chrome.js";
import { useDelegations } from "./hooks/useDelegations.js";
import { Live } from "./Live.js";
import { Models } from "./Models.js";

const LIVE_CONTROLS = [
  { key: "1", label: "Models" },
  { key: "↑↓", label: "Select" },
  { key: "enter", label: "Detail" },
  { key: "q", label: "Quit" },
] as const;

const MODEL_CONTROLS = [
  { key: "2", label: "Live" },
  { key: "space", label: "Toggle" },
  { key: "↑↓", label: "Select" },
  { key: "q", label: "Quit" },
] as const;

export function App() {
  const { exit } = useApp();
  const { rows, tick, error } = useDelegations();

  const [models, setModels] = useState<ModelCatalogEntry[]>(() => loadCatalog());
  const [view, setView] = useState<"models" | "live">("live");
  const [modelCursor, setModelCursor] = useState(0);
  const [liveCursor, setLiveCursor] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void probeHarnesses().then((probes) => {
      if (cancelled) return;
      setModels((current) => {
        const next = applyProbes(current, probes);
        writeRosterCache(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "1") {
      setView("models");
      return;
    }
    if (input === "2") {
      setView("live");
      return;
    }

    if (view === "models") {
      if (key.upArrow) setModelCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setModelCursor((c) => Math.min(models.length - 1, c + 1));
      if (input === " ") {
        setModels((current) => {
          const target = current[modelCursor];
          if (!target || target.availability !== "available") return current;
          const next = current.map((m) =>
            m.id === target.id ? { ...m, enabled: !m.enabled } : m,
          );
          saveOverlay(next);
          writeRosterCache(next);
          return next;
        });
      }
      return;
    }

    if (key.upArrow) setLiveCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setLiveCursor((c) => Math.min(rows.length - 1, c + 1));
    if (key.return) setExpanded((e) => !e);
  });

  const running = rows.filter((r) => r.status === "running").length;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header
        view={view === "live" ? "LIVE" : "MODELS"}
        assignable={assignableModels(models).length}
        running={running}
      />

      <Box marginTop={1} flexDirection="column">
        {view === "models" ? (
          <Models models={models} cursor={modelCursor} />
        ) : (
          <Live rows={rows} tick={tick} error={error} cursor={liveCursor} expanded={expanded} />
        )}
      </Box>

      <Footer controls={view === "live" ? LIVE_CONTROLS : MODEL_CONTROLS} />
    </Box>
  );
}
