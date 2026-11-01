// The plugin loads Excalidraw at runtime as the global `excalidrawLib` (see
// src/constants/constants.ts) rather than bundling an import of it, so garden
// code reaches it here. Tests put the npm package in its place.
type Lib = typeof import("@zsviczian/excalidraw");

declare const excalidrawLib: Lib;

export const lib = (): Lib => excalidrawLib;
