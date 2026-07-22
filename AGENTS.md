# Purpose

This repository contains a Node/TypeScript CLI, an injected Electron host and game adapter, and a Shadow DOM companion overlay. Read [README.md](README.md) for player installation and operations, [PRODUCT.md](PRODUCT.md) for product intent, and [DESIGN.md](DESIGN.md) for UI rules.

## Commands

Use Node 24 for development and start with `npm ci`.

- Scoped loop: `node scripts/embed-runtime.mjs && node --test tests/<area>/<file>.test.ts`
- Final source gates: `npm test` and `npx tsc --noEmit`, as separate commands.
- Package build: `npm run build`

Runtime npm dependencies are intentionally absent. Bun is required only for the standalone release build. `npm test` and `npm run build` embed runtime assets as a side effect.

## Architecture

- `src/` contains the CLI, extraction, platform discovery, and patch/state orchestration.
- `runtime/*.cjs` contains the in-game Electron host and adapter.
- `overlay/*.js` contains the UI and direct-action executor; `overlay/engine/*.js` contains model indexing, formulas, planning, simulation, and queue resolution.
- `tests/` mirrors these areas. `scripts/embed-runtime.mjs` embeds runtime and overlay sources into the ignored `src/generated/embedded.ts`.
- Edit `runtime/` and `overlay/` source files, never the generated copy. Treat `dist/` and `runtime/fractured-companion-host-*/` as generated or temporary.
- `package.json` publishes only `dist`, `runtime`, and `overlay`. A refreshed companion pack uses schema version 2 with `pack.json`, `overlay.js`, `executor.js`, `engine/*.js`, and `data/model.json`.

## Game data inspection

Follow this read-only decision path when answering questions about game data:

1. If the active install, Steam build, archive, or companion-pack status is unknown, run `node dist/cli.js doctor --json`. See [README.md#steam-discovery](README.md#steam-discovery) for supported default roots. `src/platform/steam.ts` and `src/platform/state.ts` are the maintained sources for install and state discovery. Refer to the archive portably as `<installDir>/resources/app.asar`.
2. Prefer the compiled model at `<stateDir>/pack/data/model.json` (schema version 2) and its derived SQLite projection at `<stateDir>/model.db`. If a companion instance is already running, the model is available without an API token at `http://127.0.0.1:48766/companion/data/model.json`. For supported read-only queries, use `node dist/cli.js model info` or `node dist/cli.js model sql "SELECT ..."`; do not launch or refresh the game solely to inspect data.
3. If the requested fact is absent from the compiled model, mirror the read-only archive-selection path in `refreshCompanion` from `src/refresh.ts`: use the pristine archive or its verified immutable backup, locate the sole `dist/assets/index-*.js` renderer bundle with `listFiles`, and read it with `extractFile` from `src/lib/asar.ts`. Use the validated extraction anchors in `src/extract/registries.ts` and normalization in `src/model/compile.ts` as examples rather than inferring facts from IDs or tier names.

State whether evidence came directly from the compiled model or was recovered from the renderer bundle. Never infer an unmodeled requirement from a naming convention. The archive rules under **Safety boundaries** govern this workflow: never hand-edit, unpack/repack, or bypass checks.

## Tests

- Overlay engine and executor changes map to `tests/overlay/*.test.ts`.
- CLI, patch, and platform changes map to the corresponding mirrored test file under `tests/`.
- For release binary changes, run `node scripts/smoke-binary.mjs PATH_TO_BINARY` after the exact Bun compile performed by `.github/workflows/release.yml`.
- `npm test` and `npm run build` regenerate ignored embedded output. A local Bun build alone does not reproduce the four-OS release matrix.

## Safety boundaries

Do not run `refresh`, `restore`, `launch`, or `relaunch` as routine validation. They inspect or mutate an installed game and are appropriate only for explicitly required live integration. Live validation happens only through `scripts/live-validate.mjs` after `scripts/backup-saves.mjs`, which are the sanctioned wrappers for the otherwise-prohibited refresh and launch.

Preserve fail-closed fingerprint, metadata, backup, foreign-marker, and source-anchor checks. Never hand-edit a game archive or bypass native-game refusal checks. Never read, write, or depend on the game's native `actionQueue`.

## Commits and releases

Use Conventional Commits checked by `commitlint.config.cjs`: allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`; types and scopes are lowercase, subjects have no terminal period, and headers are at most 72 characters. In OMP, create body commits through `bun skill://commit/commit-helper.ts`.

Only `v*` tag pushes trigger `.github/workflows/release.yml`. Do not infer branch, PR, changelog, or version-bump policy here.
