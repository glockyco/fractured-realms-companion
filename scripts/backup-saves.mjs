#!/usr/bin/env node
// Copy every existing Fractured Realms save location into a timestamped backup
// directory before any live-integration session. Zero runtime dependencies so
// the live validator can import its helpers without pulling in Playwright.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STATE_DIRECTORY = 'fractured-realms-companion';

/** Mirror src/platform/state.ts for the darwin/linux path used by this tooling. */
export function stateDir(env = process.env, home = homedir(), platform = process.platform) {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData || localAppData.trim().length === 0) throw new Error('LOCALAPPDATA is required on Windows');
    return resolve(localAppData, STATE_DIRECTORY);
  }
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.trim().length > 0) return resolve(xdg, STATE_DIRECTORY);
  return resolve(home, '.local', 'state', STATE_DIRECTORY);
}

/** Enumerate the on-disk save sources, resolved against the CrossOver bottle and Arc profile. */
export function saveSources(home = homedir()) {
  const bottle = join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles', 'Steam', 'drive_c');
  const roaming = join(bottle, 'users', 'crossover', 'AppData', 'Roaming');
  return [
    { label: 'roaming-fractured-realms', sourcePath: join(roaming, 'Fractured Realms') },
    { label: 'roaming-fractured-realms-demo', sourcePath: join(roaming, 'Fractured Realms Demo') },
    { label: 'roaming-visseron-idle', sourcePath: join(roaming, 'visseron-idle') },
    { label: 'steam-userdata', sourcePath: join(bottle, 'Program Files (x86)', 'Steam', 'userdata') },
    {
      label: 'arc-local-storage',
      sourcePath: join(home, 'Library', 'Application Support', 'Arc', 'User Data', 'Default', 'Local Storage', 'leveldb'),
      arc: true,
    },
  ];
}

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

/** Recursively total the file count and byte size of a copied tree. */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { files += 1; bytes += statSync(full).size; }
    }
  };
  walk(dir);
  return { files, bytes };
}

/** Return the freshest saves-* backup manifest, or null when none exist. */
export function newestBackupManifest(stateDirectory) {
  const backupsRoot = join(stateDirectory, 'backups');
  if (!existsSync(backupsRoot)) return null;
  let best = null;
  for (const entry of readdirSync(backupsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('saves-')) continue;
    const manifestPath = join(backupsRoot, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const created = Date.parse(manifest.created);
      if (Number.isNaN(created)) continue;
      if (!best || created > best.created) best = { path: manifestPath, created };
    } catch { /* skip malformed manifest */ }
  }
  return best;
}

export function backupSaves({ home = homedir(), env = process.env, allowRunningArc = false, log = console.log } = {}) {
  const sources = saveSources(home);
  const wantsArc = sources.some((source) => source.arc && existsSync(source.sourcePath));
  if (wantsArc && !allowRunningArc && arcRunning()) {
    log('Arc is running; its Local Storage copy may be torn. Quit Arc and re-run, or pass --allow-running-arc.');
    return { ok: false, reason: 'arc-running' };
  }

  const root = stateDir(env, home);
  const destDir = join(root, 'backups', `saves-${timestamp()}`);
  mkdirSync(destDir, { recursive: true });

  const copied = [];
  for (const source of sources) {
    if (!existsSync(source.sourcePath)) {
      log(`skip ${source.label}: not present (${source.sourcePath})`);
      continue;
    }
    const dst = join(destDir, source.label);
    cpSync(source.sourcePath, dst, { recursive: true });
    const { files, bytes } = measure(dst);
    copied.push({ label: source.label, sourcePath: source.sourcePath, files, bytes });
    log(`copied ${source.label}: ${files} files, ${bytes} bytes`);
  }

  if (copied.length === 0) {
    log('No save sources existed; nothing was backed up.');
    return { ok: false, reason: 'no-sources', destDir };
  }

  const restore = 'copy each directory back to sourcePath while the game and Arc are closed';
  const manifest = { created: new Date().toISOString(), sources: copied, restore };
  writeFileSync(join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`Backup written to ${destDir}`);
  log(`Restore: ${restore}`);
  return { ok: true, destDir, manifest };
}

function arcRunning() {
  try {
    execFileSync('pgrep', ['-x', 'Arc'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const allowRunningArc = process.argv.includes('--allow-running-arc');
  const result = backupSaves({ allowRunningArc });
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
