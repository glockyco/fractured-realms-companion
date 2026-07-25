# Purpose

This repository contains a Node/TypeScript CLI, an injected Electron host and game adapter, and a Shadow DOM companion overlay. Read [README.md](README.md) for player installation and operations, [PRODUCT.md](PRODUCT.md) for product intent, and [DESIGN.md](DESIGN.md) for UI rules. `.impeccable/design.json` carries the active overlay constraints (WCAG 2.2 AA, Shadow DOM, zero dependencies, no gradients, no glass, no custom scrollbars, no decorative motion, no native queued-action integration); it is tracked, so read it before changing the overlay.

This repository has no `docs/plans/` directory and no plan lifecycle of its own.

## Commands

Use Node 24 for development, matching CI, and start with `npm ci`.

- Scoped loop: `node scripts/embed-runtime.mjs && node --test tests/<area>/<file>.test.ts`
- Final source gates: `npm test` and `npx tsc --noEmit`, as separate commands.
- Package build: `npm run build`
- Before any `node dist/cli.js …` command: `npm run build`. `dist/` is gitignored and only the build emits it; `npm ci` and `npm test` do not.

There is no lint or format script and no ESLint, Prettier, or Biome config. Do not invent one or treat one as a gate.

Runtime npm dependencies are intentionally absent. Bun is required for the standalone release build and is also one of the two supported SQLite drivers: `src/lib/sqlite.ts` loads `bun:sqlite` under Bun and `node:sqlite` otherwise. `npm test` and `npm run build` embed runtime assets as a side effect.

Playwright is a devDependency, but `npm ci` does not install its browser. The live wrappers require `npx playwright install chromium` once.

## Architecture

- `src/` contains the CLI, extraction, platform discovery, and patch/state orchestration. `src/model/compile.ts` owns the model schema and its integrity checks, `src/model/sqlite.ts` owns the derived projection, and `src/lib/asar.ts` owns archive reads and packing.
- `runtime/*.cjs` contains the in-game Electron host and adapter.
- `overlay/*.js` contains the UI and direct-action executor; `overlay/engine/*.js` contains model indexing, formulas, planning, simulation, and queue resolution.
- `tests/` mirrors these areas. `scripts/embed-runtime.mjs` embeds runtime and overlay sources into the ignored `src/generated/embedded.ts`.
- Edit `runtime/` and `overlay/` source files, never the generated copy. Treat `dist/` and `runtime/fractured-companion-host-*/` as generated or temporary. `tests/fixtures/fractured-realms/electron/` is the opposite: a hand-maintained patch fixture that `tests/patch/fractured-adapter.test.ts` copies, so editing it changes what the adapter tests prove.
- `package.json` publishes only `dist`, `runtime`, and `overlay`. A refreshed companion pack has `pack.json`, `overlay.js`, `executor.js`, `engine/*.js`, and `data/model.json`.
- Two schema numbers exist and are not interchangeable: `pack.json` is schema version 2, and the model inside it (`data/model.json`) is schema version 1.
- The patched game entry point loads `steamworks.js` from the installed game's own `node_modules`, caching a few files under the game's userData directory. Never add `steamworks.js` to this project's dependencies.

## Game data inspection

Follow this read-only decision path when answering questions about game data:

1. If the active install, Steam build, archive, or companion-pack status is unknown, run `node dist/cli.js doctor --json` (after `npm run build`). See [README.md#steam-discovery](README.md#steam-discovery) for supported default roots. `src/platform/steam.ts` and `src/platform/state.ts` are the maintained sources for install and state discovery. Refer to the archive portably as `<installDir>/resources/app.asar`.
2. Prefer the compiled model at `<stateDir>/pack/data/model.json` (model schema version 1) and its derived SQLite projection at `<stateDir>/model.db`. If a companion instance is already running, the model is available without an API token at `http://127.0.0.1:48766/companion/data/model.json`. For supported read-only queries, use `node dist/cli.js model info` or `node dist/cli.js model sql "SELECT ..."`; do not launch or refresh the game solely to inspect data.
3. If the requested fact is absent from the compiled model, mirror the read-only archive-selection path in `refreshCompanion` from `src/refresh.ts`: use the pristine archive or its verified immutable backup, locate the sole `dist/assets/index-*.js` renderer bundle with `listFiles`, and read it with `extractFile` from `src/lib/asar.ts`. Use the validated extraction anchors in `src/extract/registries.ts` and normalization in `src/model/compile.ts` as examples rather than inferring facts from IDs or tier names.

Check `model.extraction` before trusting a registry: `unavailable` lists registries this build did not yield, and `integrity` lists failed cross-registry checks. `model info` prints both on an `extraction:` line. A registry can be legitimately empty, and `prestige` is `null` rather than empty when it is unavailable.

State whether evidence came directly from the compiled model or was recovered from the renderer bundle. Never infer an unmodeled requirement from a naming convention. The archive rules under **Safety boundaries** govern this workflow: never hand-edit, unpack/repack, or bypass checks.

## Tests

- Overlay changes map to `tests/overlay/*.test.ts`; engine changes also map to `tests/overlay/engine/engine.test.ts`, which that glob does not cover.
- CLI, patch, and platform changes map to the corresponding mirrored test file under `tests/`.
- The real-bundle extraction census is opt-in and is skipped by plain `npm test`. Run it against a pristine archive or its verified immutable backup: `FR_BUNDLE_ASAR=<path to app.asar> node --test tests/extract/registries.test.ts`. It asserts floors and completeness, not exact content counts, so legitimate new game content does not fail it.
- For release binary changes, run `node scripts/smoke-binary.mjs PATH_TO_BINARY` after the exact Bun compile performed by `.github/workflows/release.yml`.
- `npm test` and `npm run build` regenerate ignored embedded output. A local Bun build alone does not reproduce the four-OS release matrix.

## Safety boundaries

These commands touch a real game install, so run them deliberately rather than as reflexive validation. Distinguish data-only work from archive or live-game mutation:

- `refresh --no-patch` recompiles the model and pack from the pristine archive (or its verified immutable backup), rebuilds `model.db` when a SQLite driver is available, and writes only state-directory files. `export-sheets` publishes that derived data to the shared canonical spreadsheet: it creates and rewrites a tab per model table plus an Overview tab, and prunes tabs for tables the model no longer has, skipping the delete when that would empty the workbook. It needs `model.db` and a SQLite driver even for `--dry-run`, and a successful env-var publish records the spreadsheet id under `~/.config/fractured-realms-companion/`. Neither command mutates the game archive. Run them when the task calls for regenerating or deploying data (for example, after an extraction change) — no `backup-saves`/`live-validate` prerequisite applies.
- `refresh` (patching), `restore`, `launch`, and `relaunch` mutate the installed archive or drive the live game. Run them only when the task explicitly requires it, never merely to inspect data.
- `npm run validate:live` refreshes and patches the install before launching unless given `--no-refresh`; it also accepts `--keep-open`, `--skip-backup-check`, and `--fresh`. It does not take a backup: it only checks for a save-backup manifest newer than 24 hours, so run `npm run backup-saves` yourself first.
- `npm run screenshots` drives the already-refreshed live game and overwrites the committed `docs/screenshots/*.webp`; its `--export-save` mode overwrites the committed `docs/screenshots/fixture-save.json`.

Preserve fail-closed fingerprint, metadata, backup, foreign-marker, and source-anchor checks. Never hand-edit a game archive or bypass native-game refusal checks. Never read, write, or depend on the game's native `actionQueue`. When an entry-point anchor no longer matches, the refusal names the exact anchor — report that string rather than loosening the check.

Extraction is the one deliberate exception to fail-closed, and it has its own rules:

- Anchors in `src/extract/registries.ts` must key on game content (ids, object keys, player-visible strings) or literal structure, never on a minifier-assigned identifier such as `cb=` or `eM=`: the mangler reassigns those on every game rebuild. `anchor()` enforces this and throws `AnchorHygieneError`.
- `items`, `actions`, `actionGates`, `skills`, and `xp` abort a refresh. Every other registry degrades to an empty value — `prestige` to `null` — and is recorded in `model.extraction.unavailable`. An `AnchorHygieneError` aborts the refresh from any registry, optional included, because it is our bug rather than a game change.
- `compileModel` additionally reports cross-registry findings under exactly four names: `item-refs`, `skill-refs`, `shop-prices`, and `xp-curve`.
- A gapped build is not a failed one. `refresh` prints `Incomplete game data for this build: …` and still exits `0`, and `doctor` reports it as a `model` row with status `WARN`. `WARN` is the only non-`PASS`, non-`FAIL` status; only `FAIL` rows block `doctor` and `launch`.
- Patching stays strictly fail-closed.

## Commits and releases

Use Conventional Commits. `commitlint.config.cjs` defines the policy: allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`; types and scopes are lowercase, subjects are non-empty, start lower-case, and have no terminal period, headers are at most 72 characters, and a body must be preceded by a blank line. Nothing enforces this automatically — there is no hook, no CI job, and commitlint is not a dependency — so validate deliberately with `npx commitlint --from <base> --to HEAD`. In OMP, create body commits through `bun skill://commit/commit-helper.ts`.

Only `v*` tag pushes trigger `.github/workflows/release.yml`. CI (`.github/workflows/ci.yml`) runs `npm test` and `npx tsc --noEmit` on Node 24 across Ubuntu, macOS, and Windows for every push and pull request. Do not infer branch, PR, changelog, or version-bump policy here.
