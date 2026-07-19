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
- `overlay/*.js` contains the UI, planner, and direct-action executor.
- `tests/` mirrors these areas. `scripts/embed-runtime.mjs` embeds runtime and overlay sources into the ignored `src/generated/embedded.ts`.
- Edit `runtime/` and `overlay/` source files, never the generated copy. Treat `dist/` and `runtime/fractured-companion-host-*/` as generated or temporary.
- `package.json` publishes only `dist`, `runtime`, and `overlay`.

## Tests

- Overlay, planner, and executor changes map to `tests/overlay/*.test.ts`.
- CLI, patch, and platform changes map to the corresponding mirrored test file under `tests/`.
- For release binary changes, run `node scripts/smoke-binary.mjs PATH_TO_BINARY` after the exact Bun compile performed by `.github/workflows/release.yml`.
- `npm test` and `npm run build` regenerate ignored embedded output. A local Bun build alone does not reproduce the four-OS release matrix.

## Safety boundaries

Do not run `refresh`, `restore`, `launch`, or `relaunch` as routine validation. They inspect or mutate an installed game and are appropriate only for explicitly required live integration.

Preserve fail-closed fingerprint, metadata, backup, foreign-marker, and source-anchor checks. Never hand-edit a game archive or bypass native-game refusal checks. Never read, write, or depend on the game's native `actionQueue`.

## Commits and releases

Use Conventional Commits checked by `commitlint.config.cjs`: allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`; types and scopes are lowercase, subjects have no terminal period, and headers are at most 72 characters. In OMP, create body commits through `bun skill://commit/commit-helper.ts`.

Only `v*` tag pushes trigger `.github/workflows/release.yml`. Do not infer branch, PR, changelog, or version-bump policy here.
