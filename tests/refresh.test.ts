import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import test from 'node:test';
import { packDirInline } from '../src/lib/asar.ts';
import { streamFingerprint } from '../src/patch/fingerprint.ts';
import {
  ENGINE_CLOSURE_SOURCE,
  ENGINE_EXPAND_SOURCE,
  ENGINE_FORMULAS_SOURCE,
  ENGINE_MODEL_SOURCE,
  ENGINE_QUEUE_SOURCE,
  ENGINE_SIMULATE_SOURCE,
  EXECUTOR_SOURCE,
  OVERLAY_SOURCE,
} from '../src/generated/embedded.ts';
import { refreshCompanion, resolveBackupPath } from '../src/refresh.ts';
import { sqliteAvailable } from '../src/lib/sqlite.ts';

const DATA = {
  items: { ancient_spore: { label: 'Ancient Spore', type: 'material', value: 1 } },
  actions: { archaeology: [{ id: 'dig_ancient_cairn', levelReq: 1, xp: 1, interval: 1, outputs: { ancient_spore: 1 } }] },
  actionGates: {},
  skills: [{ id: 'archaeology', name: 'Archaeology', category: 'gathering' }],
  xp: [0, 0, 1],
  tools: {}, mapsRegular: [], mapsDeep: [], chartSupplyTiers: {}, agilityCourses: [], bags: [], machines: [], boons: [], restorations: [], recipeMeals: [], seals: [], patterns: {}, grandReward: {}, buildings: [], buildingXp: {}, zones: [], digsites: [], achievements: [], offlineGold: {}, prestigeTitles: null,
  stringsEn: { 'name.fossil_tracks': 'Fossil Tracks', 'itemdesc.ancient_spore': 'Ancient Spore' },
} as any;

function fixture(): { root: string; archive: string; manifest: string; state: string } {
  const root = mkdtempSync(join(tmpdir(), 'fr-refresh-test-'));
  const library = join(root, 'steamapps');
  const game = join(root, 'steamapps', 'common', 'Fractured Realms');
  const resources = join(game, 'resources');
  const extracted = join(root, 'input');
  writeFileSync(join(root, 'placeholder'), 'fixture');
  mkdirp(library);
  mkdirp(resources);
  mkdirp(join(extracted, 'dist', 'assets'));
  writeFileSync(join(extracted, 'dist', 'assets', 'index-test.js'), 'synthetic bundle');
  packDirInline(extracted, join(resources, 'app.asar'));
  const manifest = join(library, 'appmanifest_3789070.acf');
  writeFileSync(manifest, '"AppState" { "appid" "3789070" "name" "Fractured Realms" "installdir" "Fractured Realms" "buildid" "24185239" }');
  return { root, archive: join(resources, 'app.asar'), manifest, state: join(root, 'state') };
}

function mkdirp(path: string): void {
  mkdirSync(path, { recursive: true });
}

function deps(data = DATA) {
  return {
    extractRegistries: () => data,
  };
}

test('backup metadata uses native separators while retaining slash format', () => {
  const filename = `app.asar-${'a'.repeat(64)}.original`;
  const metadataPath = `backups/${filename}`;
  assert.equal(resolveBackupPath('C:\\state', metadataPath, win32), `C:\\state\\backups\\${filename}`);
  assert.throws(() => resolveBackupPath('C:\\state', 'backups/../outside', win32), /escapes the state directory/);
  assert.throws(() => resolveBackupPath('C:\\state', 'C:\\outside', win32), /escapes the state directory/);
  assert.throws(() => resolveBackupPath('C:\\state', `backups\\${filename}`, win32), /escapes the state directory/);
});

test('noPatch builds a stable pack and leaves the pristine ASAR untouched', () => {
  const f = fixture();
  const before = readFileSync(f.archive);
  const result = refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, noPatch: true, clock: '2026-01-02T03:04:05Z', dependencies: deps() });
  assert.equal(result.changed, false);
  assert.equal(result.buildId, '24185239');
  assert.deepEqual(readFileSync(f.archive), before);
  assert.deepEqual(readdirSync(result.packDirectory).sort(), ['data', 'engine', 'executor.js', 'overlay.js', 'pack.json']);
  assert.deepEqual(readdirSync(join(result.packDirectory, 'engine')).sort(), ['closure.js', 'expand.js', 'formulas.js', 'model.js', 'queue.js', 'simulate.js']);
  assert.equal(readFileSync(join(result.packDirectory, 'data', 'model.json'), 'utf8').endsWith('\n'), true);
  assert.equal(readFileSync(join(result.packDirectory, 'overlay.js'), 'utf8'), OVERLAY_SOURCE);
  assert.equal(readFileSync(join(result.packDirectory, 'executor.js'), 'utf8'), EXECUTOR_SOURCE);
  for (const [name, source] of [['model', ENGINE_MODEL_SOURCE], ['formulas', ENGINE_FORMULAS_SOURCE], ['closure', ENGINE_CLOSURE_SOURCE], ['expand', ENGINE_EXPAND_SOURCE], ['simulate', ENGINE_SIMULATE_SOURCE], ['queue', ENGINE_QUEUE_SOURCE]] as const) {
    assert.equal(readFileSync(join(result.packDirectory, 'engine', `${name}.js`), 'utf8'), source);
  }
  if (sqliteAvailable()) assert.equal(existsSync(join(f.state, 'model.db')), true);
});

test('pristine refresh invokes the patch manager with the expected original', () => {
  const f = fixture();
  let request: any;
  let applyOptions: any;
  const result = refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, dependencies: { ...deps(), patchManager: { patch(value: any) { request = value; return { changed: true, archivePath: f.archive, metadataPath: join(f.state, 'metadata.json') }; } }, createApply: (options: any) => { applyOptions = options; return () => undefined; } } });
  assert.equal(result.changed, true);
  assert.equal(request.expectedBuildId, '24185239');
  assert.deepEqual(request.expectedOriginal, result.original);
  assert.equal(request.archivePath, f.archive);
  assert.match(request.payloadRevision, /^[0-9a-f]{64}$/u);
  assert.equal(applyOptions.payloadRevision, request.payloadRevision);
});

test('own-marker refresh reads only a verified immutable backup as source', () => {
  const f = fixture();
  const pristine = Buffer.from('pristine archive');
  const patched = Buffer.from(`patched ${'FRACTURED_REALMS_COMPANION_V1'}`);
  writeFileSync(f.archive, patched);
  mkdirp(join(f.state, 'backups'));
  writeFileSync(join(f.root, 'placeholder'), pristine);
  const originalHash = streamFingerprint(join(f.root, 'placeholder')).sha256;
  const backup = join(f.state, 'backups', `app.asar-${originalHash}.original`);
  writeFileSync(backup, pristine);
  const originalVerified = streamFingerprint(backup);
  const originalRecord = { sha256: originalVerified.sha256, size: originalVerified.size };
  const patchedRecord = { sha256: streamFingerprint(f.archive).sha256, size: patched.length };
  writeFileSync(join(f.state, 'metadata.json'), JSON.stringify({ metadata_version: 2, profile_id: 'fractured-realms', profile_revision: 'FRACTURED_REALMS_COMPANION_V1', marker: 'FRACTURED_REALMS_COMPANION_V1', steam_build_id: '24185239', timestamp: '2026-01-01T00:00:00.000Z', original: originalRecord, patched: patchedRecord, backup: { path: `backups/app.asar-${originalRecord.sha256}.original`, ...originalRecord } }));
  const result = refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, noPatch: true, dependencies: { ...deps(), listFiles: () => ['dist/assets/index-test.js'], extractFile: () => Buffer.from('bundle') } });
  assert.deepEqual(result.original, originalRecord);
});

test('foreign bridge marker is refused with the migration instruction', () => {
  const f = fixture();
  writeFileSync(f.archive, Buffer.from('CROSSOVER_BROWSER_GAMES_FRACTURED_REALMS_V2'));
  assert.throws(() => refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, noPatch: true, dependencies: deps() }), /archive is patched by crossover-electron-bridge; run 'crossover-electron-bridge restore fractured-realms' first/);
});

test('pack publication rolls back the existing pack when the second rename fails', () => {
  const f = fixture();
  const pack = join(f.state, 'pack');
  mkdirp(pack);
  writeFileSync(join(pack, 'sentinel'), 'original');
  const originalRename = renameSync;
  let renames = 0;
  const rename = ((from: string, to: string) => {
    renames += 1;
    if (renames === 2) throw new Error('injected publish failure');
    return originalRename(from, to);
  }) as typeof renameSync;
  assert.throws(() => refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, noPatch: true, dependencies: { ...deps(), fileSystem: { renameSync: rename } } }), /could not publish companion pack transactionally/);
  assert.equal(readFileSync(join(pack, 'sentinel'), 'utf8'), 'original');
});

test('backup symlink and invalid clock fail before publication', () => {
  const f = fixture();
  const pack = join(f.state, 'pack');
  mkdirp(pack);
  writeFileSync(join(pack, 'sentinel'), 'keep');
  assert.throws(() => refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, noPatch: true, clock: 'not-a-time', dependencies: deps() }), /refresh clock did not return a UTC timestamp/);
  assert.equal(readFileSync(join(pack, 'sentinel'), 'utf8'), 'keep');

  writeFileSync(f.archive, Buffer.from('patched FRACTURED_REALMS_COMPANION_V1'));
  mkdirp(join(f.state, 'backups'));
  writeFileSync(join(f.state, 'metadata.json'), '{}');
  assert.throws(() => refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, noPatch: true, dependencies: deps() }), /state metadata has unexpected keys/);

  const original = { sha256: 'a'.repeat(64), size: 1 };
  const patched = { sha256: streamFingerprint(f.archive).sha256, size: readFileSync(f.archive).byteLength };
  const path = `backups/app.asar-${original.sha256}.original`;
  symlinkSync(join(f.root, 'placeholder'), join(f.state, path));
  writeFileSync(join(f.state, 'metadata.json'), JSON.stringify({ metadata_version: 2, profile_id: 'fractured-realms', profile_revision: 'FRACTURED_REALMS_COMPANION_V1', marker: 'FRACTURED_REALMS_COMPANION_V1', steam_build_id: '24185239', timestamp: '2026-01-01T00:00:00Z', original, patched, backup: { path, ...original } }));
  assert.throws(() => refreshCompanion({ steamRoot: f.root, platform: 'linux', stateDirectory: f.state, noPatch: true, dependencies: deps() }), /symlink/);
  assert.equal(existsSync(pack), true);
});

