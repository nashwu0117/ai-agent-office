# Accessibility audit — 2026-09-17

Scope: `apps/web` only. Target: WCAG 2.1 AA. No backend, Orchestrator, WebSocket protocol, task data-flow, or feature-behaviour changes were made for this audit.

## Automated scans

Both Lighthouse runs used the same desktop page, Chromium build, and `--max-wait-for-load=5000` setting. The explicit wait cap is necessary because PixiJS continuously renders and therefore never becomes CPU-idle.

| Tool | Before | After | Result |
| --- | ---: | ---: | --- |
| Lighthouse 13.0.1 accessibility | 96 | 100 | The original `landmark-one-main` failure was fixed. No failing automated accessibility audits remain. |
| axe-core 4.11.0, WCAG 2.0/2.1 A+AA tags | 0 rules / 0 nodes | 0 rules / 0 nodes | No automated violations in either empty-state scan. |

The baseline axe result did not mean the page was fully accessible: automated rules did not detect that the clickable Pixi agents had no keyboard/DOM equivalent or that WebSocket state changes were not announced. Those gaps were found and verified manually and with the keyboard flow below.

Environment: Playwright 1.55.0 and Chrome for Testing 153.0.8010.12, 1440×1000 viewport.

## Contrast measurements

Ratios were calculated from the actual sRGB hex values with the WCAG relative-luminance formula. All text rows use the 4.5:1 normal-text threshold. The focus indicator uses the 3:1 non-text threshold.

| UI content | Foreground / background | Before | After | AA |
| --- | --- | ---: | ---: | --- |
| Primary text on panel | `#f4e4cb` / `#171a29` | 13.82:1 | 13.82:1 | Pass |
| Input placeholder | `#747c96` → `#929ab4` / `#0c0d16` | 4.67:1 | 6.92:1 | Pass, improved |
| Mint action button text | `#181724` / `#5fc98f` | 8.63:1 | 8.63:1 | Pass |
| Gold action button text | `#181724` / `#f3c66b` | 11.04:1 | 11.04:1 | Pass |
| Disabled button text | `#3d4359` / `#747c96` → `#f4e4cb` / `#3d4359` | 2.36:1 | 7.83:1 | Fixed |
| Secondary text on panel | `#b3bad0` / `#171a29` | 8.92:1 | 8.92:1 | Pass |
| Muted/Queue text on panel | `#c9bca9` / `#171a29` | 9.25:1 | 9.25:1 | Pass |
| Secondary text on input/tag | `#b3bad0` / `#0c0d16` | 10.00:1 | 10.00:1 | Pass |
| Muted text on input/tag | `#c9bca9` / `#0c0d16` | 10.37:1 | 10.37:1 | Pass |
| Failure text on danger background | `#ffd6d1` / `#792f3b` | 6.92:1 | 6.92:1 | Pass |
| CLI status on log background | `#5fc98f` / `#080910` | 9.69:1 | 9.69:1 | Pass |
| CLI prompt on log background | `#747c96` / `#080910` | 4.79:1 | 4.79:1 | Pass |
| Gold heading on panel | `#f3c66b` / `#171a29` | 10.77:1 | 10.77:1 | Pass |
| Agent keyboard button text | `#f4e4cb` / `#202337` | N/A | 12.38:1 | Pass |
| Focus indicator against input | `#fff2a8` / `#0c0d16` | N/A | 17.07:1 | Pass |

The two weak combinations were corrected even though disabled controls are exempt from WCAG text-contrast requirements. No measured key combination remains below AA.

## Keyboard flow

The proof run sent keyboard events only; it did not click controls. A test-only WebSocket replacement supplied deterministic agents and a blocked Queue task, while the production React event path remained unchanged.

1. `Tab` traversed the skip link and five agent buttons in visual order, then reached the high-level goal and workspace fields.
2. Text was entered and the form was submitted with `Enter`.
3. The resulting Master card and blocked Queue item appeared.
4. `Tab` reached the first capability checkbox and `Space` toggled it; the script asserted `checked === true`.
5. `Shift+Tab` returned through the same logical order to `agent-01`; `Enter` opened its detail panel.
6. The final focused control was `agent-01, available. Open agent details.` The detail heading was `agent-01`, the Queue exposed `Blocked — waiting on: task-active`, and the live region exposed `Task Add keyboard accessibility test is now blocked.`

Evidence:

- [Form filled, submit focused](accessibility-evidence/keyboard-01-form-submit.png)
- [Queue visible, capability checkbox operated](accessibility-evidence/keyboard-02-queue.png)
- [Agent keyboard control focused and detail panel open](accessibility-evidence/keyboard-03-agent-detail.png)

## Screen-reader and status coverage

- Added a `<main>` landmark and a keyboard-visible skip link.
- Added explicit labels for both forms' textareas and workspace inputs; form errors are linked with `aria-describedby`, marked invalid, and announced as alerts.
- Grouped capability checkboxes in a native `fieldset`/`legend`; native checkbox keyboard behaviour is retained.
- Marked the Pixi canvas presentation as hidden from assistive technology. A parallel DOM agent list exposes each agent's ID, textual state, progress, selection state, and the same detail-panel action.
- Added one polite, atomic status region for snapshot, agent state, task state, completion/failure, Master planning/summary, and credential-status changes.
- Added semantic headings, sections/articles, and a real ordered list for Queue items.
- Statuses do not rely on colour: ordinary failure uses `✕ Task failed`, security failure uses `⚠ Security failure`, dependency failure uses `✕ Blocked — dependency failed`, and authentication failure uses `🔑 Authentication failure`. Pending and blocked Queue states also include text and symbols.

## Visual trade-offs

- Placeholder grey is visibly lighter, and disabled buttons now use light text on a darker grey surface.
- Keyboard focus uses a 3 px pale-gold pixel-style outline. Focusing an agent reveals a compact DOM control strip over the lower canvas; it is hidden when no agent control has focus, so the normal scene composition and responsive layout remain unchanged.
- The capability heading now renders as a native fieldset legend, creating a small border notch.

No broader palette replacement or scene redesign was needed.
