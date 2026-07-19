# Fractured Realms Companion

Fractured Realms Companion adds a build-matched item wiki and direct-action planner to **Fractured Realms**. It reads live inventory and skill state, explains dependencies, and runs one game action at a time from a local companion window.

Everything stays on the same machine and is matched to the installed game build. The companion never reads, writes, or depends on the game's native `actionQueue`.

## What it does

- **Items:** Search the current build by item name, then inspect descriptions, values, healing data, artwork, deterministic and rare sources, requirements, and downstream uses.
- **Skills:** Browse extracted skill actions with levels, intervals, tools, inputs, outputs, rare outputs, and locations. Available actions can be started directly from their table row.
- **Planner:** Choose an item with the searchable combobox, then set `Until` to `In bag`, `New items`, `Skill level`, or `Minutes`. Goals resolve against live inventory and deterministic projected outputs from earlier runnable plans. Already-held prerequisite quantities remain visible. Blocked goals stay queued and are retried at plan boundaries.
- **Live queue:** The running plan is immutable. Pending goals can still be added, edited, reordered, removed, or promoted. Choosing `Run now` for the first pending goal stops the current action and starts the promoted goal immediately.
- **Rare targets:** The planner estimates attempts from drop chance and provisions inputs for each run. If those inputs run out, the executor replans the live remainder until the inventory target is reached. Estimates are probabilistic, and multi-quantity drops may overshoot by one drop batch. Eight consecutive restocks with no target gain mark the goal `rare drops stalled` and skip it so later queued goals can continue.
- **Executor:** Run, resume, or stop queued steps through the game's direct start and stop controls. The executor verifies starts, reports progress and remaining time, detects game-side action changes, and surfaces refusals and stalls. Required Shop tools are permanent prerequisites and are never auto-crafted.
- **Local data:** `refresh` extracts the installed build's item, action, skill, XP, building, dig-site, string, and item-art data before applying the companion patch.

### Companion preview

| Build-matched item wiki | Extracted skill actions |
| --- | --- |
| Search an item, then inspect its sources, uses, stats, and artwork. | Compare action levels, timings, tools, outputs, and drop rates. |
| ![Ancient Spore item details with sources and uses](docs/screenshots/item-wiki.webp) | ![Archaeology actions with levels, intervals, outputs, and tools](docs/screenshots/skill-actions.webp) |

### Planner preview

![Minor Fire Rune plan with active Earthwort gathering and queued Copper Vein, Practice Inscription, and rune crafting steps](docs/screenshots/action-planner.webp)

## Requirements

- Fractured Realms Steam app `3789070` must be installed in a Steam library the companion can discover.
- The npm and npx paths require Node.js 20 or newer.
- Standalone release binaries include their runtime and require neither Node.js nor Bun.
- Linux launch support requires the `steam` command or a detected Flatpak Steam installation.
- macOS discovery targets Steam in a CrossOver bottle and expects the CrossOver `wine` launcher at `/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine`. Native macOS Fractured Realms installations are not a discovery target.

## Installation

Choose the npm package, npx, or one standalone release binary.

| Path | Install or download | Run |
| --- | --- | --- |
| npm, global | `npm install --global fractured-realms-companion` | `fractured-companion <command>` |
| npx, one-off | No installation | `npx --yes fractured-realms-companion <command>` |
| Windows x64 | Download [`fractured-companion-windows-x64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `fractured-companion-windows-x64.exe <command>` |
| Linux x64 | Download [`fractured-companion-linux-x64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `chmod +x ./fractured-companion-linux-x64` then `./fractured-companion-linux-x64 <command>` |
| macOS Apple silicon | Download [`fractured-companion-darwin-arm64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `chmod +x ./fractured-companion-darwin-arm64` then `./fractured-companion-darwin-arm64 <command>` |
| macOS Intel | Download [`fractured-companion-darwin-x64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `chmod +x ./fractured-companion-darwin-x64` then `./fractured-companion-darwin-x64 <command>` |

Every release includes `SHA256SUMS`. Download it beside the binary, then verify before running:

```sh
# Linux
sha256sum -c SHA256SUMS

# macOS
shasum -a 256 -c SHA256SUMS
```

The macOS binaries are unsigned. If macOS blocks one, try launching it once, open **System Settings → Privacy & Security**, and choose **Open Anyway** for that specific binary. Do not disable Gatekeeper globally or apply a permanent bypass. If local policy prohibits unsigned executables, use npm or npx instead.

## Quickstart

These examples use the globally installed command. An installed package, an npx invocation, or a downloaded binary invoked from `PATH` or by absolute path can be run from any directory.

Treat the first check as a diagnostic sequence:

```sh
fractured-companion doctor --json
fractured-companion refresh
fractured-companion doctor
fractured-companion launch
```

The first `doctor --json` is read-only. Before the first refresh it may report expected failures for missing extracted data, patch metadata, or companion state. `refresh` then extracts the current game data and patches the archive by default. Run `doctor` again and proceed to `launch` only when it reports no blocking failures.

`launch` runs the already-refreshed companion. It starts Fractured Realms with the companion flag, waits for the local host to become healthy, and opens `http://127.0.0.1:48766/`. It does not perform a refresh.

## Commands and options

| Command | Behavior | Command-specific option |
| --- | --- | --- |
| `doctor` | Read-only diagnostics for the install, state, patch, and local host | `--json` emits diagnostic rows as JSON |
| `refresh` | Extract current game data and update the companion patch | `--no-patch` extracts and validates without changing the archive |
| `restore` | Restore the verified original game archive | None |
| `launch` | Run the already-refreshed companion | `--no-open` leaves the browser closed |
| `relaunch` | Quit the project-owned running companion, refresh, and launch | `--no-open` leaves the browser closed |

Common options must follow the command:

- `--steam-root PATH` selects an explicit Steam root.
- `--bottle NAME` selects a CrossOver bottle on macOS. The default is `Steam`.

Examples:

```sh
fractured-companion doctor --steam-root "/path/to/Steam" --json
fractured-companion refresh --steam-root "/path/to/Steam" --no-patch
fractured-companion launch --bottle MySteam --no-open
```

Global help and version output are also available:

```sh
fractured-companion --help
fractured-companion --version
```

## Steam discovery

The companion checks these default Steam roots, then follows additional libraries from `steamapps/libraryfolders.vdf`.

| System | Steam installation searched |
| --- | --- |
| Windows | `%ProgramFiles(x86)%\Steam`, `%ProgramFiles%\Steam`, then the current user's Steam registry path |
| Linux | `~/.local/share/Steam`, `~/.steam/steam`, and `~/.var/app/com.valvesoftware.Steam/.local/share/Steam` |
| macOS | `~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/Program Files (x86)/Steam` |

Use `--steam-root PATH` for a non-standard root. On macOS, use `--bottle NAME` when Steam is not in the default `Steam` bottle.

## Updating, relaunching, and restoring

If `launch` reports that a companion with an outdated revision is running, use:

```sh
fractured-companion relaunch
```

`relaunch` requests shutdown only from the project-owned companion, waits up to 30 seconds, refreshes, and launches. If the game does not exit within that shutdown window, close it manually and retry.

After a Steam update replaces the archive or build ID, run:

```sh
fractured-companion refresh
fractured-companion doctor
fractured-companion launch
```

If changed source anchors make the new build unsafe to patch, `refresh` stops before writing. Do not force the patch.

To restore the original archive:

```sh
fractured-companion restore
```

Restore is guarded by the Steam build metadata, companion marker, installed patched fingerprint, and verified immutable backup. It refuses mismatched or unknown state.

### External legacy prerequisite

If the separate `crossover-electron-bridge` project previously patched Fractured Realms, restore that archive from its own `crossover-browser-games` checkout before using this package:

```sh
cd ~/Projects/crossover-browser-games
PYTHONPATH=src python3 -m crossover_electron_bridge restore fractured-realms
```

Then return to this package and run `fractured-companion refresh`. This package does not own the legacy command and intentionally refuses to overwrite an archive carrying the old bridge marker.

## Safety and local state

- The browser host binds only to `127.0.0.1:48766`. API requests require a per-process token and matching `Host` and `Origin` headers. Request bodies are limited to 64 KiB. A foreign service on that port is a blocking diagnostic failure.
- Patching fails closed. The companion fingerprints the archive, rejects foreign markers and unexpected or ambiguous source anchors, stages changes, verifies installed bytes, and records exact metadata. Concurrent changes or metadata mismatches stop the operation.
- The original archive backup is immutable and hash-named. `restore` revalidates metadata, fingerprints, marker ownership, Steam build identity, and backup bytes before writing.
- State is separate from the game install. Windows uses `%LOCALAPPDATA%\fractured-realms-companion`. Other platforms use `$XDG_STATE_HOME/fractured-realms-companion` or `~/.local/state/fractured-realms-companion`.
- The local achievement route delegates to the native Steamworks client. It validates achievement names and reports missing-client or native failures instead of fabricating achievement state.
- Direct execution uses only the game's current action controls. It never reads, writes, displays, or depends on the native `actionQueue`.

## Limitations

- Extraction and patching are build-sensitive. A changed game bundle or entrypoint anchor requires a compatibility update before that build can be patched.
- Rare-attempt counts and completion times are estimates, not guarantees. A multi-quantity rare drop may exceed the requested inventory target by one drop batch.
- Required Shop tools are permanent unlocks and must already be purchased. The planner does not auto-craft them.
- A new item plan may be blocked when the bag has no free slot. A direct action may also be refused by the game. A persistent outside action pauses execution, and an ordinary action with no progress reports a stall. The companion surfaces these states rather than bypassing game checks.
- Starting a planned action stops active combat.
- macOS support targets Steam in CrossOver. The standalone macOS binaries are unsigned.

## Development

Use Node.js 24 for development, matching CI:

```sh
npm ci
npm test
npm run build
npx tsc --noEmit
```

`npm test` and `npm run build` run `scripts/embed-runtime.mjs` first, which embeds the runtime and overlay sources. Runtime npm dependencies are intentionally absent. See [AGENTS.md](AGENTS.md) for the scoped coding-agent workflow and repository safety boundaries.

The source of truth for releases is [`.github/workflows/release.yml`](.github/workflows/release.yml). `v*` tags build four standalone targets and `SHA256SUMS`. npm publishing is conditional on `NPM_TOKEN` and uses provenance.

## License

Released under the [MIT License](LICENSE).
