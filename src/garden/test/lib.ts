// In Obsidian the plugin provides Excalidraw as the global `excalidrawLib`;
// give tests the same. Runs after setup.ts, which gives jsdom a canvas first.
import * as excalidraw from "@zsviczian/excalidraw";

(globalThis as unknown as { excalidrawLib: typeof excalidraw }).excalidrawLib = excalidraw;
