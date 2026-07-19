import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationError, OperationalError } from '../../src/lib/errors.ts';
import { parseValveObject, readSteamManifest } from '../../src/lib/acf.ts';
import { readLibraryFolders } from '../../src/lib/vdf.ts';
import { atomicCopy, atomicCopyIfAbsent, atomicWriteText } from '../../src/lib/atomic.ts';

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'fractured-companion-acf-'));
}

function assertConfiguration(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof ConfigurationError);
}

test('reads a real-shaped Steam app manifest and preserves escaped values', () => {
  const directory = temporaryDirectory();
  const path = join(directory, 'appmanifest_3789070.acf');
  writeFileSync(path, `"AppState"
{
  "appid" "3789070"
  "name" "Fractured Realms"
  "installdir" "Fractured Realms"
  "buildid" "24185239"
  "nested" { "appid" "wrong" }
  "note" "unknown\\q escape"
}
`);
  assert.deepEqual(readSteamManifest(path), {
    appid: '3789070',
    name: 'Fractured Realms',
    installdir: 'Fractured Realms',
    buildid: '24185239',
  });
  assert.deepEqual(parseValveObject('"root" { "value" "unknown\\q escape" }'), {
    value: 'unknown\\q escape',
  });
});

test('distinguishes missing/read and UTF-8 failures from configuration failures', () => {
  const directory = temporaryDirectory();
  assert.throws(() => readSteamManifest(join(directory, 'missing.acf')), (error: unknown) => error instanceof OperationalError);
  const invalid = join(directory, 'invalid.acf');
  writeFileSync(invalid, Buffer.from([0xc3, 0x28]));
  assert.throws(() => readSteamManifest(invalid), (error: unknown) => error instanceof OperationalError);
  const malformed = join(directory, 'malformed.acf');
  writeFileSync(malformed, '"AppState" { "appid" "1"');
  assert.throws(() => readSteamManifest(malformed), (error: unknown) => error instanceof ConfigurationError);
});

test('rejects wrong roots, duplicate fields, empty fields, nested required fields, and malformed syntax', () => {
  const cases = [
    '"NotAppState" { "appid" "1" }',
    '"AppState" { "appid" "1" "appid" "2" }',
    '"AppState" { "nested" { "x" "1" "x" "2" } "appid" "1" "name" "n" "installdir" "d" "buildid" "b" }',
    '"AppState" { "appid" "1" "name" "n" "installdir" "d" "buildid" "" }',
    '"AppState" { "nested" { "appid" "1" } "name" "n" "installdir" "d" "buildid" "b" }',
    'AppState { "appid" "1" }',
    '"AppState" { "appid" 1 }',
    '"AppState" { "appid" "1" } trailing',
    '"AppState" { "appid" "unterminated }',
  ];
  for (const source of cases) assertConfiguration(() => readSteamManifest(writeManifest(source)));

  function writeManifest(source: string): string {
    const path = join(temporaryDirectory(), 'appmanifest.acf');
    writeFileSync(path, source);
    return path;
  }
});

test('reads library folders in numeric order and ignores empty paths', () => {
  const directory = temporaryDirectory();
  const path = join(directory, 'libraryfolders.vdf');
  writeFileSync(path, `"libraryfolders" {
  "10" { "path" "Z:\\Steam" }
  "2" { "path" "D:\\Steam" }
  "0" { "path" "" }
}`);
  assert.deepEqual(readLibraryFolders(path), ['D:\\Steam', 'Z:\\Steam']);
});

test('library folder failures fail closed', () => {
  const directory = temporaryDirectory();
  const missing = join(directory, 'missing.vdf');
  assert.deepEqual(readLibraryFolders(missing), []);
  const malformed = join(directory, 'malformed.vdf');
  writeFileSync(malformed, '"libraryfolders" { "0" { "path" "x" }');
  assert.deepEqual(readLibraryFolders(malformed), []);
  const wrongShape = join(directory, 'wrong.vdf');
  writeFileSync(wrongShape, '"libraryfolders" { "0" "not-an-object" }');
  assert.deepEqual(readLibraryFolders(wrongShape), []);
  const invalidUtf8 = join(directory, 'invalid.vdf');
  writeFileSync(invalidUtf8, Buffer.from([0xff]));
  assert.deepEqual(readLibraryFolders(invalidUtf8), []);
});

test('atomically writes and replaces UTF-8 text with requested mode', () => {
  const directory = temporaryDirectory();
  const path = join(directory, 'state.json');
  atomicWriteText(path, 'first ✓');
  assert.equal(readFileSync(path, 'utf8'), 'first ✓');
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  atomicWriteText(path, 'second', 0o640);
  assert.equal(readFileSync(path, 'utf8'), 'second');
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o640);
});

test('atomically copies with source metadata and replaces destination', () => {
  const directory = temporaryDirectory();
  const source = join(directory, 'source');
  const destination = join(directory, 'destination');
  writeFileSync(source, 'source bytes');
  chmodSync(source, 0o440);
  const timestamp = new Date(1_700_000_000_000);
  utimesSync(source, timestamp, timestamp);
  writeFileSync(destination, 'old bytes');
  atomicCopy(source, destination);
  assert.equal(readFileSync(destination, 'utf8'), 'source bytes');
  if (process.platform !== 'win32') {
    assert.equal(statSync(destination).mode & 0o777, statSync(source).mode & 0o777);
    assert.equal(Math.round(statSync(destination).mtimeMs), Math.round(statSync(source).mtimeMs));
  }
});

test('copy-if-absent uses no-overwrite hard-link publication', () => {
  const directory = temporaryDirectory();
  const source = join(directory, 'source');
  const destination = join(directory, 'destination');
  writeFileSync(source, 'immutable');
  assert.equal(atomicCopyIfAbsent(source, destination), true);
  assert.equal(readFileSync(destination, 'utf8'), 'immutable');
  assert.equal(atomicCopyIfAbsent(source, destination), false);
  writeFileSync(source, 'changed');
  assert.equal(readFileSync(destination, 'utf8'), 'immutable');
});

test('cleans same-directory temporary files after a forced failure', () => {
  const directory = temporaryDirectory();
  const source = join(directory, 'source');
  const destinationDirectory = join(directory, 'missing');
  writeFileSync(source, 'source');
  assert.throws(() => atomicCopy(source, join(destinationDirectory, 'destination')));
  assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith('.tmp')), []);
  assert.throws(() => atomicWriteText(join(directory, 'missing', 'state'), 'text'));
  assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith('.tmp')), []);
});
