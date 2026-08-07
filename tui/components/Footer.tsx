import { Box, Text } from "ink";

interface Control {
  key: string;
  label: string;
}

const DEFAULT_CONTROLS: readonly Control[] = [
  { key: "n", label: "Next Event" },
  { key: "s", label: "Settings" },
  { key: "q", label: "Quit" },
];

const MODAL_CONTROLS: readonly Control[] = [
  { key: "esc", label: "Close" },
  { key: "q", label: "Quit" },
];

export function Footer({ modalOpen }: { modalOpen: boolean }) {
  const controls = modalOpen ? MODAL_CONTROLS : DEFAULT_CONTROLS;

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
