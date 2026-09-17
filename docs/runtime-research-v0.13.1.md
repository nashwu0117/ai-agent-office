# v0.13.1: Freebuff re-verified against the actually-installed CLI

v0.13 Part A's Freebuff conclusion ("no headless/API surface") was reached
from the published README and open GitHub issues, **before** the CLI was
installed on this machine. This build prompt asked to redo that check the
same way v0.13 Part A verified Cline — against the real installed binary,
not the docs — now that a real `freebuff` install exists here. Conclusion
is unchanged, but it now rests on first-hand evidence instead of docs/issues.

## What's actually installed

- `npm ls -g freebuff` → wrapper package `freebuff@0.0.162`
  (`~/.nvm/.../lib/node_modules/freebuff`). This wrapper is a ~1KB launcher
  (`index.js`/`launcher.js`) that self-updates and execs a real binary.
- The real binary it downloads and runs lives at
  `~/.config/manicode/freebuff` — a 140MB native executable, currently
  `freebuff --version` → **0.0.175**. ("manicode" is the on-disk config dir
  name; the product itself is Codebuff, white-labeled as "Freebuff" for the
  free tier — confirmed by the CLI's own strings, e.g. `CODEBUFF_API_KEY`,
  `codebuff.com`, `@codebuff/sdk`, alongside the `freebuff.com`/`FREEBUFF_*`
  branding.)
- This install is not fresh/idle — `~/.config/manicode/` already has
  `credentials.json` (logged-in OAuth session), `settings.json`
  (`freebuffModel`, `adsEnabled: true`, `hasSubmittedFirstPrompt: true`),
  and dozens of prior interactive chat transcripts under `projects/` for
  two other repos on this machine. It's a real, working, previously-used
  install, not a stub.

## `--help`, verified live

```
Usage: freebuff [options] [command]

Freebuff - Free AI coding assistant

Arguments:
  command                       Command to run (choices: "login")

Options:
  -v, --version                 Print the CLI version
  --continue [conversation-id]  Continue from a previous conversation
                                (optionally specify a conversation id)
  --cwd <directory>             Set the working directory (default: current
                                directory)
  -h, --help                    Show this help message
```

Only `login` is a valid subcommand argument (enforced — the parser rejects
anything else). No `-p`/`--print`, `--json`, `--headless`, `--yolo`, or
`--auto-approve` exists, unlike Cline's real CLI (v0.13 Part B).

## Checked for an undocumented flag or env var before concluding "no"

Ran `strings` against the 140MB binary directly, not just `--help`:

- All `--xxx`-shaped flag strings in the binary: the ones that look like
  CLI options (`--headless`, `--disable-gpu`, `--no-first-run`, etc.) belong
  to a bundled Chromium/Puppeteer component, not freebuff's own `commander`
  argument parser — freebuff itself only ever registers the five options
  shown above.
- Every `FREEBUFF_*` and `CODEBUFF_*` environment variable referenced
  anywhere in the binary (~130 distinct names) — telemetry event names,
  onboarding-funnel tracking, `CODEBUFF_DEBUG`, `CODEBUFF_GITHUB_ACTIONS`,
  etc. **None of them switch the CLI into a non-interactive/headless mode.**

## Live behavioral test: does it actually go non-interactive under a pipe?

Ran the real binary with stdin piped and stdout redirected to a file (the
same shape a `spawn()`'d child process gets from this repo's
`RuntimeAdapter`s), from a scratch directory, under a timeout:

```
echo "say hello and stop" | freebuff --cwd <scratch-dir> > out.log 2>&1 < /dev/null
```

Result: it did **not** exit or produce a machine-readable transcript. It
still launched its full alternate-screen TUI — the captured output is raw
ANSI escape sequences (cursor positioning, alt-screen enter/exit, an ad
banner box, since `adsEnabled: true`) — and hung until killed by the
timeout (exit code 124). This matches `launcher.js`'s own comment on why it
inherits stdio for the real binary: *"stdin/stdout stay inherited — the TUI
owns the terminal."* A piped/non-TTY stdin does not change that; the CLI
has no non-interactive branch to fall into.

## The one real lead: `@codebuff/sdk` — a different product, not verified free

The binary's strings reference `@codebuff/sdk`, and it is real and
published (`npm view @codebuff/sdk` → `0.10.7`, official, Apache-2.0,
maintained by the Codebuff team). Its README
(`client.run({ agent, prompt, handleEvent })`) is genuinely programmatic —
no TUI, no screen-scraping.

This is **not** the same thing as "Freebuff now has a headless CLI",
though, for two concrete reasons that block wiring it up as a
`FreebuffAdapter` right now:

1. **Different credential.** The SDK requires a `CODEBUFF_API_KEY` created
   at `codebuff.com/api-keys` — a distinct credential from the
   `authToken` already sitting in `~/.config/manicode/credentials.json`
   from the free CLI's `login` flow. Getting one means creating/signing
   into a Codebuff account on their website and generating a key there;
   nothing in this environment can do that non-interactively, and it isn't
   this agent's place to create third-party accounts on the user's behalf
   without asking first.
2. **Unverified billing.** The CLI's free tier is funded by
   `"freebucks"` (`freebuffModel`, `freebucksIntroSeenAt`,
   `freebucksShortfall`/`freebucksRefund` in the CLI's own strings) plus
   in-TUI ads (`adsEnabled: true`). Nothing in the SDK's docs or the
   binary's strings says an API key drawn against `@codebuff/sdk` shares
   that same free daily allowance rather than being billed separately as
   the paid "Codebuff" product. Shipping an adapter on an unverified
   billing assumption is exactly the kind of thing this build prompt says
   not to do.

If the user gets a `CODEBUFF_API_KEY` themselves and confirms how it's
billed, `@codebuff/sdk` is a real, legitimate integration point worth
revisiting — it just isn't "the free CLI now has headless mode," so it's
out of scope for this pass.

## Freebucks quota display — still not buildable

The build prompt also asked, conditionally, for a "remaining quota today"
display (mirroring the original v0.13 Part C idea) if a queryable balance
existed. It doesn't, for the same reason as before: there is no headless
entrypoint or documented public REST endpoint to attach a balance check to
— the only place "freebucks remaining" is ever shown is inside the
interactive TUI itself. Scraping that would be exactly the TUI
screen-scraping this build prompt (and v0.13 Part A before it) rules out.

## Conclusion — unchanged from v0.13 Part A, now first-hand

**No `FreebuffAdapter`.** The free `freebuff` CLI, actually installed and
tested at v0.0.175, has no headless/print/JSON mode, no env var that
unlocks one, and does not fall back to a non-interactive path even when
its stdin is piped — confirmed by running it, not by re-reading docs. No
`runtime: "freebuff"` agent is added to `AGENT_ROSTER`. This is an honest
re-stop: re-checked as instructed rather than skipped, same answer either
way. Revisit if Freebuff/Codebuff ever ships an official headless CLI mode,
or if the user separately sets up a `@codebuff/sdk` API key and confirms
its billing.
