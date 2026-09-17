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
