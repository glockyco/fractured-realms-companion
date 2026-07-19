import { execFileSync as nodeExecFileSync } from 'node:child_process';
type ExecFileSync = typeof nodeExecFileSync;
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readSteamManifest } from '../lib/acf.ts';
import { readLibraryFolders } from '../lib/vdf.ts';
import { ConfigurationError, OperationalError } from '../lib/errors.ts';

const FRACTURED_APP_ID = '3789070';
const MANIFEST_NAME = `appmanifest_${FRACTURED_APP_ID}.acf`;

export interface DiscoverInstallOptions {
  steamRoot?: string;
  bottle?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  execFileSync?: ExecFileSync;
}

export interface SteamInstall {
  steamRoot: string;
  steamExe: string;
  manifestPath: string;
  installDir: string;
  platform: NodeJS.Platform;
  winePath?: string;
}

function existingPathKind(path: string): 'missing' | 'symlink' | 'directory' | 'file' | 'other' {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile()) return 'file';
    return 'other';
  } catch {
    return 'missing';
  }
}

function registrySteamPath(execFileSync: ExecFileSync): string | undefined {
  try {
    // Suppress registry stderr: a missing key is an ordinary discovery miss, not
    // an error to expose to users (and is common on fresh Windows installs).
    const output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const text = String(output);
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*SteamPath\s+REG_\S+\s+(.+?)\s*$/i);
      if (!match) continue;
      const value = match[1]?.trim();
      if (value) return value.replace(/^"(.*)"$/, '$1');
    }
  } catch {
    // Registry lookup is best effort; explicit and conventional paths remain.
  }
  return undefined;
}

function candidateRoots(options: DiscoverInstallOptions, platform: NodeJS.Platform, home: string): string[] {
  if (options.steamRoot !== undefined) return [options.steamRoot];

  const env = options.env ?? process.env;
  const roots: string[] = [];
  if (platform === 'win32') {
    if (env['ProgramFiles(x86)']) roots.push(join(env['ProgramFiles(x86)'] as string, 'Steam'));
    if (env.ProgramFiles) roots.push(join(env.ProgramFiles, 'Steam'));
    const fromRegistry = registrySteamPath(options.execFileSync ?? nodeExecFileSync);
    if (fromRegistry) roots.push(fromRegistry);
  } else if (platform === 'linux') {
    roots.push(
      join(home, '.local', 'share', 'Steam'),
      join(home, '.steam', 'steam'),
      join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    );
  } else if (platform === 'darwin') {
    const bottle = options.bottle ?? 'Steam';
    roots.push(join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles', bottle, 'drive_c', 'Program Files (x86)', 'Steam'));
  }
  return roots;
}

function librariesForRoot(root: string): string[] {
  const libraries = [root, ...readLibraryFolders(join(root, 'steamapps', 'libraryfolders.vdf'))];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const library of libraries) {
    const resolved = resolve(library);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function missingManifestError(searched: readonly string[]): OperationalError {
  return new OperationalError(
    `Fractured Realms (${FRACTURED_APP_ID}) manifest not found; searched Steam roots/libraries: ${searched.join(', ')}`,
  );
}

/** Locate a Steam installation of Fractured Realms and validate its archive. */
export function discoverInstall(options: DiscoverInstallOptions = {}): SteamInstall {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? homedir();
  const roots = candidateRoots(options, platform, home);
  const searched: string[] = [];

  for (const candidate of roots) {
    const steamRoot = resolve(candidate);
    for (const library of librariesForRoot(steamRoot)) {
      searched.push(library);
      const manifestPath = join(library, 'steamapps', MANIFEST_NAME);
      const manifestKind = existingPathKind(manifestPath);
      if (manifestKind === 'missing') continue;
      if (manifestKind !== 'file') {
        throw new OperationalError(`Steam app manifest is not a regular file (symlink or invalid entry): ${manifestPath}`);
      }

      const manifest = readSteamManifest(manifestPath);
      if (manifest.appid !== FRACTURED_APP_ID) {
        throw new ConfigurationError(`Steam app manifest has unexpected appid ${JSON.stringify(manifest.appid)}: ${manifestPath}`);
      }

      const installDir = resolve(join(library, 'steamapps', 'common', manifest.installdir));
      const gameKind = existingPathKind(installDir);
      if (gameKind === 'missing') throw new OperationalError(`Fractured Realms game directory not found: ${installDir}`);
      if (gameKind !== 'directory') throw new OperationalError(`Fractured Realms game directory is not a regular directory (symlink or invalid entry): ${installDir}`);
      const resources = join(installDir, 'resources');
      const resourcesKind = existingPathKind(resources);
      if (resourcesKind !== 'directory') throw new OperationalError(`Fractured Realms resources directory is not a regular directory: ${resources}`);
      const archive = join(resources, 'app.asar');
      if (existingPathKind(archive) !== 'file') {
        throw new OperationalError(`Fractured Realms archive is not a regular file (symlink or invalid entry): ${archive}`);
      }

      const result: SteamInstall = {
        steamRoot,
        steamExe: platform === 'linux' ? 'steam' : join(steamRoot, 'Steam.exe'),
        manifestPath,
        installDir,
        platform,
      };
      if (platform === 'darwin') result.winePath = '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine';
      return result;
    }
  }

  throw missingManifestError(searched);
}
