import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { formatDoctor, runDoctor, type DoctorOptions, type DoctorResult } from '../src/doctor.ts';
import type { SteamInstall } from '../src/platform/steam.ts';
import { MARKER, FOREIGN_MARKER_PREFIX, streamFingerprint } from '../src/patch/fingerprint.ts';

type Fixture = { root: string; archive: string; state: string; install: SteamInstall };

const manifest = { appid: '3789070', name: 'Fractured Realms', installdir: 'Fractured Realms', buildid: 'build-1' };

function fixture(bytes = 'pristine archive'): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'fr-doctor-'));
  const installDir = join(root, 'game', 'Fractured Realms');
  const archive = join(installDir, 'resources', 'app.asar');
  const state = join(root, 'state');
  mkdirSync(join(installDir, 'resources'), { recursive: true });
  writeFileSync(archive, bytes);
  const install = { steamRoot: join(root, 'steam'), steamExe: join(root, 'steam', 'Steam.exe'), manifestPath: join(root, 'manifest.acf'), installDir, platform: 'linux' as const };
  return { root, archive, state, install };
}

function pack(state: string, buildId = 'build-1'): void {
  const directory = join(state, 'pack');
  mkdirSync(join(directory, 'data'), { recursive: true });
  writeFileSync(join(directory, 'pack.json'), JSON.stringify({ schema_version: 1, build_id: buildId, generated_at: '2026-01-01T00:00:00.000Z' }));
  for (const name of ['overlay.js', 'planner.js', 'executor.js']) writeFileSync(join(directory, name), '');
  for (const name of ['items.json', 'actions.json', 'skills.json', 'xp.json', 'buildings.json', 'digsites.json', 'strings-en.json']) writeFileSync(join(directory, 'data', name), '{}');
}

function base(f: Fixture, extra: Partial<DoctorOptions> = {}): DoctorOptions {
  return {
    platform: 'linux',
    stateDirectory: f.state,
    discoverInstall: () => f.install,
    readManifest: () => manifest,
    probePort: async () => 'free',
    ...extra,
  };
}

function record(path: string, marker?: string): { sha256: string; size: number } {
  const fp = streamFingerprint(path, marker ?? MARKER);
  return { sha256: fp.sha256, size: fp.size };
}

function ownMetadata(f: Fixture, version: 2 | 3 = 2): void {
  const originalPath = join(f.root, 'original.asar');
  writeFileSync(originalPath, 'pristine archive');
  const original = record(originalPath);
  const patched = record(f.archive);
  mkdirSync(join(f.state, 'backups'), { recursive: true });
  const backup = join(f.state, 'backups', `app.asar-${original.sha256}.original`);
  writeFileSync(backup, readFileSync(originalPath));
  mkdirSync(f.state, { recursive: true });
  const metadata = { metadata_version: version, profile_id: 'fractured-realms', profile_revision: MARKER, marker: MARKER, steam_build_id: 'build-1', timestamp: '2026-01-01T00:00:00.000Z', original, patched, backup: { path: `backups/app.asar-${original.sha256}.original`, ...original }, ...(version === 3 ? { payload_revision: 'a'.repeat(64) } : {}) };
  writeFileSync(join(f.state, 'metadata.json'), JSON.stringify(metadata));
}

function archiveRow(result: DoctorResult): DoctorResult['rows'][number] | undefined {
  return result.rows.find((value) => value.check === 'archive');
}

test('pristine archive remains launch-blocking even with recorded recovery state and complete pack', async () => {
  const f = fixture();
  pack(f.state);
  const result = await runDoctor(base(f));
  assert.equal(archiveRow(result)?.status, 'FAIL');
  ownMetadata(f);
  const verified = await runDoctor(base(f));
  assert.equal(archiveRow(verified)?.status, 'FAIL');
  assert.match(archiveRow(verified)?.message ?? '', /run 'fractured-companion refresh'/);
  assert.equal(verified.rows.find((value) => value.check === 'pack')?.status, 'PASS');
  assert.equal(verified.blocking, true);
  writeFileSync(join(f.state, 'metadata.json'), JSON.stringify({ metadata_version: 2, profile_id: 'wrong' }));
  const corrupt = await runDoctor(base(f));
  assert.equal(archiveRow(corrupt)?.status, 'FAIL');
  assert.match(archiveRow(corrupt)?.message ?? '', /unknown/);
});

test('verified own patch passes and stale or missing pack fails', async () => {
  const f = fixture(`patched ${MARKER}`);
  ownMetadata(f);
  pack(f.state);
  const result = await runDoctor(base(f));
  assert.equal(archiveRow(result)?.status, 'PASS');
  assert.equal(result.blocking, false);
  writeFileSync(join(f.state, 'pack', 'pack.json'), JSON.stringify({ schema_version: 1, build_id: 'old', generated_at: '2026-01-01T00:00:00.000Z' }));
  assert.equal((await runDoctor(base(f))).rows.find((value) => value.check === 'pack')?.status, 'FAIL');
  const missing = fixture(`patched ${MARKER}`);
  ownMetadata(missing);
  assert.equal((await runDoctor(base(missing))).rows.find((value) => value.check === 'pack')?.status, 'FAIL');
});


test('verified own v3 metadata passes', async () => {
  const f = fixture(`patched ${MARKER}`);
  ownMetadata(f, 3);
  pack(f.state);
  const result = await runDoctor(base(f));
  assert.equal(archiveRow(result)?.status, 'PASS');
});

test('foreign marker and unknown archive fail closed', async () => {
  const foreign = fixture(`patched ${FOREIGN_MARKER_PREFIX}V2`);
  pack(foreign.state);
  const foreignResult = await runDoctor(base(foreign));
  assert.equal(archiveRow(foreignResult)?.status, 'FAIL');
  assert.match(archiveRow(foreignResult)?.message ?? '', /crossover-electron-bridge/);
  const unknown = fixture('unrecorded archive');
  pack(unknown.state);
  assert.equal(archiveRow(await runDoctor(base(unknown)))?.status, 'FAIL');
});

function requestFor(mode: 'ECONNREFUSED' | 'ECONNRESET' | 'timeout'): NonNullable<DoctorOptions['http']>['request'] {
  type FakeRequest = {
    on(event: string, listener: (...args: unknown[]) => void): FakeRequest;
    setTimeout(milliseconds: number, listener: () => void): FakeRequest;
    destroy(): void;
    abort(): void;
    end(): void;
  };
  return ((_: unknown, __: unknown) => {
    const request: FakeRequest = {
      on(event, listener) {
        if (event === 'error' && mode !== 'timeout') queueMicrotask(() => listener({ code: mode }));
        if (event === 'timeout' && mode === 'timeout') queueMicrotask(listener);
        return request;
      },
      setTimeout(_milliseconds, listener) {
        if (mode === 'timeout') queueMicrotask(listener);
        return request;
      },
      destroy() {},
      abort() {},
      end() {},
    };
    return request;
  }) as unknown as NonNullable<DoctorOptions['http']>['request'];
}

test('port probe treats only ECONNREFUSED as free; reset and timeout are occupied', async () => {
  const f = fixture();
  const statuses = [
    ['ECONNREFUSED', 'PASS'],
    ['ECONNRESET', 'FAIL'],
    ['timeout', 'FAIL'],
  ] as const;
  for (const [mode, expected] of statuses) {
    const result = await runDoctor(base(f, { probePort: undefined, http: { request: requestFor(mode) } }));
    assert.equal(result.rows.find((value) => value.check === 'port')?.status, expected, mode);
  }
});
test('macOS requires a regular executable CrossOver wine binary', async () => {
  const f = fixture();
  const wine = join(f.root, 'wine');
  writeFileSync(wine, '#!/bin/sh\n');
  const fileSystem = {
    lstatSync(path: string) {
      const stat = lstatSync(path);
      if (path === wine) stat.mode |= 0o111;
      return stat;
    },
  };
  const result = await runDoctor(base(f, { platform: 'darwin', fileSystem, discoverInstall: () => ({ ...f.install, platform: 'darwin', winePath: wine }) }));
  assert.equal(result.rows.find((value) => value.check === 'wine')?.status, 'PASS');
  const missing = await runDoctor(base(f, { platform: 'darwin', discoverInstall: () => ({ ...f.install, platform: 'darwin', winePath: join(f.root, 'missing-wine') }) }));
  assert.equal(missing.rows.find((value) => value.check === 'wine')?.status, 'FAIL');
});

test('JSON formatting has exactly the row contract and doctor never creates state', async () => {
  const f = fixture();
  const result = await runDoctor(base(f));
  assert.equal(existsSync(f.state), false);
  const parsed = JSON.parse(formatDoctor(result, true)) as unknown;
  assert.ok(Array.isArray(parsed));
  for (const value of parsed) assert.deepEqual(Object.keys(value as object).sort(), ['check', 'message', 'status']);
  assert.match(formatDoctor(result), /PASS|FAIL/);
  assert.equal(existsSync(f.state), false);
});
