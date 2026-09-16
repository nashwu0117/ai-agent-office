# AI Office

An open-source "AI company" office: instead of a wall of terminals, you see a
2D office where each worker corresponds to a real coding CLI agent. Idle
workers wander the Public/Talent Area; once assigned a task they walk to a
workstation, work, and return when done.

## Status: Phase 0 — vertical slice

This is the minimum end-to-end loop, not the full product:

- A hardcoded pool of 5 agents, all backed by the same local Claude Code CLI.
- No real task decomposition — one submitted description becomes one task.
- Single task at a time; no capability grants, workspace git isolation, or
  multi-provider credential routing yet (though the types are already shaped
  for those to slot in later — see `packages/core/src/runtime/adapter.ts`).

Goal of this slice: prove that `Master → real CLI process → UI` state sync
actually works, end to end, with no fabricated data on the frontend.

## Prerequisites

- Node.js 20+
- The `claude` CLI installed and authenticated (`claude auth`), reachable on
  your `PATH`.

## Running locally

```bash
npm install
npm run dev
```

This starts the server (`apps/server`, WebSocket + REST on `:4000`) and the
web UI (`apps/web`, Vite dev server on `:5173`) together. Open
http://localhost:5173.

To run them separately:

```bash
npm run dev:server
npm run dev:web
```

## Using it

1. Open the web UI — you should see 5 agents wandering the Public/Talent Area.
2. Fill in a task description and a real local folder path, then dispatch it.
3. An available agent walks to a workstation, and its live progress (parsed
   from the Claude Code CLI's `stream-json` output) appears as a speech
   bubble and in the detail panel (click the agent) as raw scrolling log
   lines.
4. When the CLI process exits, the agent returns to the Public Area and a
   completion (or failure) card appears.

## Project layout

```
packages/core                 shared types, event schema, Orchestrator state machine
packages/adapters/claude-code Claude Code CLI adapter (implements RuntimeAdapter)
apps/server                   WebSocket + REST server, wires Orchestrator to real agents
apps/web                      React + PixiJS office UI
```

`RuntimeAdapter` (in `packages/core/src/runtime/adapter.ts`) is the interface
the Orchestrator talks to — adding another CLI backend (OpenCode, Aider, …)
later means implementing that interface, not touching orchestration logic.
