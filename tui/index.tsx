import { render } from "ink";

import { App } from "./App";

const { waitUntilExit } = render(<App />);

await waitUntilExit();
