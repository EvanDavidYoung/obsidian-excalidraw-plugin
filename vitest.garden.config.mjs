// Tests for the garden additions (src/garden) only; upstream has its own test setup.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL("src/garden/test/obsidianStub.ts", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["src/garden/**/*.test.ts"],
    setupFiles: ["src/garden/test/setup.ts", "src/garden/test/lib.ts"],
    server: { deps: { inline: [/@zsviczian\/excalidraw/] } },
    css: false,
  },
});
