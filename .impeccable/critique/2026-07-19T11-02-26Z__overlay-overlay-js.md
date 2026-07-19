---
target: overlay/overlay.js
total_score: 28
p0_count: 0
p1_count: 2
timestamp: 2026-07-19T11-02-26Z
slug: overlay-overlay-js
---
## Design Health Score

Current score after the identifier, empty-state, copy, and header cleanup:

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Selection and blocked states are clear. Pre-run guarantees remain too vague. |
| 2 | Match between system and real world | 3 | Player labels now replace internal IDs. A few concepts such as Interval still assume game-system familiarity. |
| 3 | User control and freedom | 3 | Close, Escape, Run, and Stop are available. The exact effect of Stop is not explained. |
| 4 | Consistency and standards | 3 | The visual and interaction systems are consistent. Items has search while Plan uses a large native select. |
| 5 | Error prevention | 4 | The empty initial state, required target, quantity bound, blockers, and locked execution controls prevent obvious mistakes. |
| 6 | Recognition rather than recall | 3 | Item details co-locate sources and uses. Finding one target among 523 plan options still relies on recognition. |
| 7 | Flexibility and efficiency | 2 | Item search and tab keyboard navigation are useful. Plan lacks search, filters, recent items, and an open or focus shortcut. |
| 8 | Aesthetic and minimalist design | 4 | The quiet visual system is disciplined. Large empty areas and always-visible disabled executor controls still dilute focus. |
| 9 | Error recovery | 2 | Blockers are specific. Generic resolution failures and action interruption do not expose a strong recovery path. |
| 10 | Help and documentation | 1 | The interface does not explain direct execution, Stop behavior, or the difference between source and use relationships. |
| **Total** | | **28/40** | **Good foundation with important workflow gaps** |

The baseline assessment before the current cleanup scored 24/40. The four-point improvement reflects changes directly verified in the live panel: internal IDs are gone, the initial item and plan states no longer select irrelevant endgame content, blocker language is clearer, and the redundant subtitle and icon fact are gone.

## Anti-Patterns Verdict

**LLM assessment:** The overlay does not look obviously AI-generated. It avoids gradients, glass, glow, decorative card grids, oversized controls, and ornamental motion. The near-black surfaces, restrained blue accent, compact controls, and flat dividers form a coherent in-game instrument. The main risk is product-generic structure. Dense tables, a huge native selector, and large empty executor space can still feel like developer tooling rather than a companion shaped around player intent.

**Deterministic scan:** The static detector reported 0 findings in `overlay/overlay.js`. The browser detector reported 24 findings, all from the game page behind the Shadow DOM overlay. Those are false positives for the companion. No detector finding exposed an additional companion issue.

**Visual overlays:** No reliable user-visible detector overlay is available. The browser scan did not pierce the companion Shadow DOM.

## Overall Impression

The item wiki is the strongest part. It answers a player question in one place and hands the selected item to planning. The single biggest opportunity is target discovery and execution trust in Plan. A 523-item native select and unexplained Run or Stop guarantees are weak at the exact point where the companion takes control of the game.

## What Is Working

1. **Quiet, coherent visual system.** Tonal layers, thin dividers, compact radii, restrained blue, and consistent controls stay legible without competing with the game.
2. **Excellent item information co-location.** Description, value, guaranteed and rare sources, requirements, downstream uses, and the Plan this item handoff remain visible in one split view.
3. **Strong accessibility foundations.** Real tabs, labels, buttons, table semantics, visible focus, an alert banner, and an atomic live executor status provide a solid base.

## Priority Issues

### [P1] Plan target discovery does not scale

**Why it matters:** Desired item contains 523 alphabetized options in a native select. Players who know the target still have to type-select or scroll. Players who do not know the canonical name have no discovery path.

**Fix:** Reuse a searchable combobox. Rank the currently inspected item, recent targets, inventory-relevant targets, and current-skill outputs first. Add category filters and keep search-all as the escape hatch.

**Suggested command:** `/impeccable clarify`

### [P1] Direct actions do not yet earn automation trust

**Why it matters:** Run and Stop control the live game, but the pre-run interface does not say what starts, what may be interrupted, or what Stop guarantees. Cautious players may refuse to use it. Incautious players may start the wrong action.

**Fix:** Before Run, show the first action, step count, tool state, and one operational guarantee. Label the primary action with intent, such as Start 4-step plan. Explain exactly what Stop does.

**Suggested command:** `/impeccable clarify`

### [P2] Large collections need stronger navigation

**Why it matters:** Items renders at most 120 focusable rows, Skills exposes 21 options and dense six-column tables, and Plan exposes 523 options. Search only mitigates Items. Keyboard and screen-reader users face long traversal paths.

**Fix:** Add category and skill filters, result grouping, recent selections, and a direct focus shortcut. Keep item detail reachable without tabbing through every result.

**Suggested command:** `/impeccable harden`

### [P2] The executor occupies attention before it is useful

**Why it matters:** Disabled Run and Stop controls and a large empty body remain prominent before a valid plan exists. The state is safe but visually unfinished.

**Fix:** Collapse the executor into a quiet status row until a plan exists. Expand it when there is a runnable plan, a blocker, or active execution.

**Suggested command:** `/impeccable distill`

## Persona Red Flags

**Alex, power user:** An arbitrary target is slow to reach in the 523-option select. There is no visible shortcut to open the companion or focus item search. Skills and Plan require serial selection instead of supporting rapid filtering.

**Sam, keyboard and screen-reader user:** Up to 120 item rows are focusable. Reaching Plan this item by linear tab navigation can be expensive. Loading has a label but no explicit live-status role. Positive signals include visible focus, correct tabs, labeled fields, table semantics, and live executor status.

**Jordan, first-timer:** The new empty state is better, but there is still no contextual help at the transition from reading an item to controlling live game actions. Run and Stop appear before Jordan understands their operational contract.

## Minor Observations

- The launcher remains visible while the panel is open, creating a second close affordance beside the header close button.
- The 120-result cap is transparent, but there is no continuation or category browse control.
- The Skills table is an appropriate primitive for dense data. Its selector and filtering model need more work than its visuals.
- Rare and guaranteed badges communicate meaning with text and color, which is a good non-color state pattern.
- The panel can cover most of the active game and may appear above unresolved game onboarding.

## Questions to Consider

- Is the companion primarily a wiki, a planner, or an action cockpit? Which task should own the first-run state?
- What exact promise must the interface make before a player trusts Run?
- Should Plan lead with the currently inspected item, inventory, current action, or current skill?
- Should the companion defer opening when the game has an unresolved modal task?
