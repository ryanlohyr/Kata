import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    // node-server preset = standalone Node server in .output/server/index.mjs.
    // Railway runs `node .output/server/index.mjs` as the start command.
    tanstackStart({ target: "node-server" }),
  ],
});
