import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, sep } from 'node:path';
import { ELECTRON_HOST_SOURCE, FRACTURED_ADAPTER_SOURCE } from '../generated/embedded.ts';
import { atomicWriteText } from '../lib/atomic.ts';
import { OperationalError } from '../lib/errors.ts';

export const FRACTURED_MARKER = 'FRACTURED_REALMS_COMPANION_V1';
const FOREIGN_MARKER_PREFIX = 'CROSSOVER_BROWSER_GAMES_FRACTURED_REALMS_';
const ERROR_PREFIX = 'Unexpected Fractured Realms entry point for build ';
const REQUIRED_MODULES = ['model.js', 'formulas.js', 'closure.js', 'expand.js', 'simulate.js', 'queue.js'] as const;
const REQUIRED_DATA = ['model.json'] as const;
const MAIN_ANCHORS = [
  'const STEAM_APP_ID = 3789070;',
  'function initSteam() {',
  "const steamworks = require('steamworks.js');",
  'function createWindow() {',
  'app.whenReady().then(() => {',
  "ipcMain.handle('open-external',",
  "ipcMain.handle('submit-feedback',",
  "ipcMain.handle('get-fullscreen',",
  "ipcMain.handle('set-fullscreen',",
  "ipcMain.handle('quit-app',",
  "ipcMain.handle('save-game',",
  "ipcMain.handle('steam:reset-achievements',",
  "ipcMain.handle('steam:unlock', (_event, apiName) => {",
] as const;
const PRELOAD_NAMES = [
  'saveGame',
  'submitFeedback',
  'openExternal',
  'steamUnlock',
  'steamResetAchievements',
  'getFullscreen',
  'setFullscreen',
  'quitApp',
  'onFullscreenChanged',
] as const;
const NATIVE_UNLOCK_LINES = [
  "ipcMain.handle('steam:unlock', (_event, apiName) => {",
  '  try {',
  "    if (!steamClient) { console.log('[steam] unlock skipped, no client:', apiName); return { ok: false, reason: 'no-client' }; }",
  "    if (typeof apiName !== 'string') return { ok: false, reason: 'bad-name' };",
  '    const res = steamClient.achievement.activate(apiName);',
  "    console.log('[steam] activate', apiName, '->', res);",
  '    return { ok: true, activated: res };',
  '  } catch (err) {',
  "    console.log('[steam] activate ERROR', apiName, err?.message ?? err);",
  "    return { ok: false, error: err?.message ?? String(err) };",
  '  }',
  '});',
] as const;

export interface FracturedApplyOptions {
  buildId: string;
  packDirectory: string;
  payloadRevision: string;
}

interface PackFile {
  relativePath: string;
  bytes: Buffer;
}

function fail(message: string, cause?: unknown): never {
  throw new OperationalError(message, cause instanceof Error ? { cause } : undefined);
}

function count(source: string, fragment: string): number {
  let n = 0;
  let at = 0;
  while ((at = source.indexOf(fragment, at)) !== -1) { n += 1; at += fragment.length; }
  return n;
}

function regular(path: string, description: string): void {
  let info;
  try { info = lstatSync(path); } catch (error) { fail(`${description} is missing: ${path}`, error); }
  if (!info!.isFile() || info!.isSymbolicLink()) fail(`${description} must be a regular file: ${path}`);
}

function directory(path: string, description: string): void {
  let info;
  try { info = lstatSync(path); } catch (error) { fail(`${description} is missing: ${path}`, error); }
  if (!info!.isDirectory() || info!.isSymbolicLink()) fail(`${description} must be a regular directory: ${path}`);
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function stringAwareBraceEnd(source: string, open: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (lineComment) { if (c === '\n' || c === '\r') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (c === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

function transformedBundle(source: string, filename: string): string {
  if (source.includes('__frCompanion')) fail(`bundle already contains __frCompanion: ${filename}`);
  const skillMatches = [...source.matchAll(/"skill_started"/g)];
  if (skillMatches.length !== 1) fail(`bundle anchor skill_started is ambiguous: ${filename}`);
  const skillIndex = skillMatches[0].index!;
  const declarations = [...source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)];
  let declaration: RegExpMatchArray | undefined;
  let bodyEnd = -1;
  for (const candidate of declarations) {
    const index = candidate.index!;
    if (index >= skillIndex) break;
    const open = index + candidate[0].lastIndexOf('{');
    const end = stringAwareBraceEnd(source, open);
    if (end > skillIndex) { declaration = candidate; bodyEnd = end; }
  }
  if (!declaration) fail(`bundle anchor startAction is missing: ${filename}`);
  const start = declaration[1];
  const body = source.slice(declaration.index!, bodyEnd);
  const update = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*\\(\\s*\\)\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\.\\s*update\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*=>\\s*\\(\\s*\\{\\s*\\.\\.\\.[A-Za-z_$][\\w$]*\\s*,\\s*activeSkill\\s*:\\s*[A-Za-z_$][\\w$]*\\s*,\\s*activeAction\\s*:\\s*[A-Za-z_$][\\w$]*\\s*\\?\\?\\s*null\\s*\\}\\s*\\)`,
    'g',
  );
  const updates = [...body.matchAll(update)];
  if (updates.length !== 1) fail(`bundle anchor stopAction/store is ${updates.length === 0 ? 'missing' : 'ambiguous'}: ${filename}`);
  const stop = updates[0][1];
  const store = updates[0][2];
  const get = new RegExp(`\\bconst\\s+[A-Za-z_$][\\w$]*\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(\\s*${escapeRegExp(store)}\\s*\\)`, 'g');
  const gets = [...body.matchAll(get)];
  if (gets.length !== 1) fail(`bundle anchor getState is ${gets.length === 0 ? 'missing' : 'ambiguous'}: ${filename}`);
  const getter = gets[0][1];
  return `${source};window.__frCompanion=Object.freeze({version:1,startAction:${start},stopAction:${stop},getState:()=>${getter}(${store}),subscribe:f=>${store}.subscribe(f)});`;
}

function validatePack(options: FracturedApplyOptions): PackFile[] {
  const pack = options.packDirectory;
  directory(pack, 'pack directory');
  const walk = (path: string): void => {
    let info;
    try { info = lstatSync(path); } catch (error) { fail(`cannot inspect pack path: ${path}`, error); }
    if (info!.isSymbolicLink()) fail(`pack contains a symlink: ${relative(pack, path)}`);
    if (info!.isDirectory()) {
      for (const name of readdirSync(path)) walk(join(path, name));
    } else if (!info!.isFile()) fail(`pack contains a non-regular path: ${relative(pack, path)}`);
  };
  walk(pack);
  const names = readdirSync(pack);
  const expectedRoot = new Set(['pack.json', 'overlay.js', 'executor.js', 'engine', 'data']);
  if (names.length !== expectedRoot.size || names.some((name) => !expectedRoot.has(name))) fail('pack has unexpected root files');
  regular(join(pack, 'pack.json'), 'pack.json');
  regular(join(pack, 'overlay.js'), 'overlay.js');
  regular(join(pack, 'executor.js'), 'executor.js');
  directory(join(pack, 'engine'), 'pack engine directory');
  const engineNames = readdirSync(join(pack, 'engine'));
  const expectedEngine = new Set<string>(REQUIRED_MODULES);
  if (engineNames.length !== REQUIRED_MODULES.length || engineNames.some((name) => !expectedEngine.has(name))) fail('pack engine has missing or unknown files');
  for (const name of REQUIRED_MODULES) regular(join(pack, 'engine', name), `engine/${name}`);
  directory(join(pack, 'data'), 'pack data directory');
  const dataNames = readdirSync(join(pack, 'data'));
  const expectedData = new Set<string>(REQUIRED_DATA);
  if (dataNames.length !== REQUIRED_DATA.length || dataNames.some((name) => !expectedData.has(name))) fail('pack data has missing or unknown files');
  let manifest: unknown;
  try { manifest = JSON.parse(readFileSync(join(pack, 'pack.json'), 'utf8')); } catch (error) { fail('pack.json is not valid JSON', error); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('pack.json has invalid schema');
  const record = manifest as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || record.schema_version !== 2 || record.build_id !== options.buildId || typeof record.generated_at !== 'string') fail('pack.json has invalid schema or build');
  const files: PackFile[] = [];
  for (const name of ['pack.json', 'overlay.js', 'executor.js']) {
    const path = join(pack, name);
    regular(path, name);
    const bytes = readFileSync(path);
    files.push({ relativePath: name, bytes });
  }
  for (const name of REQUIRED_MODULES) {
    const path = join(pack, 'engine', name);
    regular(path, `engine/${name}`);
    files.push({ relativePath: join('engine', name), bytes: readFileSync(path) });
  }
  for (const name of REQUIRED_DATA) {
    const path = join(pack, 'data', name);
    regular(path, name);
    const bytes = readFileSync(path);
    try { JSON.parse(bytes.toString('utf8')); } catch (error) { fail(`pack data file is not valid JSON: ${name}`, error); }
    files.push({ relativePath: join('data', name), bytes });
  }
  return files;
}

function stagePack(dist: string, files: PackFile[]): { stage: string; target: string } {
  directory(dist, 'renderer dist');
  const target = join(dist, 'companion');
  if (existsSync(target)) {
    const info = lstatSync(target);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('existing companion path is not a regular directory');
  }
  const stage = mkdtempSync(join(dist, `.companion-staging-${randomUUID()}-`));
  try {
    for (const file of files) {
      const output = join(stage, file.relativePath);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, file.bytes, { mode: 0o600 });
    }
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    fail('could not stage companion pack', error);
  }
  return { stage, target };
}

function publishPack(stage: string, target: string): void {
  const old = `${target}.previous-${randomUUID()}`;
  let movedOld = false;
  try {
    if (existsSync(target)) { renameSync(target, old); movedOld = true; }
    renameSync(stage, target);
    if (movedOld) rmSync(old, { recursive: true, force: true });
  } catch (error) {
    try { if (existsSync(target)) rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
    try { if (movedOld && existsSync(old)) renameSync(old, target); } catch { /* best effort */ }
    try { if (existsSync(stage)) rmSync(stage, { recursive: true, force: true }); } catch { /* best effort */ }
    fail('could not publish companion pack', error);
  }
}

function patchedMain(source: string, newline: string): string {
  const nativeHandler = NATIVE_UNLOCK_LINES.join(newline);
  const unlock = [
    'function unlockSteamAchievement(apiName) {',
    '  try {',
    "    if (!steamClient) { console.log('[steam] unlock skipped, no client:', apiName); return { ok: false, reason: 'no-client' }; }",
    "    if (typeof apiName !== 'string') return { ok: false, reason: 'bad-name' };",
    '    const res = steamClient.achievement.activate(apiName);',
    "    console.log('[steam] activate', apiName, '->', res);",
    '    return { ok: true, activated: res };',
    '  } catch (err) {',
    "    console.log('[steam] activate ERROR', apiName, err?.message ?? err);",
    "    return { ok: false, error: err?.message ?? String(err) };",
    '  }',
    '}',
    '',
    "ipcMain.handle('steam:unlock', (_event, apiName) => unlockSteamAchievement(apiName));",
  ].join(newline);
  source = source.replace(nativeHandler, unlock);
  source = source.replace("const steamworks = require('steamworks.js');", 'const steamworks = loadSteamworks();');
  const fsAnchor = 'const fs   = require(\'fs\');';
  const loader = [
    fsAnchor,
    '',
    'function loadSteamworks() {',
    "  const sourceRoot = path.join(__dirname, '../node_modules/steamworks.js');",
    "  const cacheRoot = path.join(app.getPath('userData'), 'companion-steamworks-0.4.0-v1');",
    '  const files = [',
    "    'index.js',",
    "    'dist/win64/steamworksjs.win32-x64-msvc.node',",
    "    'dist/win64/steam_api64.dll',",
    '  ];',
    '  for (const relative of files) {',
    '    const sourcePath = path.join(sourceRoot, relative);',
    '    const targetPath = path.join(cacheRoot, relative);',
    '    const sourceSize = fs.statSync(sourcePath).size;',
    '    try {',
    '      const targetStat = fs.lstatSync(targetPath);',
    '      if (targetStat.isFile() && targetStat.size === sourceSize) continue;',
    '    } catch (err) {',
    "      if (err?.code !== 'ENOENT') throw err;",
    '    }',
    '    fs.mkdirSync(path.dirname(targetPath), { recursive: true });',
    '    const temporaryPath = `${targetPath}.${process.pid}.tmp`;',
    '    try {',
    "      try { fs.unlinkSync(temporaryPath); } catch (err) { if (err?.code !== 'ENOENT') throw err; }",
    '      fs.copyFileSync(sourcePath, temporaryPath);',
    "      try { fs.unlinkSync(targetPath); } catch (err) { if (err?.code !== 'ENOENT') throw err; }",
    '      fs.renameSync(temporaryPath, targetPath);',
    '    } finally {',
    "      try { fs.unlinkSync(temporaryPath); } catch (err) { if (err?.code !== 'ENOENT') throw err; }",
    '    }',
    '  }',
    "  return require(path.join(cacheRoot, 'index.js'));",
    '}',
  ].join(newline);
  source = source.replace(fsAnchor, loader);
  const originalReady = [
    'app.whenReady().then(() => {',
    '  initSteam();',
    '  createWindow();',
    "  app.on('activate', () => {",
    '    if (BrowserWindow.getAllWindows().length === 0) createWindow();',
    '  });',
    '});',
  ].join(newline);
  const browserReady = [
    'app.whenReady().then(async () => {',
    '  initSteam();',
    '  if (companionBrowserMode) {',
    "    await require('./companion-host.cjs').start({",
    '      app,',
    '      shell,',
    '      path,',
    '      fs,',
    '      profile: require(\'./companion-profile.json\'),',
    "      adapter: require('./companion-adapter.cjs'),",
    '      openBrowser: !companionNoOpen,',
    '      services: {',
    '        steamUnlock: unlockSteamAchievement,',
    '        quitApp: () => app.quit(),',
    '      },',
    '    });',
    '    return;',
    '  }',
    '  createWindow();',
    "  app.on('activate', () => {",
    '    if (BrowserWindow.getAllWindows().length === 0) createWindow();',
    '  });',
    '});',
  ].join(newline);
  source = source.replace(originalReady, browserReady);
  const pathAnchor = "const path = require('path');";
  source = source.replace(pathAnchor, `${pathAnchor}${newline}const companionBrowserMode = process.argv.includes('--companion-browser'); // ${FRACTURED_MARKER}${newline}const companionNoOpen = process.argv.includes('--companion-no-open');`);
  return source;
}

function profileText(payloadRevision: string): string {
  return `${JSON.stringify({
    schema_version: 1,
    id: 'fractured-realms',
    display_name: 'Fractured Realms',
    service: FRACTURED_MARKER,
    revision: payloadRevision,
    assets_relative_to_runtime: '../dist',
    bind_host: '127.0.0.1',
    browser_host: '127.0.0.1',
    port: 48766,
    max_request_bytes: 65536,
    companion: true,
  }, null, 2)}\n`;
}

function validateMainAndPreload(root: string, buildId: string): { entry: string; source: string; newline: string } {
  const entry = join(root, 'electron/main.cjs');
  const preload = join(root, 'electron/preload.cjs');
  regular(entry, 'electron/main.cjs');
  regular(preload, 'electron/preload.cjs');
  let source: string;
  let preloadSource: string;
  try {
    source = readFileSync(entry, 'utf8');
    preloadSource = readFileSync(preload, 'utf8');
  } catch (error) { fail(`${ERROR_PREFIX}${buildId}`, error); }
  if (MAIN_ANCHORS.some((anchor) => count(source!, anchor) !== 1)) fail(`${ERROR_PREFIX}${buildId}`);
  if (count(source!, "const path = require('path');") !== 1 || count(source!, "const fs   = require('fs');") !== 1) fail(`${ERROR_PREFIX}${buildId}`);
  if (source!.includes('companionBrowserMode') || source!.includes('companionNoOpen') || preloadSource!.includes('companionBrowserMode') || preloadSource!.includes('companionNoOpen') || source!.includes(FRACTURED_MARKER) || preloadSource!.includes(FRACTURED_MARKER) || source!.includes(FOREIGN_MARKER_PREFIX) || preloadSource!.includes(FOREIGN_MARKER_PREFIX)) fail(`${ERROR_PREFIX}${buildId}`);
  if (count(preloadSource!, "contextBridge.exposeInMainWorld('electronAPI', {") !== 1 || PRELOAD_NAMES.some((name) => (preloadSource!.match(new RegExp(`^\\s*${name}\\s*:`, 'gm')) ?? []).length !== 1)) fail(`${ERROR_PREFIX}${buildId}`);
  const newline = source!.includes('\r\n') ? '\r\n' : '\n';
  if (count(source!, NATIVE_UNLOCK_LINES.join(newline)) !== 1) fail(`${ERROR_PREFIX}${buildId}`);
  const ready = [
    'app.whenReady().then(() => {',
    '  initSteam();',
    '  createWindow();',
    "  app.on('activate', () => {",
    '    if (BrowserWindow.getAllWindows().length === 0) createWindow();',
    '  });',
    '});',
  ].join(newline);
  if (count(source!, ready) !== 1) fail(`${ERROR_PREFIX}${buildId}`);
  return { entry, source: source!, newline };
}

function validateBundle(root: string): { path: string; source: string; patched: string } {
  const assets = join(root, 'dist/assets');
  directory(assets, 'renderer assets directory');
  const files = readdirSync(assets).filter((name) => /^index-[^/]+\.js$/.test(name));
  if (files.length !== 1) fail(`bundle anchor index bundle is ${files.length === 0 ? 'missing' : 'ambiguous'}`);
  const path = join(assets, files[0]);
  regular(path, 'renderer bundle');
  const source = readFileSync(path, 'utf8');
  return { path, source, patched: transformedBundle(source, path) };
}

export function createFracturedApply(options: FracturedApplyOptions): (extractedRoot: string) => void {
  if (!options || typeof options.buildId !== 'string' || options.buildId.length === 0 || typeof options.packDirectory !== 'string' || options.packDirectory.length === 0 || !/^[0-9a-f]{64}$/u.test(options.payloadRevision)) fail('invalid Fractured adapter options');
  const profile = profileText(options.payloadRevision);
  return (extractedRoot: string): void => {
    if (typeof extractedRoot !== 'string' || extractedRoot.length === 0) fail('invalid extracted root');
    directory(extractedRoot, 'extracted root');
    const validated = validateMainAndPreload(extractedRoot, options.buildId);
    const bundle = validateBundle(extractedRoot);
    const pack = validatePack(options);
    const transformed = patchedMain(validated.source, validated.newline);
    const host = ELECTRON_HOST_SOURCE;
    const adapter = FRACTURED_ADAPTER_SOURCE;
    if (!host || !adapter || !profile) fail('Fractured runtime assets are unavailable');
    const dist = join(extractedRoot, 'dist');
    const staged = stagePack(dist, pack);
    try {
      const electron = dirname(validated.entry);
      atomicWriteText(join(electron, 'companion-host.cjs'), host, 0o600);
      atomicWriteText(join(electron, 'companion-adapter.cjs'), adapter, 0o600);
      atomicWriteText(join(electron, 'companion-profile.json'), profile, 0o600);
      atomicWriteText(validated.entry, transformed, (statSync(validated.entry).mode & 0o777) || 0o600);
      atomicWriteText(bundle.path, bundle.patched, (statSync(bundle.path).mode & 0o777) || 0o600);
      publishPack(staged.stage, staged.target);
    } catch (error) {
      try { if (existsSync(staged.stage)) rmSync(staged.stage, { recursive: true, force: true }); } catch { /* best effort */ }
      if (error instanceof OperationalError) throw error;
      fail('could not write Fractured adapter outputs', error);
    }
  };
}
