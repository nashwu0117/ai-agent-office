# Claude Code headless Master Brain research and verification

Date: 2026-09-17 (Pacific/Auckland)  
Local CLI verified: Claude Code 2.1.274

## Conclusions

1. Claude Code's supported non-interactive entry point is `claude -p` (the
   long form is `--print`). `--output-format json` returns one JSON result
   envelope; `text` and newline-delimited `stream-json` are the other modes.
   The installed CLI additionally exposes `--json-schema <schema>`, whose
   validated value is returned as `structured_output` in the result. Master
   planning therefore does not need terminal scraping or Anthropic Messages
   API tool-use.
2. Claude Code supports Claude.ai Pro/Max login as an authentication option.
   On this machine `claude auth status --json` reported `loggedIn: true`,
   `authMethod: "claude.ai"`, and `subscriptionType: "pro"`. Anthropic also
   documents that Claude.ai plans and Console API access are separate
   products. No Console key is needed for the CLI subscription route.
3. `--output-format json` writes the result envelope to stdout without the
   interactive renderer, progress UI, or ANSI styling. Diagnostics remain on
   stderr. The adapter still strips ANSI defensively, caps both pipes, checks
   exit/error state, and has a 120-second timeout.

Official references:

- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Set up Claude Code (authentication options)](https://docs.anthropic.com/en/docs/claude-code/getting-started)
- [Using Claude Code with a Pro or Max plan](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- [Why Claude.ai and Console API billing are separate](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console)

## Production invocation

For planning, the adapter spawns the executable directly (no shell):

```text
claude -p <goal>
  --output-format json
  --json-schema <PlannedTask wrapper schema>
  --no-session-persistence
  --safe-mode
  --restricted
  --permission-mode dontAsk
  --strict-mcp-config
  --mcp-config {"mcpServers":{}}
  --max-turns 3
  --system-prompt <existing Master planning prompt>
```

`summarize()` uses the same invocation without `--json-schema` and reads the
plain text from the JSON envelope's `result` field.

Before spawn, the adapter removes `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, their supported backup names,
and `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`/`FOUNDRY`. Do not add `--bare`: the
installed CLI's help explicitly says bare mode never reads OAuth/keychain
credentials, which would disable the required subscription login.

## Parsing and failure behavior

- Preferred plan payload: top-level envelope `structured_output`.
- Compatibility fallback: parse envelope `result` as JSON, tolerating a
  single outer ` ```json ` fence.
- If that payload is malformed or fails `PlannedTask[]` validation, call the
  CLI once more with a terse format-correction suffix. A second failure is a
  `MasterPlanningError`; it never hangs the goal coordinator.
- CLI auth/quota errors (401/403/429), timeouts, non-JSON stdout, output-cap
  breaches, and spawn failures are explicit errors and are not retried as if
  they were model-format mistakes.
- There is one Master credential source: `claude-code-cli-session`. No API-key
  fallback is attempted or advertised.

## Live evidence

With `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL`
explicitly unset, a real headless request reached the logged-in subscription
and returned one clean JSON envelope. At 17:41 NZST it correctly failed with
HTTP 429 and `"You've hit your session limit · resets 7:30pm
(Pacific/Auckland)"`; `duration_api_ms` and usage were present, there was no
interactive output, and the CLI did not request an API key. This is useful
negative-path proof that OAuth was selected, but it was not the required
successful plan evidence.

After the subscription window reset (19:53 NZST), re-running the verification
surfaced a real bug: `--mcp-config {}` is rejected by the installed CLI
(`Error: Invalid MCP configuration: mcpServers: Invalid input`) — the flag
needs a full `{"mcpServers":{}}` object, not an empty object. Fixed in
`createClaudeHeadlessRunner` (and above). After the fix, `plan()` with the
goal "First add a lastLoginAt field to the backend user data structure, then
make the frontend profile page display the value of that field." completed
in 43704ms with `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`
all unset, returning a schema-valid two-task `PlannedTask[]` (backend task,
then a frontend task with `dependsOn` correctly pointing at the backend
task's title) and a coherent `summarize()` follow-up. Full JSON, dependency
wave breakdown, and the `summarize()` output are recorded in
`docs/master-headless-evidence/plan-lastLoginAt.json`.
