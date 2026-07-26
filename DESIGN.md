---
name: Fractured Realms Companion
description: A precise in-game item wiki and direct-action planner.
register: product
direction: The Quiet Helm
---

# Design System: Fractured Realms Companion

## 1. Overview

**Creative North Star: The Quiet Helm.** The companion is an instrument panel opened over an active game: quiet at rest, exact when queried, and explicit whenever it controls an action. Its compact density borrows the keyboard confidence of Raycast, the contextual restraint of the Steam overlay, and Linear's crisp state hierarchy without reproducing any of them.

The interface is a single Shadow DOM overlay with one compact launcher and one resizable panel. It uses flat tonal layers, familiar controls, short operational copy, and no decorative motion. Harbor blue identifies interaction and execution; brass marks provenance, rarity, and tool warnings. Together they remain below ten percent of the visible surface.

## 2. Colors

All implementation colors are OKLCH variables. Night Hull is a chroma-zero near-black so the overlay remains neutral over varied game scenes. Harbor is the seed-163 identity ramp; Instrument Brass is deliberately distinct in hue and lightness.

### Neutral — Night Hull

| Token | Value | Use |
|---|---|---|
| `--fr-neutral-1000` | `oklch(0.14 0 0)` | Panel background |
| `--fr-neutral-950` | `oklch(0.19 0 0)` | Header, toolbar, executor surface |
| `--fr-neutral-900` | `oklch(0.24 0 0)` | Controls and selected neutral surfaces |
| `--fr-neutral-800` | `oklch(0.32 0 0)` | Dividers |
| `--fr-neutral-700` | `oklch(0.42 0 0)` | Control borders |
| `--fr-neutral-300` | `oklch(0.78 0 0)` | Secondary text and placeholders |
| `--fr-neutral-100` | `oklch(0.94 0 0)` | Primary text |

Primary text reaches 13.8:1 or better across the three content surfaces. Secondary text reaches 4.7:1 or better on the lightest content surface. Placeholder text uses the same secondary token and therefore also clears 4.5:1.

### Primary — Harbor Signal

| Token | Value | Use |
|---|---|---|
| `--fr-harbor-950` | `oklch(0.20 0.04 230)` | Selected-row and signal-badge fill |
| `--fr-harbor-800` | `oklch(0.36 0.10 230)` | Signal borders and primary hover |
| `--fr-harbor-600` | `oklch(0.50 0.13 230)` | Primary action fill |
| `--fr-harbor-400` | `oklch(0.76 0.11 230)` | Focus, active tabs, selected data |

Harbor 400 reaches 5.1:1 or better against all content surfaces. Neutral 100 on Harbor 600 reaches approximately 4.71:1, clearing the 4.5:1 AA requirement for normal text.

### Secondary and semantic

| Token | Value | Use |
|---|---|---|
| `--fr-brass-950` | `oklch(0.24 0.04 85)` | Rare/tool-warning fill |
| `--fr-brass-700` | `oklch(0.45 0.09 85)` | Warning border |
| `--fr-brass-400` | `oklch(0.82 0.10 85)` | Warning and rare text |
| `--fr-danger-950` | `oklch(0.24 0.05 25)` | Error fill |
| `--fr-danger-400` | `oklch(0.76 0.12 25)` | Error text and border |
| `--fr-success-950` | `oklch(0.24 0.04 150)` | Completion fill |
| `--fr-success-400` | `oklch(0.75 0.12 150)` | Completion text |

Brass, danger, and success text tokens each clear 4.8:1 against the overlay surfaces. Every semantic state also includes text and an inline SVG icon, badge label, or control state; color never carries meaning alone.

## 3. Typography

The overlay uses one system sans stack for UI and one system monospace stack for comparable game data. There are no network fonts and no display face.

- **Sans:** `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Mono:** `ui-monospace, SFMono-Regular, Consolas, monospace`
- **Base:** `0.875rem / 1.45`
- **Detail heading:** `1.125rem / 1.25`, semibold, `-0.015em`
- **Panel identity:** `0.9375rem`, semibold
- **Body and table:** `0.8125–0.875rem`
- **Labels and metadata:** `0.75rem`, medium or semibold
- **Compact IDs and badges:** `0.6875rem`

Monospace is limited to item IDs, levels, quantities, intervals, progress, and other values players compare. Prose is capped near 68 characters and uses `text-wrap: pretty`.

## 4. Elevation and Layout

The spacing scale is based on four pixels: `--fr-s1` through `--fr-s6` represent 4, 8, 12, 16, 20, and 24 pixels, and `--fr-s8` represents 32 pixels. There is no `--fr-s7`. Radii are 4, 8, and 12 pixels. Controls share a 36-pixel compact height; the launcher is 44 pixels high.

The panel is flat internally: dividers and three neutral tones establish hierarchy. Structural shadows are limited to the launcher, the top-level panel, and the combobox popover that floats above panel content. Rows, source records, uses, and plan steps remain unboxed and separated by one-pixel rules. The desktop panel defaults to 48 by 42 rem, supports native two-axis resize, and cannot exceed the viewport. At or below 40 rem, it becomes a one-column panel with vertical-only resize. There is no separate 320-pixel breakpoint: the eight-pixel viewport inset at that width falls out of the `--fr-panel-gap` token and the panel's `calc(100vw - 2 * gap)` cap, which keeps a complete usable width down to 320 pixels.

## 5. Components and Interaction

- **Launcher:** compact fixed button, persistent during loading and errors; `aria-expanded` reflects the panel. Timeout changes its icon and label instead of hiding the failure.
- **Panel:** nonmodal, resizable Shadow DOM surface. Escape closes it and restores launcher focus.
- **Tabs:** Items, Skills, and Plan use `tablist`, `tab`, and `tabpanel`; roving `tabindex` supports Arrow keys, Home, and End.
- **Search:** native search input with label/ID matching, a visible result count, and result caps of 120 unfiltered rows and 240 for a query. Filtering is applied directly on `input`.
- **Item browser:** selected row and complete detail show description, value, healing, icon only when art exists, deterministic and rare sources, and action/building uses.
- **Skill table:** native skill selector plus semantic captioned table for action level, interval, inputs, outputs, rare outputs, and tool requirements.
- **Plan builder:** choose one of six typed targets — reach an item total, gain items, reach a skill level, reach a skill XP value, run an action for a count or duration, or use current stock — then add it to the prioritized queue. The engine resolves prerequisites into one ordered timeline; each step shows what it produces, its expected duration, and its live status (`Running`, `Ready`, `Later`, `Blocked`, `Needs you`, `Needs you later`, or `Done`). Manual instruction cards identify the action the player must take and show a wall-clock “ready for you at” estimate. Manual or currently blocked steps never pause independent runnable work; the scheduler resumes them when live state makes them startable and preempts a lower-priority action when a higher-priority step becomes available. Run and Stop call the direct executor; phase, current step, and message use a polite atomic status region.
- **Buttons and controls:** one radius, height, border, focus ring, hover, active, disabled, and error vocabulary. Icons are stroked inline SVGs; no emoji or ornamental assets are used.
- **Data-gap banner:** a warning banner below the header names the registries the installed game build did not yield, or the consistency checks that failed. The engine treats missing data as a zero bonus rather than an error, so the banner is what keeps an incomplete model from reading as a confident one.
- **Compact mode:** a header toggle collapses the panel to a single strip carrying the executor phase, message, progress, and start/resume/stop controls.
- **Placement:** launcher and panel are both draggable, and their positions persist across sessions.

No component reads, writes, displays, or depends on the game's native queued-action system.

## 6. Motion, Responsiveness, and Accessibility

State transitions use `180ms cubic-bezier(0.16, 1, 0.3, 1)`, within the product's 150–220 ms response window. They are limited to color, border, opacity, and small direct-manipulation transforms, plus the panel's own open and close transition. Motion is functional only: the loading line conveys unresolved data state, a spinner marks in-flight planning, and an attention pulse marks a state change that must not be missed. There are no decorative or ornamental animations. `prefers-reduced-motion: reduce` makes transitions and animations effectively instant.

The panel remains usable from 320-pixel viewports through desktop widths. At or below 40 rem the item browser and detail stack and the planner form fields go full width; the planner itself stays expanded and the executor controls keep their icon-button group rather than stretching. Native table overflow preserves dense skill data. Keyboard order follows launcher, header controls, then the tab bar — which holds the tabs and the executor controls together — then the active panel's content. Every interactive element has a visible two-pixel Harbor 400 focus ring with offset, all form fields have explicit labels, status and error announcements use appropriate live regions, and every icon-only button has an accessible name.

The implementation deliberately excludes glass, gradients, colored side stripes, custom scrollbars, nested card grids, decorative motion, and oversized mobile-game controls.

## 7. Known deviations

These three points describe design intent the shipped overlay does not yet meet. They are recorded so the gap stays visible rather than being quietly rewritten away.

- **Search is not debounced.** Filtering runs on every `input` event. A debounce near 140 ms was intended.
- **The spacing scale skips 28 pixels.** `--fr-s7` was intended between `--fr-s6` and `--fr-s8` but is not declared, so no rule can use it.
- **Mobile executor controls are not full-width.** Below 40 rem they stay an icon-button group; only the plan toolbar's actions widen.
