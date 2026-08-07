import { Box, Text } from "ink";

/**
 * UI scaffolding only. Values are display-only placeholders — nothing is read
 * from the environment, stored, validated, or sent anywhere.
 */
const FIELDS: ReadonlyArray<{ label: string; value: string; masked?: boolean }> = [
  { label: "Anthropic API Key", value: "not set", masked: true },
  { label: "OpenAI API Key", value: "not set", masked: true },
  { label: "Gemini API Key", value: "not set", masked: true },
  { label: "Event Source", value: "mock" },
  { label: "Pricing Config", value: "./config/pricing.json" },
];

export function SettingsModal() {
  return (
    <Box justifyContent="center" marginY={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        paddingY={1}
        width={54}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold>SETTINGS</Text>
        </Box>

        {FIELDS.map((field) => (
          <Box key={field.label} justifyContent="space-between">
            <Text color="gray">{field.label}</Text>
            <Text color={field.masked ? "gray" : undefined} dimColor={field.masked}>
              {field.value}
            </Text>
          </Box>
        ))}

        <Box marginTop={1} justifyContent="center">
          <Text color="gray" dimColor>
            display only · esc to close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
