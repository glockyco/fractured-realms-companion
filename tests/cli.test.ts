import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { main, isEntryPoint } from '../src/cli.ts';
import { restoreCompanion } from '../src/restore.ts';
import { openDatabase } from '../src/lib/sqlite.ts';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) };
}

function modelPack(state: string): void {
  const pack = join(state, 'pack');
  mkdirSync(join(pack, 'data'), { recursive: true });
  writeFileSync(join(pack, 'pack.json'), JSON.stringify({ schema_version: 2, build_id: 'build-model', generated_at: '2026-01-01T00:00:00.000Z' }));
  writeFileSync(join(pack, 'data', 'model.json'), JSON.stringify({
    schema_version: 1,
    build_id: 'build-model',
    actions: [{ id: 'chop', skillId: 'woodcutting' }],
    items: [{ id: 'log' }],
    skills: [{ id: 'woodcutting' }],
    maps: [{ id: 'millhaven' }],
    zones: [{ id: 'thornwood' }],
    stringsEn: { 'name.log': 'Log' },
  }));
}

const install = {
  steamRoot: '/steam', steamExe: '/steam/Steam.exe', manifestPath: '/steam/appmanifest.acf',
  installDir: '/steam/common/Fractured Realms', platform: 'linux' as const,
};

test('model info prints metadata, registry counts, and artifact paths', async () => {
  const state = mkdtempSync(join(tmpdir(), 'fractured-cli-model-'));
  modelPack(state);
  const output = io();
  assert.equal(await main(['model', 'info'], { ...output, stateDirectory: state }), 0);
  const text = output.out.join('');
  assert.match(text, /build_id: build-model/);
  assert.match(text, /schema_version: 1/);
  assert.match(text, /actions: 1/);
  assert.match(text, /items: 1/);
  assert.match(text, /skills: 1/);
  assert.match(text, /maps: 1/);
  assert.match(text, /zones: 1/);
  assert.match(text, /model\.json: .*exists: true/);
  assert.match(text, /model\.db: .*exists: false/);
});

test('model info without a published model returns a refresh hint', async () => {
  const state = mkdtempSync(join(tmpdir(), 'fractured-cli-model-'));
  const output = io();
  assert.equal(await main(['model', 'info'], { ...output, stateDirectory: state }), 1);
  assert.match(output.err.join(''), /model unavailable.*run refresh/);
});

test('model sql prints SELECT rows as JSON lines', async () => {
  const state = mkdtempSync(join(tmpdir(), 'fractured-cli-model-'));
  const database = openDatabase(join(state, 'model.db'));
  assert.ok(database);
  database.exec('CREATE TABLE items (id TEXT, value INTEGER)');
  database.run('INSERT INTO items (id, value) VALUES (?, ?)', 'log', 7);
  database.close();
  const output = io();
  assert.equal(await main(['model', 'sql', 'SELECT id, value FROM items'], { ...output, stateDirectory: state }), 0);
  assert.deepEqual(output.out.join('').trim().split('\n').map((line) => JSON.parse(line)), [{ id: 'log', value: 7 }]);
});

test('model sql rejects writes and reports missing databases', async () => {
  const state = mkdtempSync(join(tmpdir(), 'fractured-cli-model-'));
  const rejectOutput = io();
  assert.equal(await main(['model', 'sql', 'INSERT INTO items VALUES (1)'], { ...rejectOutput, stateDirectory: state }), 1);
  assert.equal(rejectOutput.err.join(''), 'model sql accepts SELECT statements only\n');
  const missingOutput = io();
  assert.equal(await main(['model', 'sql', 'SELECT 1'], { ...missingOutput, stateDirectory: state }), 1);
  assert.equal(missingOutput.err.join(''), 'model.db unavailable (run refresh; requires node:sqlite or bun)\n');
});

test('dispatches every command and forwards global/command options', async () => {
  const seen: Record<string, unknown> = {};
  const output = io();
  const deps = {
    ...output,
    runDoctor: async (options: any) => { seen.doctor = options; return { rows: [{ status: 'PASS', check: 'x', message: 'ok' }], blocking: false }; },
    refreshCompanion: async (options: any) => { seen.refresh = options; return { buildId: 'b', changed: true }; },
    restoreCompanion: async (options: any) => { seen.restore = options; return { archivePath: '/a', buildId: 'b', stateDirectory: '/s' }; },
    launchCompanion: async (options: any) => { seen.launch = options; return { url: 'http://127.0.0.1:48766/', command: 'steam', args: [] }; },
    relaunchCompanion: async (options: any) => { seen.relaunch = options; return { url: 'http://127.0.0.1:48766/', command: 'steam', args: [] }; },
  };
  assert.equal(await main(['doctor', '--steam-root', '/root', '--bottle', 'B', '--json'], deps), 0);
  assert.deepEqual(seen.doctor, { steamRoot: '/root', bottle: 'B' });
  assert.match(output.out.join(''), /\[.*PASS/);
  assert.equal(await main(['refresh', '--steam-root', '/root', '--no-patch'], deps), 0);
  assert.deepEqual(seen.refresh, { steamRoot: '/root', noPatch: true });
  assert.equal(await main(['restore', '--bottle', 'B'], deps), 0);
  assert.deepEqual(seen.restore, { bottle: 'B' });
  assert.equal(await main(['launch', '--steam-root', '/root', '--no-open'], deps), 0);
  assert.deepEqual(seen.launch, { steamRoot: '/root', noOpen: true });
  assert.equal(await main(['relaunch', '--steam-root', '/root', '--no-open'], deps), 0);
  assert.deepEqual(seen.relaunch, { steamRoot: '/root', noOpen: true });
});

test('npm bin symlink is recognized as the CLI entrypoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fractured-cli-'));
  const link = join(dir, 'fractured-companion');
  const target = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  symlinkSync(target, link);
  assert.equal(isEntryPoint(link), true);
});

test('help and version are successful without dispatch', async () => {
  const output = io();
  let calls = 0;
  const deps = { ...output, runDoctor: async () => { calls += 1; return { rows: [], blocking: false }; } };
  assert.equal(await main(['--help'], deps), 0);
  assert.match(output.out.join(''), /Usage: fractured-companion/);
  assert.equal(await main(['--version'], deps), 0);
  assert.match(output.out.join(''), /0\.2\.0/);
  assert.equal(calls, 0);
});

test('unknown, misplaced, and duplicate options return usage code 2', async () => {
  for (const argv of [['nope'], ['doctor', '--wat'], ['--no-open', 'launch'], ['doctor', '--json', '--json']]) {
    const output = io();
    assert.equal(await main(argv, output), 2);
    assert.match(output.err.join(''), /Usage:/);
  }
});

test('doctor blocking emits rows and returns one, with JSON mode', async () => {
  const output = io();
  const result = await main(['doctor', '--json'], {
    ...output,
    runDoctor: async () => ({ rows: [{ status: 'FAIL', check: 'archive', message: 'bad' }], blocking: true }),
  });
  assert.equal(result, 1);
  assert.deepEqual(JSON.parse(output.out.join('')), [{ status: 'FAIL', check: 'archive', message: 'bad' }]);
});

test('operational failures redact stacks and return one', async () => {
  const output = io();
  const result = await main(['restore'], { ...output, restoreCompanion: async () => { throw new Error('cannot restore'); } });
  assert.equal(result, 1);
  assert.equal(output.err.join(''), 'cannot restore\n');
  assert.doesNotMatch(output.err.join(''), /Error:|at /);
});

test('restore extracts only strict build and original expectation before manager restore', () => {
  const state = mkdtempSync(join(tmpdir(), 'fractured-cli-'));
  const original = { sha256: 'A'.repeat(64), size: 123 };
  writeFileSync(join(state, 'metadata.json'), JSON.stringify({ steam_build_id: '24185239', original }));
  let request: any;
  const result = restoreCompanion({
    stateDirectory: state,
    discoverInstall: () => install,
    readManifest: () => ({ appid: '3789070', name: 'Fractured Realms', installdir: 'Fractured Realms', buildid: '24185239' }),
    patchManager: { restore(value: any) { request = value; } },
  });
  assert.deepEqual(request.expectedOriginal, { sha256: original.sha256.toLowerCase(), size: 123 });
  assert.equal(request.expectedBuildId, '24185239');
  assert.deepEqual(result, { install, archivePath: join(install.installDir, 'resources', 'app.asar'), buildId: '24185239', stateDirectory: state });
});

test('restore rejects non-exact original records before manager invocation', () => {
  const state = mkdtempSync(join(tmpdir(), 'fractured-cli-'));
  writeFileSync(join(state, 'metadata.json'), JSON.stringify({ steam_build_id: '24185239', original: { sha256: 'a'.repeat(64), size: 1, extra: true } }));
  let called = false;
  assert.throws(() => restoreCompanion({ stateDirectory: state, discoverInstall: () => install, readManifest: () => ({ appid: '3789070', name: 'x', installdir: 'x', buildid: '1' }), patchManager: { restore() { called = true; } } }), /invalid original archive record/);
  assert.equal(called, false);
});
