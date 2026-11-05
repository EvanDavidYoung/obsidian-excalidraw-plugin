// In Obsidian the plugin provides Excalidraw as the global `excalidrawLib`;
// give tests the same, from the same self-contained bundle the plugin ships
// (the package's dist/dev and dist/prod import unpublished @excalidraw/*
// workspaces). Runs after setup.ts, which gives jsdom a canvas first.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as ReactJSXDevRuntime from "react/jsx-dev-runtime";

const bundle = resolve(__dirname, "../../../node_modules/@zsviczian/excalidraw/dist/obsidian/excalidraw.production.min.js");
const excalidraw: unknown = new Function(
  "React", "ReactDOM", "ReactJSXRuntime", "ReactJSXDevRuntime",
  `${readFileSync(bundle, "utf8")}\nreturn ExcalidrawLib;`,
)(React, ReactDOM, ReactJSXRuntime, ReactJSXDevRuntime);

(globalThis as unknown as { excalidrawLib: unknown }).excalidrawLib = excalidraw;
