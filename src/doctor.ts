import * as fsNative from 'node:fs';
import * as httpNative from 'node:http';
import type { ClientRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { readSteamManifest, type SteamManifest } from './lib/acf.ts';
import { FOREIGN_MARKER_PREFIX, MARKER, streamFingerprint, type Fingerprint } from './patch/fingerprint.ts';
import { discoverInstall, type DiscoverInstallOptions, type SteamInstall } from './platform/steam.ts';
import { stateDir } from './platform/state.ts';

const APP_ID = '3789070';
const PORT = 48766;
const SERVICE = MARKER;
const HEALTH_TIMEOUT_MS = 1500;
const DATA_FILES = ['items.json', 'actions.json', 'skills.json', 'xp.json', 'buildings.json', 'digsites.json', 'strings-en.json'] as const;
const PACK_ROOT = ['pack.json', 'overlay.js', 'planner.js', 'executor.js', 'data'] as const;
const METADATA_KEYS = ['metadata_version', 'profile_id', 'profile_revision', 'marker', 'steam_build_id', 'timestamp', 'original', 'patched', 'backup'] as const;
const METADATA_KEYS_V3 = [...METADATA_KEYS, 'payload_revision'] as const;
const RECORD_KEYS = ['sha256', 'size'] as const;
const BACKUP_KEYS = ['path', 'sha256', 'size'] as const;
const SHA256 = /^[0-9a-f]{64}$/iu;

type AnyRecord = Record<string, unknown>;

export interface DoctorRow {
  readonly status: 'PASS' | 'WARN' | 'FAIL';
  readonly check: string;
  readonly message: string;
}

export interface DoctorResult {
  readonly rows: DoctorRow[];
  readonly blocking: boolean;
}

export interface DoctorFileSystem {
  readonly lstatSync?: typeof fsNative.lstatSync;
  readonly readFileSync?: typeof fsNative.readFileSync;
  readonly readdirSync?: typeof fsNative.readdirSync;
  readonly accessSync?: typeof fsNative.accessSync;
}

export interface DoctorHttp {
  readonly request?: typeof httpNative.request;
}

export interface DoctorDependencies {
  discoverInstall?: (options: DiscoverInstallOptions) => SteamInstall | Promise<SteamInstall>;
  readManifest?: (path: string) => SteamManifest;
  fingerprint?: (path: string, marker?: string | Uint8Array) => Fingerprint;
  http?: DoctorHttp;
  fileSystem?: DoctorFileSystem;
  /** Optional direct health probe, useful for embedders and deterministic tests. */
  probePort?: () => Promise<'free' | 'same' | 'foreign'>;
}

export interface DoctorOptions extends DiscoverInstallOptions {
  stateDirectory?: string;
  dependencies?: DoctorDependencies;
  discoverInstall?: DoctorDependencies['discoverInstall'];
  readManifest?: DoctorDependencies['readManifest'];
  fingerprint?: DoctorDependencies['fingerprint'];
  http?: DoctorHttp;
  fileSystem?: DoctorFileSystem;
  probePort?: DoctorDependencies['probePort'];
}

function row(status: DoctorRow['status'], check: string, message: string): DoctorRow {
  return { status, check, message };
}

function record(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: AnyRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validRecord(value: unknown): value is { sha256: string; size: number } {
  return record(value)
    && exactKeys(value, RECORD_KEYS)
    && typeof value.sha256 === 'string'
    && SHA256.test(value.sha256)
    && typeof value.size === 'number'
    && Number.isSafeInteger(value.size)
    && value.size >= 0;
}

function sameRecord(actual: Fingerprint, expected: { sha256: string; size: number }): boolean {
  return actual.sha256.toLowerCase() === expected.sha256.toLowerCase() && actual.size === expected.size;
}

function fileSystem(options: DoctorOptions): Required<DoctorFileSystem> {
  const supplied = options.fileSystem ?? options.dependencies?.fileSystem ?? {};
  return {
    lstatSync: supplied.lstatSync ?? fsNative.lstatSync,
    readFileSync: supplied.readFileSync ?? fsNative.readFileSync,
    readdirSync: supplied.readdirSync ?? fsNative.readdirSync,
    accessSync: supplied.accessSync ?? fsNative.accessSync,
  };
}

function regularFile(path: string, fs: Required<DoctorFileSystem>): boolean {
  try {
    const stat = fs.lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function regularDirectory(path: string, fs: Required<DoctorFileSystem>): boolean {
  try {
    const stat = fs.lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function executableFile(path: string, fs: Required<DoctorFileSystem>): boolean {
  try {
    const stat = fs.lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function textFile(path: string, fs: Required<DoctorFileSystem>): string {
  return String(fs.readFileSync(path, 'utf8'));
}

function readJson(path: string, fs: Required<DoctorFileSystem>): unknown {
  return JSON.parse(textFile(path, fs));
}

function validPack(state: string, buildId: string, fs: Required<DoctorFileSystem>): { ok: boolean; message: string } {
  const pack = join(state, 'pack');
  if (!regularDirectory(pack, fs)) return { ok: false, message: `Companion pack is missing: ${pack}` };
  try {
    const names = fs.readdirSync(pack).map(String);
    if (names.length !== PACK_ROOT.length || names.some((name) => !(PACK_ROOT as readonly string[]).includes(name))) {
      return { ok: false, message: `Companion pack has unexpected root entries: ${pack}` };
    }
    const data = join(pack, 'data');
    if (!regularDirectory(data, fs)) return { ok: false, message: `Companion pack data directory is missing: ${data}` };
    const dataNames = fs.readdirSync(data).map(String);
    if (dataNames.length !== DATA_FILES.length || dataNames.some((name) => !(DATA_FILES as readonly string[]).includes(name))) {
      return { ok: false, message: `Companion pack data files are incomplete: ${data}` };
    }
    for (const name of PACK_ROOT) {
      if (name === 'data') continue;
      if (!regularFile(join(pack, name), fs)) return { ok: false, message: `Companion pack entry is not a regular file: ${join(pack, name)}` };
    }
    for (const name of DATA_FILES) {
      if (!regularFile(join(data, name), fs)) return { ok: false, message: `Companion pack data entry is not a regular file: ${join(data, name)}` };
    }
    const manifest = readJson(join(pack, 'pack.json'), fs);
    if (!record(manifest) || !exactKeys(manifest, ['schema_version', 'build_id', 'generated_at']) || manifest.schema_version !== 1 || manifest.build_id !== buildId || typeof manifest.generated_at !== 'string' || manifest.generated_at.length === 0) {
      return { ok: false, message: `Companion pack build does not match Steam build ${buildId}` };
    }
    return { ok: true, message: `Companion pack is complete for Steam build ${buildId}` };
  } catch (error) {
    return { ok: false, message: `Companion pack could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function metadataRecord(path: string, fs: Required<DoctorFileSystem>): AnyRecord | undefined {
  try {
    const value = readJson(path, fs);
    return record(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function metadataOriginal(value: AnyRecord | undefined): { sha256: string; size: number } | undefined {
  return value && validRecord(value.original) ? { sha256: value.original.sha256, size: value.original.size } : undefined;
}

function metadataIsOwn(value: AnyRecord, buildId: string, live: Fingerprint, state: string, fs: Required<DoctorFileSystem>, fingerprint: (path: string, marker?: string | Uint8Array) => Fingerprint): string | undefined {
  const validVersion = (value.metadata_version === 2 && exactKeys(value, METADATA_KEYS))
    || (value.metadata_version === 3 && exactKeys(value, METADATA_KEYS_V3)
      && typeof value.payload_revision === 'string' && SHA256.test(value.payload_revision));
  if (!validVersion || value.profile_id !== 'fractured-realms' || value.profile_revision !== MARKER || value.marker !== SERVICE || value.steam_build_id !== buildId) return 'state metadata schema, marker, or Steam build does not match';
  if (typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))) return 'state metadata timestamp is invalid';
  if (!validRecord(value.original) || !validRecord(value.patched) || !record(value.backup) || !exactKeys(value.backup, BACKUP_KEYS) || !validRecord({ sha256: value.backup.sha256, size: value.backup.size })) return 'state metadata archive records are invalid';
  const original = value.original;
  const patched = value.patched;
  const backup = value.backup;
  if (!sameRecord(live, patched)) return 'installed archive fingerprint does not match state metadata';
  if (backup.sha256 !== original.sha256 || backup.size !== original.size) return 'state metadata backup hash does not match original';
  if (backup.path !== `backups/app.asar-${original.sha256}.original`) return 'state metadata backup path is invalid';
  const backupPath = join(state, backup.path.replaceAll('/', '/'));
  if (!regularFile(backupPath, fs)) return `immutable original backup is missing: ${backupPath}`;
  try {
    const backupFingerprint = fingerprint(backupPath, MARKER);
    if (!sameRecord(backupFingerprint, original) || backupFingerprint.markerFound) return 'immutable original backup fingerprint or marker is invalid';
    const foreign = fingerprint(backupPath, FOREIGN_MARKER_PREFIX);
    if (foreign.markerFound) return 'immutable original backup contains a foreign marker';
  } catch (error) {
    return `immutable original backup could not be verified: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

function expectedPristineRecord(metadata: AnyRecord | undefined, buildId: string, live: Fingerprint): boolean {
  const original = metadataOriginal(metadata);
  return metadata?.steam_build_id === buildId && original !== undefined && sameRecord(live, original) && !live.markerFound;
}

function validRetainedMetadata(value: AnyRecord | undefined, buildId: string, state: string, fs: Required<DoctorFileSystem>, fingerprint: (path: string, marker?: string | Uint8Array) => Fingerprint): boolean {
  const validVersion = value !== undefined && ((value.metadata_version === 2 && exactKeys(value, METADATA_KEYS))
    || (value.metadata_version === 3 && exactKeys(value, METADATA_KEYS_V3)
      && typeof value.payload_revision === 'string' && SHA256.test(value.payload_revision)));
  if (!validVersion || value === undefined || value.profile_id !== 'fractured-realms' || value.profile_revision !== MARKER || value.marker !== SERVICE || value.steam_build_id !== buildId) return false;
  if (typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) || !validRecord(value.original) || !validRecord(value.patched) || !record(value.backup) || !exactKeys(value.backup, BACKUP_KEYS) || !validRecord({ sha256: value.backup.sha256, size: value.backup.size })) return false;
  const original = value.original;
  const backup = value.backup;
  if (backup.sha256 !== original.sha256 || backup.size !== original.size || backup.path !== `backups/app.asar-${original.sha256}.original`) return false;
  const backupPath = join(state, backup.path.replaceAll('/', '/'));
  if (!regularFile(backupPath, fs)) return false;
  try {
    const backupFingerprint = fingerprint(backupPath, MARKER);
    if (!sameRecord(backupFingerprint, original) || backupFingerprint.markerFound) return false;
    return !fingerprint(backupPath, FOREIGN_MARKER_PREFIX).markerFound;
  } catch {
    return false;
  }
}

interface PortResponse {
  statusCode?: number;
  on(event: string, listener: (...args: unknown[]) => void): this;
}
interface PortRequest {
  on(event: string, listener: (...args: unknown[]) => void): this;
  setTimeout?(milliseconds: number, callback: () => void): this;
  abort?(): void;
  destroy?(error?: Error): void;
  end?(): void;
}

async function probePort(http: DoctorHttp | undefined): Promise<'free' | 'same' | 'foreign'> {
  const request = http?.request ?? httpNative.request;
  return await new Promise((resolveProbe) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let requestHandle: ClientRequest | undefined;
    const finish = (result: 'free' | 'same' | 'foreign'): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveProbe(result);
    };
    const isRefused = (error: unknown): boolean => record(error) && error.code === 'ECONNREFUSED';
    const occupied = (): void => {
      try { requestHandle?.destroy?.(); requestHandle?.abort?.(); } catch { /* best effort */ }
      finish('foreign');
    };
    timer = setTimeout(occupied, HEALTH_TIMEOUT_MS);
    try {
      requestHandle = request({ hostname: '127.0.0.1', port: PORT, path: '/health', method: 'GET', headers: { Host: `127.0.0.1:${PORT}`, Connection: 'close' } }, (response: PortResponse) => {
        let body = '';
        response.on('data', (chunk: unknown) => {
          body += String(chunk);
          if (body.length > 65536) finish('foreign');
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const payload = JSON.parse(body) as AnyRecord;
            finish(response.statusCode === 200 && payload.ok === true && payload.service === SERVICE ? 'same' : 'foreign');
          } catch { finish('foreign'); }
        });
        response.on('error', () => finish('foreign'));
        response.on('close', () => finish('foreign'));
      });
      requestHandle?.on('error', (error: unknown) => finish(isRefused(error) ? 'free' : 'foreign'));
      requestHandle?.setTimeout?.(HEALTH_TIMEOUT_MS, occupied);
      requestHandle?.on('timeout', occupied);
      requestHandle?.on('close', () => { if (!settled) finish('foreign'); });
      requestHandle?.end?.();
    } catch (error) {
      finish(isRefused(error) ? 'free' : 'foreign');
    }
  });
}

/** Run non-mutating diagnostics for the Fractured Realms companion. */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const platform = options.platform ?? process.platform;
  const fs = fileSystem(options);
  const dependencies = options.dependencies ?? {};
  const rows: DoctorRow[] = [];
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') rows.push(row('PASS', 'platform', `Supported platform: ${platform}`));
  else rows.push(row('FAIL', 'platform', `Unsupported platform: ${platform}`));

  const discover = options.discoverInstall ?? dependencies.discoverInstall ?? ((value: DiscoverInstallOptions) => discoverInstall(value));
  let install: SteamInstall | undefined;
  try {
    install = await discover(options);
    rows.push(row('PASS', 'steam', `Steam installation found at ${install.steamRoot}; game installed at ${install.installDir}`));
  } catch (error) {
    rows.push(row('FAIL', 'steam', `Steam discovery failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  let manifest: SteamManifest | undefined;
  if (install) {
    try {
      const readManifest = options.readManifest ?? dependencies.readManifest ?? readSteamManifest;
      manifest = readManifest(install.manifestPath);
      if (manifest.appid !== APP_ID) throw new Error(`manifest AppID ${manifest.appid} does not match ${APP_ID}`);
      if (!manifest.buildid) throw new Error('manifest has no Steam build ID');
      rows.push(row('PASS', 'manifest', `Steam manifest matches AppID ${APP_ID}, build ${manifest.buildid}, install directory ${manifest.installdir}`));
    } catch (error) {
      rows.push(row('FAIL', 'manifest', `Steam manifest validation failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  } else {
    rows.push(row('FAIL', 'manifest', 'Steam manifest cannot be checked because discovery failed'));
  }

  let state: string | undefined;
  try { state = options.stateDirectory ? resolve(options.stateDirectory) : stateDir({ platform, env: options.env, home: options.home }); } catch (error) { rows.push(row('FAIL', 'state', `State directory could not be resolved: ${error instanceof Error ? error.message : String(error)}`)); }

  if (install && manifest && state) {
    const archive = join(install.installDir, 'resources', 'app.asar');
    const fingerprint = options.fingerprint ?? dependencies.fingerprint ?? streamFingerprint;
    try {
      const live = fingerprint(archive, MARKER);
      const foreign = fingerprint(archive, FOREIGN_MARKER_PREFIX);
      const metadataPath = join(state, 'metadata.json');
      const metadata = metadataRecord(metadataPath, fs);
      let archiveStatus: DoctorRow;
      if (foreign.markerFound) {
        archiveStatus = row('FAIL', 'archive', "Archive is patched by crossover-electron-bridge; run 'crossover-electron-bridge restore fractured-realms' first");
      } else if (live.markerFound) {
        const issue = metadata ? metadataIsOwn(metadata, manifest.buildid, live, state, fs, fingerprint) : 'state metadata is missing or unreadable';
        archiveStatus = issue ? row('FAIL', 'archive', `Archive has the companion marker but recovery state is invalid: ${issue}`) : row('PASS', 'archive', `Archive is verified as companion-patched for Steam build ${manifest.buildid}`);
      } else if (expectedPristineRecord(metadata, manifest.buildid, live) && validRetainedMetadata(metadata, manifest.buildid, state, fs, fingerprint)) {
        archiveStatus = row('FAIL', 'archive', `Archive is pristine for Steam build ${manifest.buildid}; run 'fractured-companion refresh' to patch it before launch`);
      } else {
        archiveStatus = row('FAIL', 'archive', 'Archive state is unknown: pristine archive has no matching build/fingerprint record');
      }
      rows.push(archiveStatus);
    } catch (error) {
      rows.push(row('FAIL', 'archive', `Archive could not be fingerprinted: ${error instanceof Error ? error.message : String(error)}`));
    }
    rows.push((() => { const result = validPack(state!, manifest!.buildid, fs); return row(result.ok ? 'PASS' : 'FAIL', 'pack', result.message); })());
  } else {
    rows.push(row('FAIL', 'archive', 'Archive cannot be checked because Steam discovery or manifest validation failed'));
    rows.push(row('FAIL', 'pack', 'Companion pack cannot be checked because Steam discovery or manifest validation failed'));
  }

  const probe = options.probePort ?? dependencies.probePort;
  let portStatus: 'free' | 'same' | 'foreign';
  try { portStatus = probe ? await probe() : await probePort(options.http ?? dependencies.http); } catch { portStatus = 'foreign'; }
  rows.push(portStatus === 'same' ? row('PASS', 'port', `Port ${PORT} is serving ${SERVICE}`) : portStatus === 'foreign' ? row('FAIL', 'port', `Port ${PORT} is in use by another process`) : row('PASS', 'port', `Port ${PORT} is available`));

  if (platform === 'darwin') {
    const winePath = install?.winePath ?? '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine';
    rows.push(executableFile(winePath, fs) ? row('PASS', 'wine', `CrossOver wine executable found: ${winePath}`) : row('FAIL', 'wine', `Missing CrossOver wine executable: ${winePath}`));
  }

  return { rows, blocking: rows.some((value) => value.status === 'FAIL') };
}

/** Format doctor rows as machine-readable JSON or aligned human-readable text. */
export function formatDoctor(result: DoctorResult, json = false): string {
  if (json) return JSON.stringify(result.rows);
  const width = result.rows.reduce((longest, value) => Math.max(longest, value.status.length), 0);
  return result.rows.map((value) => `${value.status.padEnd(width)}  ${value.check.padEnd(10)}  ${value.message}`).join('\n');
}

export { APP_ID as FRACTURED_APP_ID, PORT as COMPANION_PORT, SERVICE as COMPANION_SERVICE };
