import { mkdtempSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicCopy, atomicCopyIfAbsent, atomicWriteText } from '../lib/atomic.ts';
import { extractAll, packDirInline } from '../lib/asar.ts';
import { readSteamManifest } from '../lib/acf.ts';
import { OperationalError } from '../lib/errors.ts';
import { FOREIGN_MARKER_PREFIX, MARKER, streamFingerprint, type Fingerprint } from './fingerprint.ts';

const METADATA_KEYS_V2 = new Set(['metadata_version', 'profile_id', 'profile_revision', 'marker', 'steam_build_id', 'timestamp', 'original', 'patched', 'backup']);
const METADATA_KEYS_V3 = new Set([...METADATA_KEYS_V2, 'payload_revision']);
const RECORD_KEYS = new Set(['sha256', 'size']);
const BACKUP_KEYS = new Set(['path', 'sha256', 'size']);
const SHA256 = /^[0-9a-fA-F]{64}$/;

export interface PatchRequest {
  archivePath: string;
  manifestPath: string;
  stateDirectory: string;
  expectedBuildId: string;
  expectedOriginal: { sha256: string; size: number };
  payloadRevision: string;
  apply(extractedRoot: string): void;
}
export interface RestoreRequest {
  archivePath: string;
  manifestPath: string;
  stateDirectory: string;
  expectedBuildId: string;
  expectedOriginal: { sha256: string; size: number };
}
export interface PatchResult { changed: boolean; archivePath: string; metadataPath: string; }
export interface PatchOperations {
  atomicCopy?: (source: string, destination: string) => void;
  atomicCopyIfAbsent?: (source: string, destination: string) => boolean;
  atomicWriteText?: (path: string, text: string, mode?: number) => void;
  fingerprint?: (path: string, marker?: string | Uint8Array) => Fingerprint;
  extractAll?: (archive: string, destination: string) => string[];
  packDirInline?: (sourceDirectory: string, destination: string) => void;
}
export interface PatchManagerOptions {
  clock?: (() => Date | string) | Date | string;
  hook?: Record<string, (...args: unknown[]) => void> | ((name: string, ...args: unknown[]) => void);
  operations?: PatchOperations;
}
type Request = PatchRequest | RestoreRequest;
type FingerprintFn = (path: string, marker?: string | Uint8Array) => Fingerprint;

function opError(message: string, cause?: unknown): OperationalError { return new OperationalError(message, cause instanceof Error ? { cause } : undefined); }
function keySet(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function sameKeys(value: Record<string, unknown>, expected: Set<string>): boolean { const keys = Object.keys(value); return keys.length === expected.size && keys.every((key) => expected.has(key)); }
function isInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function validateRecord(value: unknown, description: string): { sha256: string; size: number } {
  if (!keySet(value) || !sameKeys(value, RECORD_KEYS)) throw opError(`state metadata has an invalid ${description} record`);
  const sha256 = value.sha256; const size = value.size;
  if (typeof sha256 !== 'string' || !SHA256.test(sha256) || !isInteger(size)) throw opError(`state metadata has an invalid ${description} hash or size`);
  return { sha256: sha256.toLowerCase(), size };
}
function sameFingerprint(actual: Fingerprint, expected: { sha256: string; size: number }, marker?: boolean): boolean {
  return actual.sha256.toLowerCase() === expected.sha256.toLowerCase() && actual.size === expected.size && (marker === undefined || actual.markerFound === marker);
}
function expectedOriginal(request: Request): { sha256: string; size: number } {
  if (!SHA256.test(request.expectedOriginal.sha256) || !isInteger(request.expectedOriginal.size)) throw opError('expected original archive has an invalid hash or size');
  return { sha256: request.expectedOriginal.sha256.toLowerCase(), size: request.expectedOriginal.size };
}
function validateTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw opError('state metadata has no valid patch timestamp');
  return value;
}
function utcTimestamp(clock: PatchManagerOptions['clock']): string {
  let value: Date | string;
  try { value = clock === undefined ? new Date() : typeof clock === 'function' ? clock() : clock; } catch (error) { throw opError('patch clock did not return a UTC timestamp', error); }
  if (value instanceof Date) { if (!Number.isFinite(value.getTime())) throw opError('patch clock did not return a UTC timestamp'); return value.toISOString(); }
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw opError('patch clock did not return a UTC timestamp');
  return new Date(value).toISOString();
}

export class PatchManager {
  private readonly clock: PatchManagerOptions['clock'];
  private readonly hook?: PatchManagerOptions['hook'];
  private readonly operations: Required<Pick<PatchOperations, 'atomicCopy' | 'atomicWriteText' | 'fingerprint' | 'extractAll' | 'packDirInline'>> & Pick<PatchOperations, 'atomicCopyIfAbsent'>;
  constructor(options: PatchManagerOptions = {}) {
    this.clock = options.clock; this.hook = options.hook;
    const overrides = options.operations ?? {};
    this.operations = {
      atomicCopy: overrides.atomicCopy ?? atomicCopy,
      atomicWriteText: overrides.atomicWriteText ?? atomicWriteText,
      fingerprint: overrides.fingerprint ?? (streamFingerprint as FingerprintFn),
      extractAll: overrides.extractAll ?? ((archive, destination) => extractAll(archive, destination)),
      packDirInline: overrides.packDirInline ?? packDirInline,
      atomicCopyIfAbsent: overrides.atomicCopyIfAbsent,
    };
  }
  metadataPath(request: Request): string { return join(request.stateDirectory, 'metadata.json'); }
  private callHook(name: string, ...args: unknown[]): void {
    if (!this.hook) return;
    if (typeof this.hook === 'function') { this.hook(name, ...args); return; }
    const fn = this.hook[name];
    if (fn !== undefined) { if (typeof fn !== 'function') throw opError(`patch hook ${name} is not callable`); fn(...args); }
  }
  private fingerprint(path: string, marker: string | Uint8Array = MARKER): Fingerprint {
    try { return this.operations.fingerprint(path, marker); } catch (error) { throw opError(`cannot read archive: ${path}`, error); }
  }
  private manifest(request: Request): string {
    const manifest = readSteamManifest(request.manifestPath);
    if (manifest.appid !== '3789070') throw opError(`Steam manifest AppID ${manifest.appid} does not match 3789070`);
    if (manifest.buildid !== request.expectedBuildId) throw opError(`Steam build ID ${manifest.buildid} does not match expected ${request.expectedBuildId}`);
    return manifest.buildid;
  }
  private readMetadata(request: Request): { metadata: Record<string, unknown>; original: { sha256: string; size: number }; patched: { sha256: string; size: number }; backupPath: string; payloadRevision: string | null } {
    const path = this.metadataPath(request); let metadata: unknown;
    try { metadata = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { throw opError(`state metadata could not be read: ${path}`, error); }
    if (!keySet(metadata)) throw opError(`state metadata has unexpected keys: ${path}`);
    const legacy = metadata.metadata_version === 2 && sameKeys(metadata, METADATA_KEYS_V2);
    const current = metadata.metadata_version === 3 && sameKeys(metadata, METADATA_KEYS_V3);
    if (!legacy && !current) throw opError(`unsupported or malformed state metadata version: ${path}`);
    if (metadata.profile_id !== 'fractured-realms') throw opError('state metadata profile does not match this profile');
    if (metadata.profile_revision !== MARKER || metadata.marker !== MARKER) throw opError('state metadata marker does not match this patch profile');
    if (typeof metadata.steam_build_id !== 'string' || metadata.steam_build_id.length === 0) throw opError('state metadata has no valid Steam build ID');
    validateTimestamp(metadata.timestamp);
    const original = validateRecord(metadata.original, 'original archive'); const patched = validateRecord(metadata.patched, 'patched archive');
    if (!keySet(metadata.backup) || !sameKeys(metadata.backup, BACKUP_KEYS)) throw opError('state metadata has an invalid backup record');
    const backupPath = metadata.backup.path;
    if (typeof backupPath !== 'string' || backupPath !== `backups/app.asar-${original.sha256}.original`) throw opError('state metadata points at an unexpected original backup');
    const backup = validateRecord({ sha256: metadata.backup.sha256, size: metadata.backup.size }, 'backup');
    if (backup.sha256 !== original.sha256 || backup.size !== original.size) throw opError('state metadata backup does not match the original archive');
    const payloadRevision = current && typeof metadata.payload_revision === 'string' && SHA256.test(metadata.payload_revision)
      ? metadata.payload_revision.toLowerCase()
      : current ? (() => { throw opError('state metadata has an invalid payload revision'); })() : null;
    return { metadata, original, patched, backupPath, payloadRevision };
  }
  private verifyBackup(path: string, expected: { sha256: string; size: number }): void {
    try { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('not a regular file'); } catch (error) { throw opError(`immutable original backup not found: ${path}`, error); }
    if (!sameFingerprint(this.fingerprint(path), expected, false)) throw opError('immutable original backup: fingerprint verification failed');
  }
  private ensureBackup(request: PatchRequest, original: { sha256: string; size: number }): string {
    const path = join(request.stateDirectory, 'backups', `app.asar-${original.sha256}.original`); mkdirSync(join(request.stateDirectory, 'backups'), { recursive: true });
    let created = false;
    try {
      if (existsSync(path)) { this.verifyBackup(path, original); return path; }
      const copier = this.operations.atomicCopyIfAbsent ?? atomicCopyIfAbsent; created = copier(request.archivePath, path); this.verifyBackup(path, original); return path;
    } catch (error) { if (created) { try { unlinkSync(path); } catch { /* best effort */ } } throw error; }
  }
  private makeMetadata(request: PatchRequest, original: { sha256: string; size: number }, patched: { sha256: string; size: number }): string {
    if (!SHA256.test(request.payloadRevision)) throw opError('payload revision has an invalid hash');
    const metadata = { metadata_version: 3, profile_id: 'fractured-realms', profile_revision: MARKER, marker: MARKER, payload_revision: request.payloadRevision.toLowerCase(), steam_build_id: request.expectedBuildId, timestamp: utcTimestamp(this.clock), original, patched, backup: { path: `backups/app.asar-${original.sha256}.original`, sha256: original.sha256, size: original.size } };
    if (!sameKeys(metadata, METADATA_KEYS_V3)) throw opError('patch metadata payload is incomplete');
    JSON.parse(JSON.stringify(metadata)); return `${JSON.stringify(metadata, null, 2)}\n`;
  }
  private rollback(archive: string, candidate: string, packed: Fingerprint, original: { sha256: string; size: number }, cause: unknown, context: string): never {
    let live: Fingerprint; try { live = this.fingerprint(archive); } catch { throw opError(`${context}; live archive is missing or unreadable, so rollback was not attempted: ${archive}`, cause); }
    if (sameFingerprint(live, original, false)) throw opError(`${context}; verified original archive is already installed, so rollback was not needed: ${archive}`, cause);
    if (!sameFingerprint(live, packed, true)) throw opError(`${context}; archive changed concurrently, so rollback was not attempted: ${archive}`, cause);
    if (!sameFingerprint(this.fingerprint(candidate), original, false)) throw opError(`${context}; rollback candidate verification failed`, cause);
    if (!sameFingerprint(this.fingerprint(archive), packed, true)) throw opError(`${context}; archive changed concurrently before rollback, so it was not overwritten: ${archive}`, cause);
    try { this.operations.atomicCopy(candidate, archive); if (!sameFingerprint(this.fingerprint(archive), original, false)) throw new Error('rollback archive verification failed'); }
    catch (error) { throw opError(`${context}; rollback to the verified original failed: ${error instanceof Error ? error.message : String(error)}`, cause); }
    throw opError(`${context}; verified original restored: ${cause instanceof Error ? cause.message : String(cause)}`, cause);
  }
  private rollbackPatched(archive: string, candidate: string, packed: Fingerprint, previous: { sha256: string; size: number }, cause: unknown, context: string, metadataPath: string, previousMetadata: string, metadataCommitted: boolean): never {
    let live: Fingerprint;
    try { live = this.fingerprint(archive); } catch { throw opError(`${context}; live archive is missing or unreadable, so rollback was not attempted: ${archive}`, cause); }
    if (!sameFingerprint(live, previous, true)) {
      if (sameFingerprint(live, packed, true)) {
        if (!sameFingerprint(this.fingerprint(candidate), previous, true)) throw opError(`${context}; previous patch rollback candidate verification failed`, cause);
        try {
          this.operations.atomicCopy(candidate, archive);
          if (!sameFingerprint(this.fingerprint(archive), previous, true)) throw new Error('previous patch rollback verification failed');
        } catch (error) { throw opError(`${context}; rollback to the verified previous patch failed: ${error instanceof Error ? error.message : String(error)}`, cause); }
      } else {
        throw opError(`${context}; archive changed concurrently, so rollback was not attempted: ${archive}`, cause);
      }
    }
    if (metadataCommitted) {
      try { this.operations.atomicWriteText(metadataPath, previousMetadata, 0o600); }
      catch (error) { throw opError(`${context}; previous patch was restored but metadata rollback failed: ${error instanceof Error ? error.message : String(error)}`, cause); }
    }
    throw opError(`${context}; verified previous patch restored: ${cause instanceof Error ? cause.message : String(cause)}`, cause);
  }

  private repatch(request: PatchRequest, state: ReturnType<PatchManager['readMetadata']>, live: Fingerprint): PatchResult {
    const metadataPath = this.metadataPath(request);
    const previousMetadata = readFileSync(metadataPath, 'utf8');
    const backupPath = join(request.stateDirectory, state.backupPath);
    const workspace = mkdtempSync(join(tmpdir(), 'fractured-realms-repatch-'));
    const extracted = join(workspace, 'app');
    const packedPath = join(workspace, 'app.asar');
    const rollbackCandidate = join(workspace, 'previous.asar');
    try {
      this.verifyBackup(backupPath, state.original);
      this.operations.extractAll(backupPath, extracted);
      request.apply(extracted);
      this.operations.packDirInline(extracted, packedPath);
      const packed = this.fingerprint(packedPath);
      if (!packed.markerFound) throw opError('repacked archive is missing the patch marker; refusing replacement');
      const metadataText = this.makeMetadata(request, state.original, { sha256: packed.sha256, size: packed.size });
      this.callHook('before_replace', request.archivePath);
      this.manifest(request);
      if (!sameFingerprint(this.fingerprint(request.archivePath), live, true)) throw opError('installed patched archive changed while preparing the replacement; refusing replacement');
      this.operations.atomicCopy(request.archivePath, rollbackCandidate);
      if (!sameFingerprint(this.fingerprint(rollbackCandidate), state.patched, true)) throw opError('previous patch rollback candidate verification failed');
      try {
        this.operations.atomicCopy(packedPath, request.archivePath);
        if (!sameFingerprint(this.fingerprint(request.archivePath), packed, true)) throw opError('atomically installed replacement archive failed verification; state metadata was not written');
      } catch (error) {
        this.rollbackPatched(request.archivePath, rollbackCandidate, packed, state.patched, error, 'archive replacement failed after repatch transition', metadataPath, previousMetadata, false);
      }
      try {
        this.callHook('after_replace', request.archivePath);
        this.verifyBackup(backupPath, state.original);
        this.callHook('before_metadata_commit', metadataPath);
        this.operations.atomicWriteText(metadataPath, metadataText, 0o600);
      } catch (error) {
        this.rollbackPatched(request.archivePath, rollbackCandidate, packed, state.patched, error, 'metadata commit failed after repatch', metadataPath, previousMetadata, false);
      }
      try {
        this.callHook('after_metadata_commit', metadataPath);
        this.verifyBackup(backupPath, state.original);
        this.manifest(request);
        if (!sameFingerprint(this.fingerprint(request.archivePath), packed, true)) throw opError('installed replacement archive changed after patch commit');
      } catch (error) {
        this.rollbackPatched(request.archivePath, rollbackCandidate, packed, state.patched, error, 'repatch final verification failed', metadataPath, previousMetadata, true);
      }
      return { changed: true, archivePath: request.archivePath, metadataPath };
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  patch(request: PatchRequest): PatchResult {
    const original = expectedOriginal(request); if (!SHA256.test(request.payloadRevision)) throw opError('payload revision has an invalid hash'); this.manifest(request); const metadataPath = this.metadataPath(request); let live = this.fingerprint(request.archivePath);
    if (this.fingerprint(request.archivePath, FOREIGN_MARKER_PREFIX).markerFound) throw opError("archive is patched by crossover-electron-bridge; run 'crossover-electron-bridge restore fractured-realms' first");
    if (live.markerFound) {
      try {
        const state = this.readMetadata(request); if (state.metadata.steam_build_id !== request.expectedBuildId) throw opError('state metadata Steam build does not match installed build');
        if (state.original.sha256 !== original.sha256 || state.original.size !== original.size) throw opError('state metadata original archive does not match supported build');
        if (!sameFingerprint(live, state.patched, true)) throw opError('installed patched archive: fingerprint verification failed');
        this.verifyBackup(join(request.stateDirectory, state.backupPath), state.original); this.manifest(request); live = this.fingerprint(request.archivePath);
        if (!sameFingerprint(live, state.patched, true)) throw opError('installed patched archive: fingerprint verification failed'); this.verifyBackup(join(request.stateDirectory, state.backupPath), state.original);
      } catch (error) { throw opError(`installed archive is marked patched but its recovery state cannot be verified: ${error instanceof Error ? error.message : String(error)}`, error); }
      const state = this.readMetadata(request);
      if (state.payloadRevision === request.payloadRevision.toLowerCase()) return { changed: false, archivePath: request.archivePath, metadataPath };
      return this.repatch(request, state, live);
    }
    if (!sameFingerprint(live, original, false)) throw opError(`Unsupported Steam build ${request.expectedBuildId} for fractured-realms`);
    const workspace = mkdtempSync(join(tmpdir(), 'fractured-realms-patch-')); const extracted = join(workspace, 'app'); const packedPath = join(workspace, 'app.asar'); const rollbackCandidate = join(workspace, 'original.asar');
    try {
      this.operations.extractAll(request.archivePath, extracted); request.apply(extracted); this.operations.packDirInline(extracted, packedPath); const packed = this.fingerprint(packedPath);
      if (!packed.markerFound) throw opError('packed archive is missing the patch marker; refusing replacement');
      this.callHook('before_replace', request.archivePath); this.manifest(request); if (!sameFingerprint(this.fingerprint(request.archivePath), live, false)) throw opError('installed archive changed while preparing the patch; refusing replacement');
      const metadataText = this.makeMetadata(request, original, { sha256: packed.sha256, size: packed.size }); const backupPath = this.ensureBackup(request, original); this.operations.atomicCopy(backupPath, rollbackCandidate);
      if (!sameFingerprint(this.fingerprint(rollbackCandidate), original, false)) throw opError('rollback candidate: fingerprint verification failed'); this.manifest(request); if (!sameFingerprint(this.fingerprint(request.archivePath), live, false)) throw opError('installed archive changed while preparing the patch; refusing replacement');
      try { this.operations.atomicCopy(packedPath, request.archivePath); if (!sameFingerprint(this.fingerprint(request.archivePath), packed, true)) throw opError('atomically installed archive failed verification; state metadata was not written'); }
      catch (error) { this.rollback(request.archivePath, rollbackCandidate, packed, original, error, 'archive replacement failed after transition'); }
      try { this.callHook('after_replace', request.archivePath); this.verifyBackup(backupPath, original); this.callHook('before_metadata_commit', metadataPath); mkdirSync(request.stateDirectory, { recursive: true }); this.operations.atomicWriteText(metadataPath, metadataText, 0o600); }
      catch (error) { this.rollback(request.archivePath, rollbackCandidate, packed, original, error, 'metadata commit failed after archive replacement'); }
      try { this.callHook('after_metadata_commit', metadataPath); this.verifyBackup(backupPath, original); this.manifest(request); if (!sameFingerprint(this.fingerprint(request.archivePath), packed, true)) throw opError('installed archive changed after patch commit'); }
      catch (error) { this.rollback(request.archivePath, rollbackCandidate, packed, original, error, 'patch final verification failed after archive replacement'); }
      return { changed: true, archivePath: request.archivePath, metadataPath };
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  }
  restore(request: RestoreRequest): void {
    const original = expectedOriginal(request); this.manifest(request); const state = this.readMetadata(request); if (state.metadata.steam_build_id !== request.expectedBuildId) throw opError('Steam build ID no longer matches the patched build; refusing restore');
    if (state.original.sha256 !== original.sha256 || state.original.size !== original.size) throw opError('state metadata original archive does not match supported build'); const live = this.fingerprint(request.archivePath); if (!sameFingerprint(live, state.patched, true)) throw opError('installed patched archive: fingerprint verification failed');
    const backupPath = join(request.stateDirectory, state.backupPath); this.verifyBackup(backupPath, original); const workspace = mkdtempSync(join(tmpdir(), 'fractured-realms-restore-')); const candidate = join(workspace, 'original.asar');
    try { this.operations.atomicCopy(backupPath, candidate); if (!sameFingerprint(this.fingerprint(candidate), original, false)) throw opError('restore candidate: fingerprint verification failed'); this.callHook('before_restore_replace', request.archivePath); this.verifyBackup(backupPath, original); this.manifest(request); if (!sameFingerprint(this.fingerprint(request.archivePath), state.patched, true)) throw opError('installed archive changed during restore preflight; refusing replacement'); this.operations.atomicCopy(candidate, request.archivePath); if (!sameFingerprint(this.fingerprint(request.archivePath), original, false)) throw opError('restored archive: fingerprint verification failed'); }
    finally { rmSync(workspace, { recursive: true, force: true }); }
  }
}
export { MARKER, FOREIGN_MARKER_PREFIX };
