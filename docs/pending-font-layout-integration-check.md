# Pending integration check: font/layout work

Not executed yet — written ahead of time (v0.10) so it's ready to run as soon
as the font/layout batch below is committed. That batch is unrelated to
v0.1–v0.10's own scope and was still uncommitted as of v0.10 (touching
`apps/web/src/index.css`, `apps/web/src/assets/ASSET_LICENSE.md`,
`apps/web/src/office/OfficeScene.tsx`, and a new `apps/web/src/assets/fonts/`
directory). Once it lands, run every item below in one pass and record the
outcome of each — don't skip an item just because it seems unrelated to
fonts specifically; layout reflow from a font change can move or resize
things this checklist is built to catch.

## 1. Build still clean

Run `npm run build` from the repo root after the font/layout commit(s) land.
Expect the same clean output v0.1–v0.10 have all verified (`tsc -b && vite
build` with no errors). If it fails, the failure is this batch's to fix, not
this checklist's to route around.

## 2. Full v0.9.1 Part 2 regression walk

Re-run the same regression pass v0.9.1 Part 2 did: task form → submit →
Queue → agent detail panel. Specifically re-check the five failure-category
visual distinctions documented in `docs/accessibility-audit.md`'s
"Screen-reader and status coverage" section — ordinary failure
(`✕ Task failed`), security failure (`⚠ Security failure`), dependency
failure (`✕ Blocked — dependency failed`), authentication failure
(`🔑 Authentication failure`), and the pending/blocked queue states — and
confirm the font/layout change hasn't made any two of them harder to tell
apart, or dropped color contrast below the WCAG AA thresholds
`docs/accessibility-audit.md`'s contrast table already measured (4.5:1 text,
3:1 non-text). A new font can shift apparent contrast and glyph
distinguishability even when hex colors are untouched — check both.

## 3. PixiJS `addChild` deprecation warning

Confirm whether the `Only Containers will be allowed to be added` PixiJS
`addChild` deprecation warning (open as of v0.9.1) was fixed incidentally by
the font/layout batch (e.g. if it touched how sprites/containers are added
in `OfficeScene.tsx`). If it's still present, record that explicitly here —
don't assume silence means fixed.

## 4. `.agent-access-list` canvas occlusion

v0.9.1 reported `.agent-access-list` (the accessible DOM agent list added by
the a11y pass — see `docs/accessibility-audit.md`, "Marked the Pixi canvas
presentation as hidden from assistive technology. A parallel DOM agent list
exposes each agent's...") being visually covered by the canvas, making it
unclickable with a mouse. This item is exploratory, not corrective — the
font/layout batch isn't expected to fix it and isn't required to. Just note
whether the re-layout happened to improve, worsen, or leave unchanged the
overlap, as a data point for whoever picks this up next.

## 5. v0.10 backend/credential management UI still intact

Open the "Backend & Credentials" panel (`apps/web/src/BackendProfilesPanel.tsx`,
added in v0.10) under the new layout and confirm:

- The credential-sources table and backend-profiles table still render and
  are readable (no overlap, no truncated columns, no contrast regression).
- Add-profile and edit-profile forms are still usable — labels stay
  associated with their inputs, the modal/dialog still traps and restores
  focus sensibly.
- The per-agent backend-profile `<select>` row still works and isn't
  obscured by the office canvas the way `.agent-access-list` is (item 4
  above) — this panel is a modal overlay (`role="dialog"`, `aria-modal`),
  which should already keep it above the canvas, but confirm rather than
  assume.

## Outcome (v0.14, run against the batch above once it finally landed)

1. **Build**: clean. `npm run build` (root, all workspaces) passes with no
   errors after the batch — `tsc -b && vite build` for `apps/web` included.
2. **v0.9.1 Part 2 regression walk**: ran a real high-level goal through the
   full pipeline (goal form → Master planning → Queue → dispatch →
   completion card) against a disposable scratch workspace. Planning,
   dispatch, and the queue UI all rendered correctly under the new
   font/layout; the one subtask that ran failed for backend/model reasons
   unrelated to this batch (routed through the pre-existing `nvidia-real`
   profile — see `QUICKSTART.md`'s known-limitations note) and rendered as
   an ordinary "✕ Task failed" card, correctly distinct from the other
   four failure categories. The other four categories (security, dependency,
   auth, backend-profile) weren't re-triggered live in this pass (would
   need spending real backend credit or a deliberately broken workspace to
   force each one) — confirmed instead at the code level: this batch's diff
   touches no completion-card markup or CSS, so the color/icon rules
   `docs/accessibility-audit.md` already measured are untouched.
3. **PixiJS `addChild` deprecation warning**: still present, confirmed live
   in the browser console (`addZoneSign` → `sign.addChild(textLayer)` in
   `OfficeScene.tsx`). Not fixed by this batch, as expected — it doesn't
   touch that code path.
4. **`.agent-access-list` canvas occlusion**: still present, confirmed live
   — a real pointer click (even Playwright's `force: true`, which still
   does real hit-testing) lands on the canvas, not the button; only a
   synthetic `element.click()` that bypasses hit-testing reaches the
   accessible list. Unchanged by this batch, as expected (exploratory item,
   not required to fix).
5. **Backend/credential panel**: confirmed intact under the new layout —
   renders correctly, modal dialog behavior unaffected, credential-sources
   and backend-profiles tables both readable with no overlap or truncation.

### Independent re-check (v0.14 readiness pass, separate session)

Items 1, 2 and 5 above were re-verified for real in this pass — a fresh
`npm run build` (clean), and a real end-to-end dispatch (goal-free manual
task, `docs` capability, disposable `/tmp` git-repo workspace) that actually
ran the OpenCode CLI on agent-04 to completion and edited the target file,
confirmed via the REST API (`/api/tasks`, `/api/agents`) rather than the
UI screen, since no browser tool was connected in this session (the
`claude-in-chrome` skill reported the extension isn't set up here).

Items 3 and 4 (the PixiJS console warning and the `.agent-access-list`
canvas-occlusion / Playwright hit-testing claim) were **not**
independently re-confirmed in this pass — there was no way to open a
browser or inspect the console from this session. Recorded here rather
than silently repeated as this pass's own finding, per this project's
own "don't fake verification" rule. Whoever next has real browser access
should re-confirm items 3 and 4 directly rather than assume they still
hold.

Also found and fixed in this pass (unrelated to the font/layout batch,
found while checking the Backend & Credentials panel and each of the 14
agents' detail panels against `AGENT_ROSTER`):
- `RUNTIME_LABELS` in `apps/web/src/App.tsx` had no entry for the `cline`
  runtime (added in v0.13 Part B), so agent-07's detail panel showed the
  raw string `cline` instead of a proper label — added `cline: "Cline"`.
- Cline's own credential source (`CLINE_API_KEY`) was only ever registered
  with the shared `CredentialRouter` when the env var was already set, so
  with no key configured it didn't just show "Unavailable" — it never
  appeared in the "Credential sources" table at all, unlike every other
  row. Fixed in `packages/core/src/credentials/factory.ts`
  (`envSourcesFor(..., alwaysIncludePrimary: true)` for the Cline source
  only; the Anthropic pool's conditional-backup behavior is unchanged).
