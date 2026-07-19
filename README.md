# Fractured Realms Companion

Fractured Realms Companion adds a local browser companion to **Fractured Realms**: an item wiki with sources, uses, stats, and artwork, plus a dependency-aware action planner. It discovers a Steam installation, extracts the current game data, patches the game safely, and launches the companion alongside the game.

The companion runs on the same machine as the game. It reads the live game store for planning and executes one direct game action at a time. It does **not** read or write the game's native `actionQueue`.

## Companion preview

### Build-matched item wiki

Search the current game build for an item, then inspect its guaranteed and rare sources, requirements, and downstream uses.

![Ancient Spore item details with sources and uses](docs/screenshots/item-wiki.webp)

### Planner and extracted skill actions

| State-aware action planning | Build-matched skill data |
| --- | --- |
| The planner turns one goal into an ordered sequence of live game actions. | Skill tables expose levels, timings, tools, outputs, and drop rates. |
| ![Four-action plan for crafting a Minor Fire Rune](docs/screenshots/action-planner.webp) | ![Archaeology actions with levels, intervals, outputs, and tools](docs/screenshots/skill-actions.webp) |

## Supported systems and discovery

| System | Steam installation searched |
| --- | --- |
| Windows | `%ProgramFiles(x86)%\Steam`, `%ProgramFiles%\Steam`, then the per-user Steam registry path |
| Linux | `~/.local/share/Steam`, `~/.steam/steam`, and Flatpak Steam under `~/.var/app/com.valvesoftware.Steam/.local/share/Steam` |
| macOS | CrossOver bottle `Steam` by default: `~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/Program Files (x86)/Steam` |

Steam library folders are also read from `libraryfolders.vdf`, so the game may live in an additional library. Use `--steam-root PATH` to select an explicit Steam root (useful for a non-standard installation or a fixture), and `--bottle NAME` to select a different CrossOver bottle on macOS.

## Installation

Choose either the npm package or the standalone binary. The npm path requires Node.js 20 or newer. The release binaries include their runtime and do not require Node.js or Bun.

| Path | Install / download | Run |
| --- | --- | --- |
| npm (global) | `npm install --global fractured-realms-companion` | `fractured-companion <command>` |
| npx (one-off) | no installation | `npx --yes fractured-realms-companion <command>` |
| Windows x64 | Download [`fractured-companion-windows-x64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `fractured-companion-windows-x64.exe <command>` |
| Linux x64 | Download [`fractured-companion-linux-x64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `chmod +x ./fractured-companion-linux-x64 && ./fractured-companion-linux-x64 <command>` |
| macOS Apple silicon | Download [`fractured-companion-darwin-arm64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `chmod +x ./fractured-companion-darwin-arm64 && ./fractured-companion-darwin-arm64 <command>` |
| macOS Intel | Download [`fractured-companion-darwin-x64`](https://github.com/glockyco/fractured-realms-companion/releases/latest) | `chmod +x ./fractured-companion-darwin-x64 && ./fractured-companion-darwin-x64 <command>` |

The macOS binaries are unsigned. If macOS blocks a binary, try launching it once and approve that specific app in **System Settings → Privacy & Security → Open Anyway**. Do not disable Gatekeeper globally or use a permanent bypass. If your security policy does not allow an unsigned executable, use the npm or npx path instead.

Every release includes `SHA256SUMS`. Verify a downloaded binary before running it:

```sh
# Linux
sha256sum -c SHA256SUMS
# macOS
shasum -a 256 -c SHA256SUMS
```

## Quickstart

Run these commands from any directory. `doctor` is read-only and reports the checks that would block launch. `--json` emits parseable rows for scripts.

```sh
fractured-companion doctor --json
fractured-companion refresh
fractured-companion doctor
fractured-companion launch
```

`launch` starts Fractured Realms with the companion flag, waits for the local host to become healthy, and opens `http://127.0.0.1:48766/`. To launch without opening a browser automatically:

```sh
fractured-companion launch --no-open
```

Useful options must follow their command:

```sh
fractured-companion doctor --steam-root "/path/to/Steam" --json
fractured-companion refresh --steam-root "/path/to/Steam" --no-patch
fractured-companion launch --bottle MySteam --no-open
```

`refresh --no-patch` extracts and validates the data pack without changing the game archive. To undo a companion patch and restore the verified original archive:

```sh
fractured-companion restore
```

`--version` and `--help` are also available:

```sh
fractured-companion --version
fractured-companion --help
```

## What the companion does

- **Items:** search by item name, then view descriptions, values, healing data, icons, deterministic and rare sources, and uses.
- **Skills:** browse extracted skill actions and their requirements, intervals, inputs, outputs, and locations.
- **Planner:** find a target with the searchable item picker, then request a quantity from the current inventory and unlock state. The planner resolves deterministic input dependencies in order, checks skill levels, permanent Shop tool unlocks, learned recipes, glyph patterns, Prayer requirements, charted maps, and bag capacity, then explains anything that blocks the plan.
- **Executor:** runs each planned step directly through the game's own start/stop action controls, verifies that the requested action started, detects outside action changes, supports resume, and stops on a stalled action or completion. Rare outputs are never treated as guaranteed production, and tools are not auto-crafted.
- **Game data:** `refresh` re-extracts the current build's item, action, skill, XP, building, dig-site, string, and item-art data before patching.

## Safety model and local state

- The browser host binds only to `127.0.0.1:48766`. API requests require the per-process token plus matching `Host`/`Origin` headers, and request bodies are bounded to 64 KiB. A port occupied by another service is a blocking doctor failure.
- Patching is fail-closed. The tool fingerprints the archive, refuses the predecessor `crossover-electron-bridge` marker, rejects unexpected source anchors, stages changes, and verifies the installed bytes before recording success. Concurrent archive changes, unknown state, and metadata mismatches stop the operation rather than overwriting them.
- State is kept separately from the game install: `$XDG_STATE_HOME/fractured-realms-companion` (or `~/.local/state/fractured-realms-companion`) on macOS/Linux, and `%LOCALAPPDATA%\fractured-realms-companion` on Windows. It contains the extracted pack, patch metadata, and a hash-named immutable original archive backup.
- `restore` requires matching Steam build metadata, the companion marker, the installed patched fingerprint, and a verified original backup. Metadata and the backup are retained after restore so the state remains auditable.
- The achievement route is local and token-authenticated. It delegates to the native Steamworks client, rejects non-string achievement names, and reports `no-client` or native errors instead of pretending an achievement was activated. It does not replace Steam or fabricate achievement state.

### Migrating from crossover-electron-bridge

If the old bridge patched Fractured Realms, restore its archive before using this tool. Run the old command from the `crossover-browser-games` checkout:

```sh
cd ~/Projects/crossover-browser-games
PYTHONPATH=src python3 -m crossover_electron_bridge restore fractured-realms
```

Then return to this tool and run `fractured-companion refresh`. The companion intentionally refuses to migrate or overwrite an archive carrying the old bridge marker.

### After a Steam game update

Steam updates replace the game archive and its build ID. After every update, run:

```sh
fractured-companion refresh
fractured-companion doctor
fractured-companion launch
```

The refresh extracts the new data, publishes a validated pack, and patches the new archive. If the game's source anchors changed, it stops before writing an unsafe patch. Do not force the patch against that build.

## Development

Use Node.js 24 for the development workflow (the CI matrix runs Node 24). Runtime npm dependencies are intentionally zero. TypeScript and Node type definitions are development-only.

```sh
npm ci
npm test
npm run build
npx tsc --noEmit
```

`npm test` embeds the runtime assets before running the Node test suite. `npm run build` emits the npm package under `dist/`. Release binaries are compiled from the same CLI sources with Bun in the release workflow.

### Maintainer release note

Tagging a release as `v*` builds the four platform binaries, generates `SHA256SUMS`, and publishes the GitHub Release. The separate npm job uses provenance and public access. Configure the repository's `NPM_TOKEN` secret once to enable npm publishing. When it is absent, the release job skips npm publishing with a clear notice.

## Limitations

- Game data extraction is build-sensitive. A changed game bundle or entrypoint anchor requires a compatibility update before that build can be patched.
- The planner uses deterministic outputs only. Rare drops are shown as information and can block deterministic planning. Required Shop tools are permanent unlocks and must already be purchased.
- Starting a planned action stops active combat. Dungeons, raids, and a full bag can refuse training. The executor surfaces the refusal and never bypasses those game checks.
- macOS support targets Steam running in CrossOver and uses the named bottle. Native macOS Fractured Realms installation is not a discovery target.
- Standalone macOS binaries are unsigned. npm/npx remains the supported alternative when local security policy blocks them.

## License

Released under the [MIT License](LICENSE).
