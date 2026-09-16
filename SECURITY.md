# Security: worker isolation

## The incident this document exists because of

While verifying v0.5 (Master-planned goals), a Master-decomposed subtask
was dispatched to an OpenCode worker with `workspacePath` pointed at an
**empty** scratch directory. The task description ("add an install section
to README.md") didn't match what was actually there. Instead of creating a
new file inside its assigned directory, the OpenCode CLI's own shell tool
explored *outward* past its assigned directory (`ls -la /`, `/home/`,
`/home/nash/`, `/home/nash/workspace/`...) until it found and edited this
project's own `README.md` — a completely different path, outside the
assigned workspace. The process exited with code 0, so the Orchestrator had
recorded the task as `done` before the escape was noticed by a human
reading the diff by hand.

Root cause: `--dir`/`--add-dir` flags on these CLIs set a working-directory
*convention*, not a filesystem boundary. Nothing stopped the model's own
shell tool from reading or writing anywhere the OS process itself had
permission to touch, regardless of which directory it was told to focus on.

## What actually protects against this today

Two independent layers, in the order they actually engage:

### Layer 2 — prevention (bubblewrap sandbox)

**This is the primary defense**, even though it's numbered second below
for historical reasons (see git history: detection was designed first,
sandboxing was researched and added once proven feasible in the same
patch). Every worker CLI invocation (`spawnRuntimeProcess`,
`packages/core/src/runtime/process-handle.ts`) is wrapped in a
[bubblewrap](https://github.com/containers/bubblewrap) sandbox
(`packages/core/src/runtime/sandbox.ts`) when the `bwrap` binary is
available on `PATH`:

- The entire filesystem is bind-mounted **read-only** (`--ro-bind / /`).
- Exactly three things are writable: the task's own `workspacePath`,
  `/tmp` (most CLI toolchains assume they can write scratch files there),
  and each CLI's own state directory (`~/.claude`, `~/.claude.json`,
  `~/.cache/claude`, `~/.local/share/opencode`, `~/.config/opencode`,
  `~/.cache/opencode` — required for the CLIs to even start; verified by
  hand that `opencode` hard-crashes on startup without write access to its
  own log directory).
- Network access is left shared (unmodified) — workers still need it to
  reach their model APIs.

**Verified by hand, not assumed**: with this sandbox active, re-running the
exact incident scenario (empty scratch dir, the same ambiguous
"add an install section to README.md" task) against `README.md` in this
repo resulted in the write attempt failing with a real OS-level
`Read-only file system` error — confirmed both as a raw shell command and
through a full agentic CLI session that actively tried `touch` on the
protected path and was refused. The repo's `README.md` mtime was
unchanged after the run. This is real prevention, not a heuristic.

**Known gap**: if `bwrap` isn't installed (verified only on this project's
own Linux dev environment; not tested on macOS/Windows), sandboxing
silently falls back to running the command unwrapped, and only Layer 1
below is active. `bwrap` also doesn't prevent a worker from writing
anywhere under `/tmp` or reading any file on the system (the read-only
bind still allows reads everywhere) — it only prevents *writes* outside the
three allowed paths. A sufficiently motivated adversarial prompt could
still read files outside its workspace (e.g. other users' data on a
shared machine, if permissions allow); this sandbox was built to stop
*accidental* wandering like the incident above, not to resist a
deliberately malicious task description.

### Layer 1 — detection & auto-revert (safety net)

Independent of whether Layer 2 is active, the Orchestrator
(`packages/core/src/orchestrator/orchestrator.ts`) brackets every task
execution with a `WorkspaceGuard`
(`packages/core/src/runtime/workspace-guard.ts`, implemented by
`GitRepoGuard` in `git-repo-guard.ts`) watching one specific protected git
repo — this project's own checkout, wired up in `apps/server/src/index.ts`:

1. Immediately before a task runs, snapshot `git status --porcelain` on the
   protected repo.
2. Immediately after the worker process exits (**regardless of its exit
   code** — the incident's own worker exited 0), snapshot again.
3. Any path that was clean before and dirty after, and that does **not**
   fall inside the task's own `workspacePath`, is a violation:
   - `git diff` output for those paths is captured into the `task_failed`
     event's audit trail before anything is touched.
   - Tracked files are reverted with `git checkout -- <path>`; brand-new
     untracked files/directories are deleted directly.
   - The task is force-marked `failed` with `securityViolation: true` and
     `affectedPaths` — **never** `done`, no matter what the process's own
     exit code said.
4. The frontend renders this distinctly from an ordinary task failure: a
   red-bordered "⚠️ Workspace isolation violation" completion card (not the
   plain fail card) and a pulsing red `⚠` badge over the agent in the
   office scene (not the routine `!` error badge).

**Known gap**: if a path was *already* dirty before the task ran (e.g. the
operator's own in-progress, uncommitted edit to this repo) and the task
modifies it further, that's still captured in the diff/audit log but is
**not** auto-reverted — `git checkout` would silently destroy the
operator's unrelated pending work, which is worse than leaving the
combined state for a human to sort out by hand. This is a deliberate
scoping decision, not an oversight.

**Applies uniformly to both runtimes** (`claude-code` and `opencode`) —
the fact that only the OpenCode worker caused the original incident does
not mean the Claude Code worker is inherently safe; it simply wasn't
pushed into a situation that triggered wandering behavior during that
specific test.

## What is explicitly *not* protected

- Any path outside the one `protectedRepoPath` the server is configured
  with (this project's own checkout). A worker could still, in principle,
  read or write files elsewhere on the filesystem that neither layer
  watches — e.g. another unrelated project directory, if Layer 2's
  bubblewrap sandbox isn't active for some reason. Layer 2 mitigates this
  broadly (everything is read-only by default, not just the protected
  repo); Layer 1 only watches the one repo it's configured with.
- Credential/secret exfiltration: a worker with read access to its own
  CLI's credential files (necessarily writable/readable for the CLI to
  function) could in principle include their contents in a request to
  whatever model API it's configured to call. Neither layer defends
  against this.
- Resource exhaustion (a worker consuming excessive CPU/disk/network) —
  out of scope for this hardening pass.

## Reproducing the verification

```bash
mkdir -p /tmp/isolation-test && cd /tmp/isolation-test
bwrap --ro-bind / / --bind "$PWD" "$PWD" --bind /tmp /tmp \
  --bind-try "$HOME/.local/share/opencode" "$HOME/.local/share/opencode" \
  --bind-try "$HOME/.config/opencode" "$HOME/.config/opencode" \
  --dev /dev --proc /proc --die-with-parent \
  -- opencode run "Open README.md and add an install section." \
     --format json --dir "$PWD" --model opencode/nemotron-3.5-lightning-free --auto
# Expect: no write anywhere outside /tmp/isolation-test succeeds.
```

To exercise Layer 1 specifically (detect + revert + fail), run the same
scenario against a version of this server built *without* `bwrap`
installed, or with Layer 2 otherwise disabled — the escape should still be
caught after the fact, the file reverted, and the task marked `failed`
with `securityViolation: true` instead of `done`.
