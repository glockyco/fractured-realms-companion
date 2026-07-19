import { mkdtempSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { execFileSync as ExecFileSync } from 'node:child_process';
import { ConfigurationError, OperationalError } from '../../src/lib/errors.ts';
import { discoverInstall } from '../../src/platform/steam.ts';

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'fractured-companion-steam-'));
}

function manifest(appid = '3789070', installdir = 'Fractured Realms'): string {
  return `"AppState" {
  "appid" "${appid}"
  "name" "Fractured Realms"
  "installdir" "${installdir}"
  "buildid" "24185239"
}`;
}

function createLibrary(library: string, options: { appid?: string; installdir?: string } = {}): string {
  const game = join(library, 'steamapps', 'common', options.installdir ?? 'Fractured Realms');
  mkdirSync(join(library, 'steamapps'), { recursive: true });
  mkdirSync(join(game, 'resources'), { recursive: true });
  writeFileSync(join(library, 'steamapps', 'appmanifest_3789070.acf'), manifest(options.appid, options.installdir));
  writeFileSync(join(game, 'resources', 'app.asar'), 'synthetic archive');
  return game;
}

function writeLibraries(root: string, libraries: readonly string[]): void {
  const entries = libraries.map((library, index) => `  "${index}" { "path" "${library.replaceAll('\\', '\\\\')}" }`).join('\n');
  writeFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" {\n${entries}\n}`);
}

test('discovers an explicit root and respects manifest installdir', () => {
  const root = temporaryDirectory();
  const game = createLibrary(root, { installdir: 'Renamed Fractured Realms' });
  const found = discoverInstall({ steamRoot: root, platform: 'linux' });
  assert.deepEqual(found, {
    steamRoot: resolve(root),
    steamExe: 'steam',
    manifestPath: join(resolve(root), 'steamapps', 'appmanifest_3789070.acf'),
    installDir: resolve(game),
    platform: 'linux',
  });
});

test('searches additional libraries in VDF order and deduplicates the default root', () => {
  const root = temporaryDirectory();
  const first = join(root, 'library-one');
  const second = join(root, 'library-two');
  mkdirSync(join(root, 'steamapps'), { recursive: true });
  writeLibraries(root, [root, first, second, first]);
  const game = createLibrary(second, { installdir: 'Different Install Name' });
  const found = discoverInstall({ steamRoot: root, platform: 'linux' });
  assert.equal(found.installDir, resolve(game));
  assert.equal(found.manifestPath, join(resolve(second), 'steamapps', 'appmanifest_3789070.acf'));
});

test('reports every searched library when no manifest exists', () => {
  const root = temporaryDirectory();
  const extra = join(root, 'extra-library');
  mkdirSync(join(root, 'steamapps'), { recursive: true });
  writeLibraries(root, [extra]);
  assert.throws(
    () => discoverInstall({ steamRoot: root, platform: 'linux' }),
    (error: unknown) => error instanceof OperationalError
      && error.message.includes(resolve(root))
      && error.message.includes(resolve(extra))
      && error.message.includes('3789070')
      && !error.message.includes('reg query'),
  );
});

test('rejects a manifest whose appid does not match the requested game', () => {
  const root = temporaryDirectory();
  createLibrary(root, { appid: '1234' });
  assert.throws(
    () => discoverInstall({ steamRoot: root, platform: 'linux' }),
    (error: unknown) => error instanceof ConfigurationError && error.message.includes('unexpected appid'),
  );
});

test('rejects a symlinked archive', (t) => {
  const root = temporaryDirectory();
  const game = createLibrary(root);
  const archive = join(game, 'resources', 'app.asar');
  const realArchive = join(game, 'resources', 'real.asar');
  writeFileSync(realArchive, 'synthetic archive');
  // Unprivileged Windows runners may not permit symlink creation; retain the
  // test for platforms where the filesystem supports it.
  try {
    unlinkSync(archive);
    symlinkSync(realArchive, archive);
  } catch {
    t.skip('filesystem does not permit test symlinks');
    return;
  }
  assert.throws(
    () => discoverInstall({ steamRoot: root, platform: 'linux' }),
    (error: unknown) => error instanceof OperationalError && error.message.includes('not a regular file'),
  );
});

test('constructs Windows candidates and tolerates a missing registry query', () => {
  const root = temporaryDirectory();
  const programFiles = join(root, 'Program Files (x86)');
  const steamRoot = join(programFiles, 'Steam');
  createLibrary(steamRoot);
  let queried = false;
  const execFileSync = ((file: string, args: readonly string[]) => {
    queried = file === 'reg' && args.includes('SteamPath');
    return ''; 
  }) as unknown as ExecFileSync;
  const found = discoverInstall({
    platform: 'win32',
    env: { 'ProgramFiles(x86)': programFiles },
    execFileSync,
  });
  assert.equal(queried, true);
  assert.equal(found.steamRoot, resolve(steamRoot));
  assert.equal(found.steamExe, join(resolve(steamRoot), 'Steam.exe'));
});

test('discovers a Windows Steam root returned by registry', () => {
  const root = temporaryDirectory();
  createLibrary(root);
  const execFileSync = (() => `\n    HKEY_CURRENT_USER\\Software\\Valve\\Steam\n        SteamPath    REG_SZ    ${root}\n  `) as unknown as ExecFileSync;
  const found = discoverInstall({ platform: 'win32', env: {}, execFileSync });
  assert.equal(found.steamRoot, resolve(root));
});

test('builds Linux flatpak and macOS CrossOver candidate paths', () => {
  const home = temporaryDirectory();
  const flatpak = join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam');
  createLibrary(flatpak);
  const linux = discoverInstall({ platform: 'linux', home, env: {} });
  assert.equal(linux.steamRoot, resolve(flatpak));

  const crossover = join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles', 'Games', 'drive_c', 'Program Files (x86)', 'Steam');
  createLibrary(crossover);
  const mac = discoverInstall({ platform: 'darwin', home, bottle: 'Games', env: {} });
  assert.equal(mac.steamRoot, resolve(crossover));
  assert.equal(mac.steamExe, join(resolve(crossover), 'Steam.exe'));
  assert.equal(mac.winePath, '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine');
});
