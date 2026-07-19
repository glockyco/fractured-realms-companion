import { strict as assert } from 'node:assert';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { main, isEntryPoint } from '../src/cli.ts';
import { restoreCompanion } from '../src/restore.ts';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) };
}

const install = {
  steamRoot: '/steam', steamExe: '/steam/Steam.exe', manifestPath: '/steam/appmanifest.acf',
  installDir: '/steam/common/Fractured Realms', platform: 'linux' as const,
};

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
  assert.match(output.out.join(''), /0\.1\.0/);
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
