import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Metrics } from "./components/Metrics";
import { SavingsHero } from "./components/SavingsHero";
import { SettingsModal } from "./components/SettingsModal";
import { Rule, TaskList } from "./components/TaskList";
import { useRouterEvents } from "./hooks/useRouterEvents";

/**
 * The only component that talks to the event source. Everything below receives
 * plain data as props, which is what makes swapping in the real scheduler a
 * one-file change.
 */
export function App() {
  const { exit } = useApp();
  const { event, status, advance, totalSteps } = useRouterEvents();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      setSettingsOpen(false);
      return;
    }
    const pressed = input.toLowerCase();
    if (pressed === "q") {
      exit();
      return;
    }
    if (pressed === "s") {
      setSettingsOpen((open) => !open);
      return;
    }
    // Advancing while the modal is open would hide state changes behind it.
    if (pressed === "n" && !settingsOpen) advance();
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header
        status={status}
        strategy={event.snapshot.strategy}
        step={event.step}
        totalSteps={totalSteps}
      />

      {settingsOpen ? (
        <SettingsModal />
      ) : (
        <>
          <SavingsHero snapshot={event.snapshot} />

          <Rule label="RUN" />
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              <Text color="gray">{String(event.step).padStart(2, "0")} </Text>
              <Text bold>{event.label}</Text>
            </Text>
            {/* paddingLeft rather than literal spaces so wrapped lines stay
                aligned with the first. */}
            {event.detail && (
              <Box paddingLeft={3}>
                <Text color="gray" dimColor>
                  {event.detail}
                </Text>
              </Box>
            )}
          </Box>

          <Metrics snapshot={event.snapshot} />
          <TaskList tasks={event.snapshot.tasks} />
        </>
      )}

      <Footer modalOpen={settingsOpen} />
    </Box>
  );
}
