import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readSteamManifest, type SteamManifest } from './lib/acf.ts';
import { OperationalError } from './lib/errors.ts';
import { PatchManager } from './patch/manager.ts';
import { discoverInstall, type DiscoverInstallOptions, type SteamInstall } from './platform/steam.ts';
import { stateDir } from './platform/state.ts';

const SHA256 = /^[0-9a-f]{64}$/iu;

export interface RestoreResult {
  readonly install: SteamInstall;
  readonly archivePath: string;
  readonly buildId: string;
  readonly stateDirectory: string;
}

export interface RestoreDependencies {
  discoverInstall?: (options: DiscoverInstallOptions) => SteamInstall;
  readManifest?: (path: string) => SteamManifest;
  patchManager?: Pick<PatchManager, 'restore'>;
}

export interface RestoreOptions extends DiscoverInstallOptions {
  stateDirectory?: string;
  dependencies?: RestoreDependencies;
  discoverInstall?: RestoreDependencies['discoverInstall'];
  readManifest?: RestoreDependencies['readManifest'];
  patchManager?: RestoreDependencies['patchManager'];
}

function fail(message: string, cause?: unknown): never {
  if (cause instanceof OperationalError) throw cause;
  throw new OperationalError(message, cause instanceof Error ? { cause } : undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRestoreExpectation(metadataPath: string): { buildId: string; original: { sha256: string; size: number } } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    fail(`state metadata could not be read: ${metadataPath}`, error);
  }
  if (!isRecord(parsed)) fail(`state metadata has an invalid root record: ${metadataPath}`);

  const buildId = parsed.steam_build_id;
  if (typeof buildId !== 'string' || buildId.length === 0) fail('state metadata has no valid Steam build ID');

  const original = parsed.original;
  if (!isRecord(original)) fail('state metadata has an invalid original archive record');
  const keys = Object.keys(original);
  if (keys.length !== 2 || !keys.includes('sha256') || !keys.includes('size')) fail('state metadata has an invalid original archive record');
  const sha256 = original.sha256;
  const size = original.size;
  if (typeof sha256 !== 'string' || !SHA256.test(sha256) || typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    fail('state metadata has an invalid original archive hash or size');
  }
  return { buildId, original: { sha256: sha256.toLowerCase(), size } };
}

function dependency<T extends keyof RestoreDependencies>(options: RestoreOptions, key: T, fallback: NonNullable<RestoreDependencies[T]>): NonNullable<RestoreDependencies[T]> {
  const direct = options[key as keyof RestoreOptions] as RestoreDependencies[T] | undefined;
  if (direct !== undefined) return direct as NonNullable<RestoreDependencies[T]>;
  const nested = options.dependencies?.[key];
  return (nested ?? fallback) as NonNullable<RestoreDependencies[T]>;
}

/** Restore the immutable original archive after strict metadata extraction and manager revalidation. */
export function restoreCompanion(options: RestoreOptions = {}): RestoreResult {
  const discover = dependency(options, 'discoverInstall', discoverInstall);
  const install = discover({ steamRoot: options.steamRoot, bottle: options.bottle, platform: options.platform });
  const readManifest = dependency(options, 'readManifest', readSteamManifest);
  // Read the manifest up front so discovery/restore failures are reported as an
  // operational install error even when a test or embedder supplies a manager.
  readManifest(install.manifestPath);
  const state = options.stateDirectory ? resolve(options.stateDirectory) : stateDir({ platform: install.platform });
  const metadataPath = join(state, 'metadata.json');
  const expectation = readRestoreExpectation(metadataPath);
  const archivePath = join(install.installDir, 'resources', 'app.asar');
  const manager = dependency(options, 'patchManager', new PatchManager());
  manager.restore({
    archivePath,
    manifestPath: install.manifestPath,
    stateDirectory: state,
    expectedBuildId: expectation.buildId,
    expectedOriginal: expectation.original,
  });
  return { install, archivePath, buildId: expectation.buildId, stateDirectory: state };
}
