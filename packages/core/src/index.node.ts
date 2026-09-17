// Node-only runtime helpers (spawns child_process) — kept out of the main
// "@ai-office/core" barrel so bundling the web app doesn't try to resolve
// node:child_process for the browser. RuntimeAdapter implementations
// (server-side only) import this subpath instead.
export * from "./runtime/process-handle.js";
export * from "./runtime/git-repo-guard.js";
export * from "./credentials/sources.js";
export * from "./credentials/router.js";
export * from "./credentials/factory.js";
export * from "./credentials/backend-resolver.js";
export * from "./runtime/port-select.js";
