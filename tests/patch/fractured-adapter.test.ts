import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { FRACTURED_MARKER, createFracturedApply } from '../../src/patch/fracturedAdapter.ts';
import {
  ELECTRON_HOST_SOURCE,
  ENGINE_CLOSURE_SOURCE,
  ENGINE_EXPAND_SOURCE,
  ENGINE_FORMULAS_SOURCE,
  ENGINE_MODEL_SOURCE,
  ENGINE_QUEUE_SOURCE,
  ENGINE_SIMULATE_SOURCE,
  EXECUTOR_SOURCE,
  FRACTURED_ADAPTER_SOURCE,
  OVERLAY_SOURCE,
} from '../../src/generated/embedded.ts';

const fixture = join(process.cwd(), 'tests/fixtures/fractured-realms/electron');
const payloadRevision = 'c'.repeat(64);
const dataNames = ['model'];
const engineSources = { model: ENGINE_MODEL_SOURCE, formulas: ENGINE_FORMULAS_SOURCE, closure: ENGINE_CLOSURE_SOURCE, expand: ENGINE_EXPAND_SOURCE, simulate: ENGINE_SIMULATE_SOURCE, queue: ENGINE_QUEUE_SOURCE };
const { handleApi } = createRequire(import.meta.url)(join(process.cwd(), 'runtime/fractured-adapter.cjs')) as { handleApi: (request: Record<string, unknown>) => Promise<{ status: number; body: unknown }> };

function snapshot(root: string): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  const walk = (path: string): void => {
    for (const name of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.isFile()) result.set(relative(root, full), readFileSync(full));
    }
  };
  walk(root);
  return result;
}

function createCase(buildId = '24185239'): { root: string; pack: string } {
  const work = mkdtempSync(join(tmpdir(), 'fractured-adapter-test-'));
  const root = join(work, 'app');
  mkdirSync(join(root, 'electron'), { recursive: true });
  mkdirSync(join(root, 'dist/assets'), { recursive: true });
  cpSync(join(fixture, 'main.cjs'), join(root, 'electron/main.cjs'));
  cpSync(join(fixture, 'preload.cjs'), join(root, 'electron/preload.cjs'));
  cpSync(join(fixture, 'dist/assets/index-test1234.js'), join(root, 'dist/assets/index-test1234.js'));
  mkdirSync(join(root, 'node_modules/steamworks.js/dist/win64'), { recursive: true });
  writeFileSync(join(root, 'node_modules/steamworks.js/index.js'), 'fixture');
  writeFileSync(join(root, 'node_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node'), 'node');
  writeFileSync(join(root, 'node_modules/steamworks.js/dist/win64/steam_api64.dll'), 'dll');
  const pack = join(work, 'pack');
  mkdirSync(join(pack, 'data'), { recursive: true });
  mkdirSync(join(pack, 'engine'), { recursive: true });
  writeFileSync(join(pack, 'pack.json'), JSON.stringify({ schema_version: 2, build_id: buildId, generated_at: '2026-07-19T00:00:00Z' }));
  writeFileSync(join(pack, 'overlay.js'), OVERLAY_SOURCE);
  writeFileSync(join(pack, 'executor.js'), EXECUTOR_SOURCE);
  for (const [name, source] of Object.entries(engineSources)) writeFileSync(join(pack, `engine/${name}.js`), source);
  for (const name of dataNames) writeFileSync(join(pack, `data/${name}.json`), '{}');
  return { root, pack };
}

function apply(root: string, pack: string): void {
  createFracturedApply({ buildId: '24185239', packDirectory: pack, payloadRevision })(root);
}

const harness = String.raw`const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const entry = process.argv[2];
const browser = process.argv[3] === 'browser';
const noOpen = process.argv[4] === 'no-open';
const mode = noOpen ? (process.argv[5] || 'client') : (process.argv[4] || 'client');
const silent = { log() {}, error() {}, warn() {} };
global.console = silent;
const events = [];
const handlers = new Map();
const appHandlers = new Map();
const windows = [];
const app = { whenReady() { return { then(fn) { return Promise.resolve(fn()); } }; }, getPath(name) { if (name !== 'userData') throw new Error(name); return path.join(path.dirname(entry), 'user-data'); }, on(name, fn) { appHandlers.set(name, fn); }, quit() { events.push('quit'); } };
function BrowserWindow() { events.push('createWindow'); windows.push(this); this.webContents = {}; this.loadFile = () => {}; this.on = () => {}; }
BrowserWindow.getAllWindows = () => windows;
BrowserWindow.fromWebContents = () => null;
const ipcMain = { handle(name, fn) { handlers.set(name, fn); } };
const shell = { openExternal: async () => ({}) };
const client = { achievement: { activate() { if (mode === 'throw') throw new Error('activation failed'); return 7; } } };
const steamworks = { init() { events.push('initSteam'); return mode === 'none' ? null : client; } };
const host = { start(config) { events.push('hostStart'); global.hostConfig = config; } };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return { app, BrowserWindow, ipcMain, shell };
  const normalizedRequest = request.split(path.sep).join('/');
  if (request === 'steamworks.js' || normalizedRequest.includes('companion-steamworks-0.4.0-v1/index.js')) return steamworks;
  if (request === './companion-host.cjs') return host;
  if (request === './companion-adapter.cjs') return {};
  return originalLoad.call(this, request, parent, isMain);
};
process.argv = ['node', entry].concat(browser ? ['--companion-browser'] : []).concat(noOpen ? ['--companion-no-open'] : []);
require(entry);
setImmediate(() => {
  const call = handlers.get('steam:unlock');
  const result = { events, browser: Boolean(global.hostConfig), openBrowser: global.hostConfig ? global.hostConfig.openBrowser : null, success: call && mode === 'client' ? call(null, 'ACH_TEST') : null, bad: call && mode === 'client' ? call(null, null) : null, noClient: call && mode === 'none' ? call(null, 'ACH_TEST') : null, caught: call && mode === 'throw' ? call(null, 'ACH_TEST') : null, cached: fs.existsSync(path.join(path.dirname(entry), 'user-data/companion-steamworks-0.4.0-v1/dist/win64/steam_api64.dll')) };
  if (global.hostConfig) { result.service = global.hostConfig.services.steamUnlock('ACH_TEST'); global.hostConfig.services.quitApp(); }
  if (!browser && appHandlers.has('activate')) { windows.length = 0; appHandlers.get('activate')(); result.activated = events.filter((x) => x === 'createWindow').length === 2; }
  process.stdout.write(JSON.stringify(result));
});`;

test('installs exact runtime profile, pack and companion bundle API', () => {
  const { root, pack } = createCase();
  const bundlePath = join(root, 'dist/assets/index-test1234.js');
  const bundleSource = readFileSync(bundlePath, 'utf8');
  writeFileSync(bundlePath, bundleSource
    .replace('const Xe={update(fn){return fn(this);},subscribe(fn){return fn;}};', 'const Xe=store;')
    .replace('function tr(value){return value;}', 'function tr(value){return window.fixtureGet(value);}')
    .replace('function Er(){}', 'function Er(){return window.fixtureStop();}')
    .replace('function Ii(a,t){', 'function Ii(a,t){window.fixtureStart(a,t);'));
  apply(root, pack);
  const profile = JSON.parse(readFileSync(join(root, 'electron/companion-profile.json'), 'utf8'));
  assert.deepEqual(profile, { schema_version: 1, id: 'fractured-realms', display_name: 'Fractured Realms', service: FRACTURED_MARKER, assets_relative_to_runtime: '../dist', bind_host: '127.0.0.1', browser_host: '127.0.0.1', port: 48766, max_request_bytes: 65536, companion: true, revision: payloadRevision });
  assert.equal(readFileSync(join(root, 'electron/companion-host.cjs'), 'utf8'), ELECTRON_HOST_SOURCE);
  assert.equal(readFileSync(join(root, 'electron/companion-adapter.cjs'), 'utf8'), FRACTURED_ADAPTER_SOURCE);
  assert.equal(readFileSync(bundlePath, 'utf8').match(/__frCompanion/g)?.length, 1);
  assert.equal(readFileSync(join(root, 'dist/companion/data/model.json'), 'utf8'), '{}');
  assert.deepEqual(readdirSync(join(root, 'dist/companion')).sort(), ['data', 'engine', 'executor.js', 'overlay.js', 'pack.json']);
  assert.equal(readFileSync(join(root, 'dist/companion/overlay.js'), 'utf8'), OVERLAY_SOURCE);
  assert.equal(readFileSync(join(root, 'dist/companion/executor.js'), 'utf8'), EXECUTOR_SOURCE);
  assert.deepEqual(readdirSync(join(root, 'dist/companion/engine')).sort(), Object.keys(engineSources).map((name) => `${name}.js`).sort());

  const startCalls: Array<[string, string]> = [];
  const stopCalls: number[] = [];
  let delegatedListener: ((value: unknown) => void) | undefined;
  let unsubscribed = false;
  const store = {
    activeSkill: 'idle',
    activeAction: null as string | null,
    update(fn: (value: Record<string, unknown>) => Record<string, unknown>) {
      Object.assign(this, fn(this as unknown as Record<string, unknown>));
      return this;
    },
    subscribe(listener: (value: unknown) => void) {
      delegatedListener = listener;
      return () => {
        unsubscribed = true;
        delegatedListener = undefined;
      };
    },
  };
  const windowFixture: Record<string, unknown> = {
    fixtureStart(skill: string, action: string) { startCalls.push([skill, action]); },
    fixtureStop() { stopCalls.push(1); },
    fixtureGet(value: unknown) { return value; },
  };
  runInNewContext(readFileSync(bundlePath, 'utf8'), {
    window: windowFixture,
    store,
    emit() {},
  });
  const companion = windowFixture.__frCompanion as {
    version: number;
    startAction(skill: string, action: string): void;
    stopAction(): void;
    getState(): typeof store;
    subscribe(listener: (value: unknown) => void): () => void;
  };
  assert.ok(companion);
  assert.equal(Object.isFrozen(companion), true);
  assert.equal(companion.version, 1);
  companion.startAction('woodcutting', 'chop_witherwood');
  assert.deepEqual(startCalls, [['woodcutting', 'chop_witherwood']]);
  assert.deepEqual(stopCalls, [1]);
  assert.equal(store.activeSkill, 'woodcutting');
  assert.equal(store.activeAction, 'chop_witherwood');
  companion.stopAction();
  assert.deepEqual(stopCalls, [1, 1]);
  assert.equal(companion.getState(), store);
  store.activeSkill = 'mining';
  assert.equal(companion.getState().activeSkill, 'mining');
  const updates: unknown[] = [];
  const listener = (value: unknown) => updates.push(value);
  const unsubscribe = companion.subscribe(listener);
  assert.equal(delegatedListener, listener);
  const update = { activeSkill: 'fishing' };
  delegatedListener?.(update);
  assert.deepEqual(updates, [update]);
  unsubscribe();
  assert.equal(unsubscribed, true);
  assert.equal(delegatedListener, undefined);
});


test('quit requires explicit confirmation', async () => {
  const response = await handleApi({ method: 'POST', pathname: '/api/quit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}), services: { quitApp() {} } });
  assert.deepEqual(response, { status: 400, body: { ok: false, error: 'Quit requires confirmation.' } });
});

test('transformed main preserves browser and native behavior', () => {
  const { root, pack } = createCase(); apply(root, pack);
  const harnessPath = join(root, 'adapter-harness.cjs'); writeFileSync(harnessPath, harness);
  const browser = spawnSync(process.execPath, [harnessPath, join(root, 'electron/main.cjs'), 'browser', 'client'], { encoding: 'utf8' });
  assert.equal(browser.status, 0, browser.stderr); const browserResult = JSON.parse(browser.stdout);
  assert.deepEqual(browserResult.events.slice(0, 2), ['initSteam', 'hostStart']); assert.equal(browserResult.browser, true); assert.equal(browserResult.openBrowser, true); assert.deepEqual(browserResult.service, { ok: true, activated: 7 }); assert.equal(browserResult.cached, true);
  const noOpen = spawnSync(process.execPath, [harnessPath, join(root, 'electron/main.cjs'), 'browser', 'no-open', 'client'], { encoding: 'utf8' });
  assert.equal(noOpen.status, 0, noOpen.stderr); const noOpenResult = JSON.parse(noOpen.stdout); assert.deepEqual(noOpenResult.events.slice(0, 2), ['initSteam', 'hostStart']); assert.equal(noOpenResult.browser, true); assert.equal(noOpenResult.openBrowser, false); assert.deepEqual(noOpenResult.service, { ok: true, activated: 7 });
  const normal = spawnSync(process.execPath, [harnessPath, join(root, 'electron/main.cjs'), 'normal', 'none'], { encoding: 'utf8' });
  assert.equal(normal.status, 0, normal.stderr); const normalResult = JSON.parse(normal.stdout); assert.equal(normalResult.browser, false); assert.deepEqual(normalResult.noClient, { ok: false, reason: 'no-client' }); assert.equal(normalResult.cached, true); assert.equal(normalResult.activated, true);
  const bad = spawnSync(process.execPath, [harnessPath, join(root, 'electron/main.cjs'), 'normal', 'throw'], { encoding: 'utf8' });
  assert.equal(bad.status, 0, bad.stderr); assert.deepEqual(JSON.parse(bad.stdout).caught, { ok: false, error: 'activation failed' });
});

test('rejects main, preload and bundle anchor mutations without tree writes', () => {
  for (const [file, anchor] of [['electron/main.cjs', 'const STEAM_APP_ID = 3789070;'], ['electron/preload.cjs', 'saveGame:'], ['dist/assets/index-test1234.js', '"skill_started"']] as const) {
    for (const duplicate of [false, true]) {
      const { root, pack } = createCase(); const path = join(root, file); let source = readFileSync(path, 'utf8'); source = duplicate ? `${source}\n${anchor}\n` : source.replace(anchor, ''); writeFileSync(path, source); const before = snapshot(root);
      assert.throws(() => apply(root, pack)); assert.deepEqual(snapshot(root), before);
    }
  }
});

test('rejects a preexisting companion no-open flag without tree writes', () => {
  const { root, pack } = createCase();
  const main = join(root, 'electron/main.cjs');
  writeFileSync(main, `${readFileSync(main, 'utf8')}\nconst companionNoOpen = false;\n`);
  const before = snapshot(root);
  assert.throws(() => apply(root, pack));
  assert.deepEqual(snapshot(root), before);
});
test('rejects missing or unknown companion modules before mutation', () => {
  for (const mutate of [
    (pack: string) => unlinkSync(join(pack, 'engine/model.js')),
    (pack: string) => writeFileSync(join(pack, 'unexpected.js'), 'unexpected'),
  ]) {
    const { root, pack } = createCase();
    mutate(pack);
    const before = snapshot(root);
    assert.throws(() => apply(root, pack), /pack has unexpected root files|pack engine has missing or unknown|pack has missing or unknown/);
    assert.deepEqual(snapshot(root), before);
  }
});

test('rejects pack build mismatch and symlinks before mutation', () => {
  const mismatch = createCase('different'); const beforeMismatch = snapshot(mismatch.root); assert.throws(() => apply(mismatch.root, mismatch.pack)); assert.deepEqual(snapshot(mismatch.root), beforeMismatch);
  const linked = createCase();
  const linkedItems = join(linked.pack, 'data/model.json');
  const linkedContents = readFileSync(linkedItems);
  const linkedSource = join(linked.pack, 'data/model-source.json');
  writeFileSync(linkedSource, linkedContents);
  unlinkSync(linkedItems);
  symlinkSync('model-source.json', linkedItems);
  const beforeLinked = snapshot(linked.root); assert.throws(() => apply(linked.root, linked.pack)); assert.deepEqual(snapshot(linked.root), beforeLinked);
});
