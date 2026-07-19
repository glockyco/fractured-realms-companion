# Fractured Realms Companion

Fractured Realms Companion is a cross-platform in-game item wiki and action planner for **Fractured Realms**. It locates a Steam installation, refreshes game data after updates, and hosts a companion overlay alongside the game.

> **Scaffold status:** the repository layout and runtime packaging are in place. The command-line implementation is temporary; patching, extraction, discovery, and the companion UI are still under construction.

## Requirements

- Node.js 20 or newer for the npm development path.
- A Steam installation of Fractured Realms for the eventual refresh and launch workflow.
- Bun 1.1 or newer will be used to produce standalone release binaries (not yet available in this scaffold).

## Installation

### npm / npx

The npm package and `npx` workflow will be published once the implementation is complete. They are not available from this scaffold yet.

### Standalone binaries

Per-OS binaries will be attached to GitHub Releases when the release workflow is complete. macOS binaries will be unsigned; users who encounter Gatekeeper restrictions should use the npm installation path instead.

## Quickstart

Once the implementation is complete, the intended workflow is:

```sh
fractured-companion refresh
fractured-companion launch
```

Refreshing after a Steam game update re-extracts the companion data and safely updates the game patch.

While this scaffold is under construction, the temporary CLI can be run after compiling with `npm run build`; it only reports its current status.

## Development

```sh
npm run build
npm test
```

The project has no runtime npm dependencies. TypeScript is used only for development and the same sources will support Node.js and compiled Bun binaries.

## License

Released under the [MIT License](LICENSE).
