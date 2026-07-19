import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationError, OperationalError } from '../../src/lib/errors.ts';
import { FOREIGN_MARKER_PREFIX, MARKER, streamFingerprint } from '../../src/patch/fingerprint.ts';

function temporaryFile(bytes: Uint8Array | string): string {
  const directory = mkdtempSync(join(tmpdir(), 'fractured-companion-fingerprint-'));
  const path = join(directory, 'archive.asar');
  writeFileSync(path, bytes);
  return path;
}

test('returns the known SHA-256 and byte size', () => {
  const path = temporaryFile('hello\n');
  assert.deepEqual(streamFingerprint(path), {
    sha256: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03',
    size: 6,
    markerFound: false,
  });
});

test('reports no marker when no marker is requested or present', () => {
  const path = temporaryFile('an unmarked archive');
  assert.equal(streamFingerprint(path).markerFound, false);
  assert.equal(streamFingerprint(path, FOREIGN_MARKER_PREFIX).markerFound, false);
});

test('finds a marker contained in one chunk', () => {
  const path = temporaryFile(`prefix-${MARKER}-suffix`);
  assert.equal(streamFingerprint(path, MARKER).markerFound, true);
});

test('finds a marker straddling the 1 MiB chunk boundary', () => {
  const marker = 'BOUNDARY_MARKER';
  const prefix = Buffer.alloc(1024 * 1024 - 4, 0x61);
  const path = temporaryFile(Buffer.concat([prefix, Buffer.from(marker.slice(0, 4)), Buffer.from(marker.slice(4)), Buffer.from('-tail')]));
  assert.equal(streamFingerprint(path, marker).markerFound, true);
});

test('finds a marker longer than one chunk', () => {
  const marker = 'long-marker-'.repeat(Math.ceil((1024 * 1024 + 17) / 12));
  const path = temporaryFile(Buffer.concat([Buffer.from('before'), Buffer.from(marker), Buffer.from('after')]));
  assert.equal(marker.length > 1024 * 1024, true);
  assert.equal(streamFingerprint(path, marker).markerFound, true);
});

test('accepts Uint8Array markers without mutating caller bytes', () => {
  const marker = new Uint8Array(Buffer.from('byte-marker'));
  const before = new Uint8Array(marker);
  const path = temporaryFile('prefix-byte-marker-suffix');
  assert.equal(streamFingerprint(path, marker).markerFound, true);
  assert.deepEqual(marker, before);
});

test('rejects empty markers as configuration errors', () => {
  const path = temporaryFile('archive');
  assert.throws(() => streamFingerprint(path, ''), (error: unknown) => error instanceof ConfigurationError);
  assert.throws(() => streamFingerprint(path, new Uint8Array()), (error: unknown) => error instanceof ConfigurationError);
});

test('reports missing files as operational errors naming the path', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fractured-companion-fingerprint-')), 'missing.asar');
  assert.throws(() => streamFingerprint(path), (error: unknown) => {
    return error instanceof OperationalError && error.message.includes(path);
  });
});
