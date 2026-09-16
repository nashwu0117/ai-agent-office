// Node-only runtime helpers (spawns child_process) — kept out of the main
// "@ai-office/core" barrel so bundling the web app doesn't try to resolve
// node:child_process for the browser. RuntimeAdapter implementations
// (server-side only) import this subpath instead.
export * from "./runtime/process-handle.js";
