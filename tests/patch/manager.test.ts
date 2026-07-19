import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicCopy, atomicWriteText } from '../../src/lib/atomic.ts';
import { MARKER, FOREIGN_MARKER_PREFIX, PatchManager, type PatchRequest } from '../../src/patch/manager.ts';
import { streamFingerprint } from '../../src/patch/fingerprint.ts';

const original = Buffer.from('small pristine archive fixture\n');
const digest = createHash('sha256').update(original).digest('hex');
const manifestText = '"AppState"\n{\n"appid" "3789070"\n"name" "Fractured Realms"\n"installdir" "Fractured Realms"\n"buildid" "build-1"\n}\n';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

function fixture(payloadRevision = REVISION_A) {
  const root = mkdtempSync(join(tmpdir(), 'fr-companion-manager-test-'));
  const archive = join(root, 'app.asar'); const manifest = join(root, 'appmanifest.acf'); const state = join(root, 'state');
  writeFileSync(archive, original); writeFileSync(manifest, manifestText);
  const request: PatchRequest = { archivePath: archive, manifestPath: manifest, stateDirectory: state, expectedBuildId: 'build-1', expectedOriginal: { sha256: digest, size: original.length }, payloadRevision, apply: () => {} };
  const operations = {
    extractAll(source: string, destination: string) { mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, 'entry.js'), readFileSync(source)); return []; },
    packDirInline(source: string, destination: string) { writeFileSync(destination, Buffer.concat([readFileSync(join(source, 'entry.js')), Buffer.from(MARKER)])); },
  };
  return { root, archive, manifest, state, request, operations };
}

function manager(f: ReturnType<typeof fixture>, options: ConstructorParameters<typeof PatchManager>[0] = {}) {
  return new PatchManager({ clock: '2026-01-02T03:04:05Z', operations: { ...f.operations, ...options.operations }, ...options });
}

function backupPath(f: ReturnType<typeof fixture>) { return join(f.state, 'backups', `app.asar-${digest}.original`); }

test('patch writes v3 metadata and immutable recovery backup', () => {
  const f = fixture();
  const result = manager(f).patch(f.request);
  assert.equal(result.changed, true); assert.equal(result.archivePath, f.archive); assert.equal(result.metadataPath, join(f.state, 'metadata.json'));
  const metadata = JSON.parse(readFileSync(result.metadataPath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(metadata).sort(), ['backup', 'marker', 'metadata_version', 'original', 'patched', 'payload_revision', 'profile_id', 'profile_revision', 'steam_build_id', 'timestamp'].sort());
  assert.equal(metadata.metadata_version, 3); assert.equal(metadata.payload_revision, REVISION_A); assert.equal(metadata.profile_id, 'fractured-realms'); assert.equal(metadata.marker, MARKER);
  assert.deepEqual(readFileSync(backupPath(f)), original); assert.equal(streamFingerprint(f.archive, MARKER).markerFound, true);
});

test('patch is idempotent after re-verifying metadata, backup, build, and live bytes', () => {
  const f = fixture(); const first = manager(f).patch(f.request); const before = readFileSync(f.archive);
  const second = manager(f).patch(f.request);
  assert.equal(second.changed, false); assert.deepEqual(readFileSync(f.archive), before); assert.equal(first.metadataPath, second.metadataPath);
});

test('different payload revision repacks from immutable backup and upgrades metadata', () => {
  const f = fixture(REVISION_A);
  manager(f).patch(f.request);
  const backupBefore = readFileSync(backupPath(f));
  const next = { ...f.request, payloadRevision: REVISION_B };
  const result = manager(f).patch(next);
  assert.equal(result.changed, true);
  assert.deepEqual(readFileSync(f.archive), Buffer.concat([original, Buffer.from(MARKER)]));
  const metadata = JSON.parse(readFileSync(result.metadataPath, 'utf8')) as Record<string, unknown>;
  assert.equal(metadata.metadata_version, 3);
  assert.equal(metadata.payload_revision, REVISION_B);
  assert.deepEqual(readFileSync(backupPath(f)), backupBefore);
});

test('legacy v2 metadata is repatched and upgraded to v3', () => {
  const f = fixture(REVISION_A);
  const first = manager(f).patch(f.request);
  const metadata = JSON.parse(readFileSync(first.metadataPath, 'utf8')) as Record<string, unknown>;
  delete metadata.payload_revision;
  metadata.metadata_version = 2;
  writeFileSync(first.metadataPath, JSON.stringify(metadata));
  const result = manager(f).patch({ ...f.request, payloadRevision: REVISION_B });
  assert.equal(result.changed, true);
  const upgraded = JSON.parse(readFileSync(result.metadataPath, 'utf8')) as Record<string, unknown>;
  assert.equal(upgraded.metadata_version, 3);
  assert.equal(upgraded.payload_revision, REVISION_B);
});

test('repatch metadata commit failure restores the previous patched archive and metadata', () => {
  const f = fixture(REVISION_A);
  const first = manager(f).patch(f.request);
  const archiveBefore = readFileSync(f.archive);
  const metadataBefore = readFileSync(first.metadataPath);
  let replaced = false;
  const pm = new PatchManager({
    clock: '2026-01-02T03:04:05Z',
    hook: { after_replace: () => { replaced = true; } },
    operations: {
      ...f.operations,
      atomicWriteText: () => { assert.equal(replaced, true); throw new Error('device full'); },
    },
  });
  assert.throws(() => pm.patch({ ...f.request, payloadRevision: REVISION_B }), /verified previous patch restored/);
  assert.deepEqual(readFileSync(f.archive), archiveBefore);
  assert.deepEqual(readFileSync(first.metadataPath), metadataBefore);
});
test('foreign bridge marker fails with the migration instruction', () => {
  const f = fixture(); writeFileSync(f.archive, Buffer.concat([original, Buffer.from(FOREIGN_MARKER_PREFIX)]));
  assert.throws(() => manager(f).patch(f.request), /archive is patched by crossover-electron-bridge; run 'crossover-electron-bridge restore fractured-realms' first/);
});

test('unknown pristine bytes are refused without an archive replacement', () => {
  const f = fixture(); const changed = Buffer.from('unknown build bytes'); writeFileSync(f.archive, changed);
  assert.throws(() => manager(f).patch(f.request), /Unsupported Steam build/); assert.deepEqual(readFileSync(f.archive), changed);
});

test('clock failure happens before replacement or backup creation', () => {
  const f = fixture(); const before = readFileSync(f.archive);
  const pm = new PatchManager({ clock: () => { throw new Error('clock unavailable'); }, operations: f.operations });
  assert.throws(() => pm.patch(f.request), /patch clock did not return/); assert.deepEqual(readFileSync(f.archive), before); assert.equal(streamFingerprint(f.archive, MARKER).markerFound, false);
});

test('metadata commit failure rolls back while retaining the immutable backup', () => {
  const f = fixture(); let replaced = false;
  const pm = new PatchManager({ clock: '2026-01-02T03:04:05Z', hook: { after_replace: () => { replaced = true; } }, operations: { ...f.operations, atomicWriteText: (_path: string, _text: string) => { assert.equal(replaced, true); throw new Error('device full'); } } });
  assert.throws(() => pm.patch(f.request), /verified original restored/); assert.deepEqual(readFileSync(f.archive), original); assert.deepEqual(readFileSync(backupPath(f)), original);
});

test('before-replace concurrent archive mutation is never overwritten', () => {
  const f = fixture(); const changed = Buffer.from('third party bytes');
  const pm = new PatchManager({ hook: { before_replace: () => writeFileSync(f.archive, changed) }, operations: f.operations });
  assert.throws(() => pm.patch(f.request), /changed while preparing/); assert.deepEqual(readFileSync(f.archive), changed);
});

test('restore verifies backup and retains metadata and backup', () => {
  const f = fixture(); const pm = manager(f); const patched = pm.patch(f.request); pm.restore(f.request);
  assert.deepEqual(readFileSync(f.archive), original); assert.deepEqual(readFileSync(patched.metadataPath).length > 0, true); assert.deepEqual(readFileSync(backupPath(f)), original);
});

test('restore preflight mutation refuses replacement', () => {
  const f = fixture(); const pm = manager(f); pm.patch(f.request); const changed = Buffer.from('concurrent restore bytes');
  const restore = new PatchManager({ hook: { before_restore_replace: () => writeFileSync(f.archive, changed) } });
  assert.throws(() => restore.restore(f.request), /changed during restore preflight/); assert.deepEqual(readFileSync(f.archive), changed);
});

test('restore rejects a mutated immutable backup', () => {
  const f = fixture(); const pm = manager(f); pm.patch(f.request); writeFileSync(backupPath(f), Buffer.from('mutated backup'));
  assert.throws(() => pm.restore(f.request), /backup/); assert.equal(streamFingerprint(f.archive, MARKER).markerFound, true);
});
