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

The spacing scale is based on four pixels: `--fr-s1` through `--fr-s8` represent 4, 8, 12, 16, 20, 24, and 32 pixels. Radii are 4, 8, and 12 pixels. Controls share a 36-pixel compact height; the launcher is 44 pixels high.

The panel is flat internally: dividers and three neutral tones establish hierarchy. Only the launcher and top-level panel receive structural shadows. Rows, source records, uses, and plan steps remain unboxed and separated by one-pixel rules. The desktop panel defaults to 48 by 42 rem, supports native two-axis resize, and cannot exceed the viewport. Below 40 rem, it becomes a one-column panel with vertical-only resize; at 320 pixels it retains an eight-pixel viewport inset and a complete usable width.

## 5. Components and Interaction

- **Launcher:** compact fixed button, persistent during loading and errors; `aria-expanded` reflects the panel. Timeout changes its icon and label instead of hiding the failure.
- **Panel:** nonmodal, resizable Shadow DOM surface. Escape closes it and restores launcher focus.
- **Tabs:** Items, Skills, and Plan use `tablist`, `tab`, and `tabpanel`; roving `tabindex` supports Arrow keys, Home, and End.
- **Search:** native search input with a 140 ms debounce, label/ID matching, visible result count, and a 120-row initial cap.
- **Item browser:** selected row and complete detail show description, value, healing, icon only when art exists, deterministic and rare sources, and action/building uses.
- **Skill table:** native skill selector plus semantic captioned table for action level, interval, inputs, outputs, rare outputs, and tool requirements.
- **Planner:** the item combobox and `Until` selector lead to ordered goals using `In bag`, `New items`, `Skill level`, or `Minutes`, with queued prerequisites, blockers, and live progress visible. The current running plan is immutable, while pending goals may be added, edited, reordered, removed, or promoted during execution. `Run now` promotion interrupts the current action and starts the promoted goal. Run, Resume, and Stop call the direct executor; live phase, current step, and message use a polite atomic status region.
- **Buttons and controls:** one radius, height, border, focus ring, hover, active, disabled, and error vocabulary. Icons are stroked inline SVGs; no emoji or ornamental assets are used.

No component reads, writes, displays, or depends on the game's native queued-action system.

## 6. Motion, Responsiveness, and Accessibility

State transitions use `180ms cubic-bezier(0.16, 1, 0.3, 1)`, within the product's 150–220 ms response window. They are limited to color, border, opacity, and small direct-manipulation transforms. The loading line conveys unresolved data state; there are no entrance sequences or decorative animations. `prefers-reduced-motion: reduce` makes transitions and animations effectively instant.

The panel remains usable from 320-pixel viewports through desktop widths. Mobile structure stacks item browser and detail, collapses the planner form, and makes executor controls full-width without becoming a HUD. Native table overflow preserves dense skill data. Keyboard order follows launcher, tabs, active panel controls, content actions, then executor controls. Every interactive element has a visible two-pixel Harbor 400 focus ring with offset, all form fields have explicit labels, loading/status/error announcements use appropriate live regions, and every icon-only button has an accessible name.

The implementation deliberately excludes glass, gradients, colored side stripes, custom scrollbars, nested card grids, decorative motion, and oversized mobile-game controls.
