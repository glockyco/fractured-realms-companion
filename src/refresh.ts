import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { extractRegistries, type RawGameData } from './extract/registries.ts';
import { compileModel, serializeModel, type GameModel } from './model/compile.ts';
import { writeModelDb } from './model/sqlite.ts';
import {
  ELECTRON_HOST_SOURCE,
  ENGINE_CLOSURE_SOURCE,
  ENGINE_EXPAND_SOURCE,
  ENGINE_FORMULAS_SOURCE,
  ENGINE_MODEL_SOURCE,
  ENGINE_QUEUE_SOURCE,
  ENGINE_SIMULATE_SOURCE,
  EXECUTOR_SOURCE,
  FRACTURED_ADAPTER_SOURCE,
  OVERLAY_SOURCE,
} from './generated/embedded.ts';
import { readSteamManifest, type SteamManifest } from './lib/acf.ts';
import { extractFile, listFiles } from './lib/asar.ts';
import { OperationalError } from './lib/errors.ts';
import { createFracturedApply } from './patch/fracturedAdapter.ts';
import { FOREIGN_MARKER_PREFIX, MARKER, streamFingerprint, type Fingerprint } from './patch/fingerprint.ts';
import { PatchManager, type PatchRequest, type PatchResult } from './patch/manager.ts';
import { computePayloadRevision } from './patch/revision.ts';
import { discoverInstall, type DiscoverInstallOptions, type SteamInstall } from './platform/steam.ts';
import { stateDir } from './platform/state.ts';

const DATA_FILES = [['model', 'model.json']] as const;
const ENGINE_SOURCES = [
  ['model', ENGINE_MODEL_SOURCE],
  ['formulas', ENGINE_FORMULAS_SOURCE],
  ['closure', ENGINE_CLOSURE_SOURCE],
  ['expand', ENGINE_EXPAND_SOURCE],
  ['simulate', ENGINE_SIMULATE_SOURCE],
  ['queue', ENGINE_QUEUE_SOURCE],
] as const;
const METADATA_KEYS_V2 = new Set([
  'metadata_version',
  'profile_id',
  'profile_revision',
  'marker',
  'steam_build_id',
  'timestamp',
  'original',
  'patched',
  'backup',
]);
const METADATA_KEYS_V3 = new Set([...METADATA_KEYS_V2, 'payload_revision']);
const RECORD_KEYS = new Set(['sha256', 'size']);
const BACKUP_KEYS = new Set(['path', 'sha256', 'size']);
const SHA256 = /^[0-9a-f]{64}$/i;

export interface RefreshResult {
  readonly install: SteamInstall;
  readonly stateDirectory: string;
  readonly packDirectory: string;
  readonly buildId: string;
  readonly original: { sha256: string; size: number };
  readonly changed: boolean;
}

export interface RefreshDependencies {
  discoverInstall?: (options: DiscoverInstallOptions) => SteamInstall;
  readManifest?: (path: string) => SteamManifest;
  fingerprint?: (path: string, marker?: string | Uint8Array) => Fingerprint;
  listFiles?: (archive: string) => string[];
  extractFile?: (archive: string, innerPath: string) => Buffer;
  extractRegistries?: (source: string, archiveFiles: readonly string[]) => RawGameData;
  overlaySource?: string;
  executorSource?: string;
  engineSources?: Readonly<Record<string, string>>;
  patchManager?: { patch(request: PatchRequest): PatchResult };
  createApply?: typeof createFracturedApply;
  /** File-system hooks are intentionally narrow so transaction failures can be tested. */
  fileSystem?: {
    mkdirSync?: typeof mkdirSync;
    mkdtempSync?: typeof mkdtempSync;
    renameSync?: typeof renameSync;
    rmSync?: typeof rmSync;
    writeFileSync?: typeof writeFileSync;
  };
}

export interface RefreshOptions extends DiscoverInstallOptions {
  stateDirectory?: string;
  noPatch?: boolean;
  clock?: (() => Date | string) | Date | string;
  dependencies?: RefreshDependencies;
  /** Top-level aliases keep dependency injection convenient for embedders and tests. */
  discoverInstall?: RefreshDependencies['discoverInstall'];
  readManifest?: RefreshDependencies['readManifest'];
  fingerprint?: RefreshDependencies['fingerprint'];
  listFiles?: RefreshDependencies['listFiles'];
  extractFile?: RefreshDependencies['extractFile'];
  extractRegistries?: RefreshDependencies['extractRegistries'];
  overlaySource?: string;
  executorSource?: string;
  engineSources?: Readonly<Record<string, string>>;
  patchManager?: RefreshDependencies['patchManager'];
  createApply?: RefreshDependencies['createApply'];
  fileSystem?: RefreshDependencies['fileSystem'];
}

function fail(message: string, cause?: unknown): never {
  if (cause instanceof OperationalError) throw cause;
  throw new OperationalError(message, cause instanceof Error ? { cause } : undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function validRecord(value: unknown, description: string): { sha256: string; size: number } {
  if (!isRecord(value) || !exactKeys(value, RECORD_KEYS)) fail(`state metadata has an invalid ${description} record`);
  const sha = value.sha256;
  const size = value.size;
  if (typeof sha !== 'string' || !SHA256.test(sha) || typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    fail(`state metadata has an invalid ${description} hash or size`);
  }
  return { sha256: sha.toLowerCase(), size };
}

function sameFingerprint(actual: Fingerprint, expected: { sha256: string; size: number }, marker: boolean): boolean {
  return actual.sha256.toLowerCase() === expected.sha256.toLowerCase() && actual.size === expected.size && actual.markerFound === marker;
}

function utcTimestamp(clock: RefreshOptions['clock']): string {
  let value: Date | string;
  try {
    value = clock === undefined ? new Date() : typeof clock === 'function' ? clock() : clock;
  } catch (error) {
    fail('refresh clock did not return a UTC timestamp', error);
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail('refresh clock did not return a UTC timestamp');
    return value.toISOString();
  }
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('refresh clock did not return a UTC timestamp');
  }
  return new Date(value).toISOString();
}

interface BackupPathOps {
  resolve(...paths: string[]): string;
  join(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  sep: string;
}

const nativeBackupPathOps: BackupPathOps = { resolve, join, relative, isAbsolute, sep };

export function resolveBackupPath(stateDirectory: string, metadataPath: string, pathOps: BackupPathOps = nativeBackupPathOps): string {
  if (pathOps.isAbsolute(metadataPath) || metadataPath.includes('\\')) fail('state metadata backup path escapes the state directory');
  const components = metadataPath.split('/');
  if (components.length !== 2 || components[0] !== 'backups' || components[1].length === 0 || components[1] === '.' || components[1] === '..' || components[1].includes('\\')) {
    fail('state metadata backup path escapes the state directory');
  }
  const stateRoot = pathOps.resolve(stateDirectory);
  const filename = components[1];
  const metadataResolved = pathOps.resolve(stateRoot, ...components);
  const backupPath = pathOps.resolve(pathOps.join(stateRoot, 'backups', filename));
  if (backupPath !== metadataResolved) fail('state metadata backup path escapes the state directory');
  const relativePath = pathOps.relative(stateRoot, backupPath);
  if (!relativePath || pathOps.isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${pathOps.sep}`)) {
    fail('state metadata backup path escapes the state directory');
  }
  return backupPath;
}

function metadataForBackup(stateDirectory: string, buildId: string, live: Fingerprint, fingerprint: (path: string, marker?: string | Uint8Array) => Fingerprint): string {
  const metadataPath = join(stateDirectory, 'metadata.json');
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(metadataPath, 'utf8')); } catch (error) { fail(`state metadata could not be read: ${metadataPath}`, error); }
  if (!isRecord(parsed)) fail(`state metadata has unexpected keys: ${metadataPath}`);
  const metadataVersionValid = (parsed.metadata_version === 2 && exactKeys(parsed, METADATA_KEYS_V2))
    || (parsed.metadata_version === 3 && exactKeys(parsed, METADATA_KEYS_V3)
      && typeof parsed.payload_revision === 'string' && SHA256.test(parsed.payload_revision));
  if (!metadataVersionValid) fail(`state metadata has unexpected keys: ${metadataPath}`);
  if (parsed.profile_id !== 'fractured-realms' || parsed.profile_revision !== MARKER || parsed.marker !== MARKER) {
    fail(`state metadata does not describe the ${MARKER} patch profile`);
  }
  if (parsed.steam_build_id !== buildId) fail('state metadata Steam build does not match installed build');
  if (typeof parsed.timestamp !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.timestamp) || !Number.isFinite(Date.parse(parsed.timestamp))) {
    fail('state metadata has no valid patch timestamp');
  }
  const original = validRecord(parsed.original, 'original archive');
  const patched = validRecord(parsed.patched, 'patched archive');
  if (!sameFingerprint(live, patched, true)) fail('installed patched archive: fingerprint verification failed');
  if (!isRecord(parsed.backup) || !exactKeys(parsed.backup, BACKUP_KEYS)) fail('state metadata has an invalid backup record');
  const expectedRelative = `backups/app.asar-${original.sha256}.original`;
  if (parsed.backup.path !== expectedRelative) fail('state metadata points at an unexpected original backup');
  const backup = validRecord({ sha256: parsed.backup.sha256, size: parsed.backup.size }, 'backup');
  if (backup.sha256 !== original.sha256 || backup.size !== original.size) fail('state metadata backup does not match the original archive');

  const stateRoot = resolve(stateDirectory);
  const backupPath = resolveBackupPath(stateDirectory, expectedRelative);
  const components = expectedRelative.split('/');
  let current = stateRoot;
  for (const component of components) {
    current = join(current, component);
    let stat;
    try { stat = lstatSync(current); } catch (error) { fail(`immutable original backup not found: ${backupPath}`, error); }
    if (stat!.isSymbolicLink()) fail(`immutable original backup is a symlink: ${backupPath}`);
    if (component !== components.at(-1) && !stat!.isDirectory()) fail(`immutable original backup parent is not a directory: ${current}`);
  }
  const verified = fingerprint(backupPath, MARKER);
  if (!sameFingerprint(verified, original, false)) fail('immutable original backup: fingerprint verification failed');
  return backupPath;
}

function validatePackDirectory(pack: string, buildId: string, model: GameModel, generatedAt: string, overlay: string, executor: string, engines: Readonly<Record<string, string>>): void {
  const expectedRoot = new Set(['pack.json', 'overlay.js', 'executor.js', 'engine', 'data']);
  let rootStat;
  try { rootStat = lstatSync(pack); } catch (error) { fail(`staged companion pack is missing: ${pack}`, error); }
  if (!rootStat!.isDirectory() || rootStat!.isSymbolicLink()) fail(`staged companion pack is not a regular directory: ${pack}`);
  const names = readdirSync(pack);
  if (names.length !== expectedRoot.size || names.some((name) => !expectedRoot.has(name))) fail('staged companion pack has unexpected root files');
  const manifestPath = join(pack, 'pack.json');
  let manifest: unknown;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (error) { fail('staged companion pack has invalid pack.json', error); }
  if (!isRecord(manifest) || Object.keys(manifest).length !== 3 || manifest.schema_version !== 2 || manifest.build_id !== buildId || manifest.generated_at !== generatedAt) fail('staged companion pack has invalid pack.json schema');
  if (readFileSync(join(pack, 'overlay.js'), 'utf8') !== overlay) fail('staged companion pack overlay does not match embedded source');
  if (readFileSync(join(pack, 'executor.js'), 'utf8') !== executor) fail('staged companion pack executor does not match embedded source');
  const engineDir = join(pack, 'engine');
  const engineNames = readdirSync(engineDir);
  const expectedEngine = new Set(Object.keys(engines).map((name) => `${name}.js`));
  if (engineNames.length !== expectedEngine.size || engineNames.some((name) => !expectedEngine.has(name))) fail('staged companion pack engine files are incomplete');
  for (const [name, source] of Object.entries(engines)) {
    if (readFileSync(join(engineDir, `${name}.js`), 'utf8') !== source) fail(`staged companion pack engine/${name}.js does not match embedded source`);
  }
  const dataDir = join(pack, 'data');
  const dataNames = readdirSync(dataDir);
  const expectedData = new Set<string>(DATA_FILES.map(([, filename]) => filename));
  if (dataNames.length !== expectedData.size || dataNames.some((name) => !expectedData.has(name))) fail('staged companion pack data files are incomplete');
  const modelPath = join(dataDir, 'model.json');
  let value: unknown;
  try { value = JSON.parse(readFileSync(modelPath, 'utf8')); } catch (error) { fail('staged companion pack has invalid model.json', error); }
  if (JSON.stringify(value) !== serializeModel(model)) fail('staged companion pack model does not match compiled model');
}

function publishPack(stateDirectory: string, model: GameModel, generatedAt: string, overlay: string, executor: string, engines: Readonly<Record<string, string>>, fsOps: NonNullable<RefreshDependencies['fileSystem']>): string {
  const mkdir = fsOps.mkdirSync ?? mkdirSync;
  const mkdtemp = fsOps.mkdtempSync ?? mkdtempSync;
  const rename = fsOps.renameSync ?? renameSync;
  const rm = fsOps.rmSync ?? rmSync;
  const write = fsOps.writeFileSync ?? writeFileSync;
  const target = join(stateDirectory, 'pack');
  mkdir(stateDirectory, { recursive: true });
  const stage = mkdtemp(join(stateDirectory, '.pack-staging-'));
  try {
    mkdir(join(stage, 'engine'), { recursive: true });
    mkdir(join(stage, 'data'), { recursive: true });
    const packManifest = `${JSON.stringify({ schema_version: 2, build_id: model.build_id, generated_at: generatedAt }, null, 2)}\n`;
    write(join(stage, 'pack.json'), packManifest, { mode: 0o600 });
    write(join(stage, 'overlay.js'), overlay, { mode: 0o600 });
    write(join(stage, 'executor.js'), executor, { mode: 0o600 });
    for (const [name, source] of Object.entries(engines)) write(join(stage, 'engine', `${name}.js`), source, { mode: 0o600 });
    write(join(stage, 'data', 'model.json'), `${serializeModel(model)}\n`, { mode: 0o600 });
    validatePackDirectory(stage, model.build_id, model, generatedAt, overlay, executor, engines);

    let existing = false;
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`existing companion pack is not a regular directory: ${target}`);
      existing = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') fail(`cannot inspect existing companion pack: ${target}`, error);
    }
    const old = join(stateDirectory, `.pack-previous-${randomUUID()}`);
    let movedOld = false;
    try {
      if (existing) { rename(target, old); movedOld = true; }
      rename(stage, target);
      if (movedOld) rm(old, { recursive: true, force: true });
    } catch (error) {
      try { if (existsSync(target) && movedOld) rm(target, { recursive: true, force: true }); } catch { /* best effort */ }
      try { if (movedOld && existsSync(old)) rename(old, target); } catch { /* best effort */ }
      try { if (existsSync(stage)) rm(stage, { recursive: true, force: true }); } catch { /* best effort */ }
      fail('could not publish companion pack transactionally', error);
    }
    return target;
  } catch (error) {
    try { if (existsSync(stage)) rm(stage, { recursive: true, force: true }); } catch { /* best effort */ }
    if (error instanceof OperationalError) throw error;
    fail('could not build companion pack', error);
  }
}

function dependency<T>(options: RefreshOptions, key: keyof RefreshDependencies, fallback: T): T {
  const injected = options[key as keyof RefreshOptions];
  if (injected !== undefined) return injected as T;
  const nested = options.dependencies?.[key];
  return (nested === undefined ? fallback : nested) as T;
}

/** Extract game data, publish a validated pack, and optionally patch the game archive. */
export function refreshCompanion(options: RefreshOptions = {}): RefreshResult {
  const discover = dependency(options, 'discoverInstall', discoverInstall);
  const install = discover({ steamRoot: options.steamRoot, bottle: options.bottle, platform: options.platform });
  const manifestReader = dependency(options, 'readManifest', readSteamManifest);
  const manifest = manifestReader(install.manifestPath);
  if (manifest.appid !== '3789070') fail(`Steam manifest AppID ${manifest.appid} does not match 3789070`);
  if (!manifest.buildid) fail('Steam manifest has no build ID');
  const state = options.stateDirectory ? resolve(options.stateDirectory) : stateDir({ platform: install.platform });
  const archive = join(install.installDir, 'resources', 'app.asar');
  const fingerprint = dependency(options, 'fingerprint', streamFingerprint);
  const live = fingerprint(archive, MARKER);
  const foreign = fingerprint(archive, FOREIGN_MARKER_PREFIX);
  if (foreign.markerFound) fail("archive is patched by crossover-electron-bridge; run 'crossover-electron-bridge restore fractured-realms' first");

  let pristineArchive = archive;
  let original: { sha256: string; size: number };
  if (live.markerFound) {
    pristineArchive = metadataForBackup(state, manifest.buildid, live, fingerprint);
    const originalFingerprint = fingerprint(pristineArchive, MARKER);
    original = { sha256: originalFingerprint.sha256, size: originalFingerprint.size };
  } else {
    original = { sha256: live.sha256, size: live.size };
  }

  const files = dependency(options, 'listFiles', listFiles)(pristineArchive);
  const bundles = files.filter((name) => /^dist\/assets\/index-[^/]+\.js$/u.test(name));
  if (bundles.length !== 1) fail(`renderer bundle index bundle is ${bundles.length === 0 ? 'missing' : 'ambiguous'}`);
  const extract = dependency(options, 'extractFile', extractFile);
  const source = extract(pristineArchive, bundles[0]!).toString('utf8');
  const extractAllRegistries = dependency(options, 'extractRegistries', extractRegistries);
  const raw = extractAllRegistries(source, files);
  const model = compileModel(raw, manifest.buildid);
  const generatedAt = utcTimestamp(options.clock);
  const overlay = dependency(options, 'overlaySource', OVERLAY_SOURCE);
  const executor = dependency(options, 'executorSource', EXECUTOR_SOURCE);
  const embeddedEngines = Object.fromEntries(ENGINE_SOURCES);
  const injectedEngines = dependency(options, 'engineSources', embeddedEngines);
  const engineNames: string[] = ENGINE_SOURCES.map(([name]) => name);
  if (Object.keys(injectedEngines).length !== engineNames.length || Object.keys(injectedEngines).some((name) => !engineNames.includes(name))) fail('embedded companion engine source set is invalid');
  if (typeof overlay !== 'string' || overlay.length === 0) fail('embedded companion overlay source is unavailable');
  if (typeof executor !== 'string' || executor.length === 0) fail('embedded companion executor source is unavailable');
  for (const [name] of ENGINE_SOURCES) {
    if (typeof injectedEngines[name] !== 'string' || injectedEngines[name].length === 0) fail(`embedded companion engine/${name}.js source is unavailable`);
  }
  const payloadRevision = computePayloadRevision([
    ELECTRON_HOST_SOURCE,
    FRACTURED_ADAPTER_SOURCE,
    overlay,
    executor,
    ...ENGINE_SOURCES.map(([name]) => injectedEngines[name]!),
  ]);
  const pack = publishPack(state, model, generatedAt, overlay, executor, injectedEngines, options.fileSystem ?? options.dependencies?.fileSystem ?? {});
  if (!writeModelDb(model, join(state, 'model.db'))) console.warn('model.db unavailable; continuing with model.json pack');

  const expectedOriginal = { sha256: original.sha256.toLowerCase(), size: original.size };
  if (options.noPatch) return { install, stateDirectory: state, packDirectory: pack, buildId: manifest.buildid, original: expectedOriginal, changed: false };
  const patchManager = options.patchManager ?? options.dependencies?.patchManager ?? new PatchManager({ clock: options.clock });
  const applyFactory = dependency(options, 'createApply', createFracturedApply);
  const patch = patchManager.patch({
    archivePath: archive,
    manifestPath: install.manifestPath,
    stateDirectory: state,
    expectedBuildId: manifest.buildid,
    expectedOriginal,
    payloadRevision,
    apply: applyFactory({ buildId: manifest.buildid, packDirectory: pack, payloadRevision }),
  });
  return { install, stateDirectory: state, packDirectory: pack, buildId: manifest.buildid, original: expectedOriginal, changed: patch.changed };
}
