import fs from 'node:fs';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { extractAll, extractFile, listFiles, packDirInline, readHeader } from '../../src/lib/asar.ts';

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'fractured-asar-'));
}

function frame(header: unknown, data = Buffer.alloc(0)): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = 4 + ((json.length + 3) & ~3);
  const headerLength = 4 + padded;
  const result = Buffer.alloc(8 + headerLength + data.length);
  result.writeUInt32LE(4, 0);
  result.writeUInt32LE(headerLength, 4);
  result.writeUInt32LE(padded, 8);
  result.writeUInt32LE(json.length, 12);
  json.copy(result, 16);
  data.copy(result, 8 + headerLength);
  return result;
}

test('packs deterministic nested binary and text trees and extracts them', () => {
  const root = temporaryDirectory();
  try {
    const source = join(root, 'source');
    mkdirSync(join(source, 'nested', 'empty'), { recursive: true });
    writeFileSync(join(source, 'text.txt'), 'hello ASAR\n');
    writeFileSync(join(source, 'binary.bin'), Buffer.from([0, 1, 255, 2]));
    writeFileSync(join(source, 'nested', 'deep.txt'), 'deep');
    const first = join(root, 'one.asar');
    const second = join(root, 'two.asar');
    packDirInline(source, first);
    packDirInline(source, second);
    assert.deepEqual(readFileSync(first), readFileSync(second));
    assert.deepEqual(listFiles(first), ['binary.bin', 'nested/deep.txt', 'text.txt']);
    assert.deepEqual(extractFile(first, 'binary.bin'), Buffer.from([0, 1, 255, 2]));
    const destination = join(root, 'out');
    const skipped = extractAll(first, destination);
    assert.deepEqual(skipped, []);
    assert.equal(readFileSync(join(destination, 'nested/deep.txt'), 'utf8'), 'deep');
    assert.equal(readFileSync(join(destination, 'text.txt'), 'utf8'), 'hello ASAR\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('minimal empty archive has official 28-byte data start', () => {
  const root = temporaryDirectory();
  try {
    const archive = join(root, 'empty.asar');
    const source = join(root, 'source');
    mkdirSync(source);
    packDirInline(source, archive);
    const bytes = readFileSync(archive);
    assert.equal(bytes.readUInt32LE(0), 4);
    assert.equal(bytes.readUInt32LE(4), 20);
    assert.equal(bytes.length, 28);
    assert.deepEqual(readHeader(archive), { files: {} });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed framing, paths, nodes, and bounds', () => {
  const root = temporaryDirectory();
  try {
    const cases: Buffer[] = [];
    const valid = frame({ files: { file: { size: 0, offset: '0' } } });
    const badOuter = Buffer.from(valid);
    badOuter.writeUInt32LE(3, 0);
    cases.push(badOuter);
    const badPadding = frame({ files: {} });
    badPadding[badPadding.length - 1] = 1;
    cases.push(badPadding);
    cases.push(frame({ files: { '../escape': { size: 0, offset: '0' } } }));
    cases.push(frame({ files: { file: { size: -1, offset: '0' } } }));
    cases.push(frame({ files: { file: { size: 1, offset: '0' } } }));
    cases.push(frame({ files: { file: { size: 0, offset: '01' } } }));
    for (const [index, bytes] of cases.entries()) {
      const archive = join(root, `bad-${index}.asar`);
      writeFileSync(archive, bytes);
      assert.throws(() => readHeader(archive));
    }
    assert.throws(() => extractFile(join(root, 'bad-0.asar'), '../escape'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports official unpacked directory and file metadata', () => {
  const root = temporaryDirectory();
  try {
    const unpacked = join(root, 'unpacked.asar');
    const header = {
      files: {
        external: {
          files: {
            payload: {
              size: 9,
              unpacked: true,
              executable: false,
              integrity: { algorithm: 'SHA256', hash: 'deadbeef' },
            },
          },
          unpacked: true,
        },
      },
    };
    writeFileSync(unpacked, frame(header));
    assert.deepEqual(readHeader(unpacked), header);
    assert.deepEqual(listFiles(unpacked), ['external/payload']);
    const skipped: string[] = [];
    assert.deepEqual(
      extractAll(unpacked, join(root, 'out'), (path) => skipped.push(path)),
      ['external/payload'],
    );
    assert.deepEqual(skipped, ['external/payload']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('extractFile opens one archive descriptor and reads through it', () => {
  const root = temporaryDirectory();
  try {
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'payload.txt'), 'one descriptor');
    const archive = join(root, 'archive.asar');
    packDirInline(source, archive);

    const originalOpenSync = fs.openSync;
    let archiveOpens = 0;
    fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
      if (String(args[0]) === archive) archiveOpens += 1;
      return originalOpenSync(...args);
    }) as typeof fs.openSync;
    try {
      assert.equal(extractFile(archive, 'payload.txt').toString('utf8'), 'one descriptor');
    } finally {
      fs.openSync = originalOpenSync;
    }
    assert.equal(archiveOpens, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports unpacked entries and rejects links during extraction', () => {
  const root = temporaryDirectory();
  try {
    const unpacked = join(root, 'unpacked.asar');
    writeFileSync(unpacked, frame({ files: { external: { size: 9, unpacked: true } } }));
    const skipped: string[] = [];
    assert.deepEqual(extractAll(unpacked, join(root, 'out'), (path) => skipped.push(path)), ['external']);
    assert.deepEqual(skipped, ['external']);
    const link = join(root, 'link.asar');
    writeFileSync(link, frame({ files: { alias: { link: 'target' } } }));
    assert.deepEqual(listFiles(link), ['alias']);
    assert.throws(() => extractAll(link, join(root, 'link-out')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects symlink source trees without creating destination', (t) => {
  const root = temporaryDirectory();
  try {
    const source = join(root, 'source');
    const outside = join(root, 'outside');
    mkdirSync(source);
    mkdirSync(outside);
    symlinkSync(outside, join(source, 'link'));
    const destination = join(root, 'output.asar');
    assert.throws(() => packDirInline(source, destination));
    assert.equal(false, (() => { try { readFileSync(destination); return true; } catch { return false; } })());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES') {
      t.skip('symlinks unavailable');
    } else throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cross-checks electron asar only when explicitly enabled', { skip: process.env.ASAR_CROSSCHECK !== '1' }, () => {
  const root = temporaryDirectory();
  try {
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'file.txt'), 'cross-check');
    const archive = join(root, 'cross.asar');
    packDirInline(source, archive);
    const result = spawnSync('npx', ['--yes', '@electron/asar', 'list', archive], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /file\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
