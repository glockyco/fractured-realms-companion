import { execFileSync, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OperationalError } from './lib/errors.ts';
import { runDoctor } from './doctor.ts';
import { refreshCompanion, type RefreshOptions, type RefreshResult } from './refresh.ts';
import { COMPANION_REVISION } from './patch/revision.ts';
import { discoverInstall, type DiscoverInstallOptions, type SteamInstall } from './platform/steam.ts';
import { stateDir } from './platform/state.ts';

const APP_ID = '3789070';
const PORT = 48766;
const HOST = '127.0.0.1';
const SERVICE = 'FRACTURED_REALMS_COMPANION_V1';
const HEALTH_URL = `http://${HOST}:${PORT}/health`;
const COMPANION_ARGS = ['-applaunch', APP_ID, '--companion-browser', '--companion-no-open'] as const;
const POLL_INTERVAL_MS = 5_000;
const HEALTH_DEADLINE_MS = 120_000;
const TIMED_OUT = Symbol('health-timeout');

export interface DoctorRow {
  status: 'PASS' | 'WARN' | 'FAIL';
  check: string;
  message: string;
}

export interface DoctorResult {
  rows: DoctorRow[];
  blocking: boolean;
}

export interface HealthResult {
  status: number;
  body: unknown;
}

export interface SpawnedProcess {
  unref?: () => unknown;
  once?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => SpawnedProcess;
export type DoctorFunction = typeof runDoctor;
export type DiscoverFunction = typeof discoverInstall;
export type RequestHealthFunction = (url: string, signal?: AbortSignal) => Promise<HealthResult | Response | unknown>;
export type SleepFunction = (milliseconds: number) => void | Promise<void>;
export type CommandExistsFunction = (command: string) => boolean | Promise<boolean>;
export type NowFunction = () => number;
export type SetTimerFunction = (callback: () => void, milliseconds: number) => unknown;
export type ClearTimerFunction = (handle: unknown) => void;
export type LaunchLock = { acquire(stateDirectory: string): () => void };
export type RequestQuitFunction = (url: string) => Promise<unknown>;

export interface LaunchDependencies {
  doctor?: DoctorFunction;
  discoverInstall?: DiscoverFunction;
  spawn?: SpawnFunction;
  requestHealth?: RequestHealthFunction;
  sleep?: SleepFunction;
  commandExists?: CommandExistsFunction;
  now?: NowFunction;
  setTimer?: SetTimerFunction;
  clearTimer?: ClearTimerFunction;
  lock?: LaunchLock;
  requestQuit?: RequestQuitFunction;
}

export interface LaunchOptions extends DiscoverInstallOptions {
  noOpen?: boolean;
  stateDirectory?: string;
  dependencies?: LaunchDependencies;
}

function defaultCommandExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function defaultRequestHealth(url: string, signal?: AbortSignal): Promise<HealthResult> {
  try {
    const response = await fetch(url, signal ? { signal } : undefined);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => undefined);
    }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: undefined };
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function defaultSetTimer(callback: () => void, milliseconds: number): unknown {
  return setTimeout(callback, milliseconds);
}

function defaultClearTimer(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
function doctorFailure(result: DoctorResult): OperationalError | undefined {
  const failures = Array.isArray(result.rows) ? result.rows.filter((row) => row.status === 'FAIL') : [];
  if (failures.length === 0) return undefined;
  const details = failures.map((row) => `${row.check}: ${row.message}`).join('; ');
  return new OperationalError(`doctor checks failed: ${details}`);
}

function healthBody(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

async function normaliseHealth(value: HealthResult | Response | unknown): Promise<HealthResult> {
  if (value !== null && typeof value === 'object') {
    const candidate = value as { status?: unknown; body?: unknown; json?: () => Promise<unknown>; text?: () => Promise<string> };
    if (typeof candidate.status === 'number' && typeof candidate.json !== 'function' && 'body' in candidate) return { status: candidate.status, body: candidate.body };
    if (typeof candidate.status === 'number' && typeof candidate.json === 'function') {
      let body: unknown;
      try {
        body = await candidate.json();
      } catch {
        body = typeof candidate.text === 'function' ? await candidate.text().catch(() => undefined) : undefined;
      }
      return { status: candidate.status, body };
    }
  }
  return { status: 0, body: undefined };
}

function fileLaunchLock(stateDirectory: string): () => void {
  mkdirSync(stateDirectory, { recursive: true });
  const lockPath = join(stateDirectory, 'launch.lock');
  const acquire = (): void => {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      try {
        const stat = statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
          unlinkSync(lockPath);
          writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
          return;
        }
      } catch (statError) {
        if (statError && typeof statError === 'object' && 'code' in statError && statError.code === 'ENOENT') {
          writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
          return;
        }
      }
      throw new OperationalError('another fractured-companion launch is already in progress');
    }
  };
  try { acquire(); } catch (error) {
    if (error instanceof OperationalError) throw error;
    throw new OperationalError('could not acquire the fractured-companion launch lock', error instanceof Error ? { cause: error } : undefined);
  }
  return () => { try { unlinkSync(lockPath); } catch { /* best effort */ } };
}

function defaultRequestQuit(url: string): Promise<unknown> {
  return fetch(`${url.replace(/\/$/u, '')}/api/quit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'fractured-realms' }),
  });
}

function healthy(response: HealthResult, expectedRevision = COMPANION_REVISION): boolean {
  const body = healthBody(response.body);
  return response.status === 200 && body?.ok === true && body.service === SERVICE && body.host === HOST && body.port === PORT && body.revision === expectedRevision;
}

function isOwnService(response: HealthResult): boolean {
  const body = healthBody(response.body);
  return response.status === 200 && body?.ok === true && body.service === SERVICE && body.host === HOST && body.port === PORT;
}

function isFlatpakSteamRoot(root: string): boolean {
  return /(?:^|[\\/])(?:\.var[\\/]app[\\/]com\.valvesoftware\.Steam)(?:[\\/]|$)/i.test(root);
}

function launchCommand(install: SteamInstall, platform: NodeJS.Platform, flatpak: boolean, bottle: string): { command: string; args: string[] } {
  if (platform === 'darwin') {
    if (!install.winePath) throw new OperationalError('CrossOver wine binary was not discovered');
    return { command: install.winePath, args: ['--bottle', bottle, '--no-wait', install.steamExe, ...COMPANION_ARGS] };
  }
  if (platform === 'win32') return { command: install.steamExe, args: [...COMPANION_ARGS] };
  if (platform === 'linux') return flatpak ? { command: 'flatpak', args: ['run', 'com.valvesoftware.Steam', ...COMPANION_ARGS] } : { command: 'steam', args: [...COMPANION_ARGS] };
  throw new OperationalError(`unsupported platform for launch: ${platform}`);
}

function openerCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'linux') return { command: 'xdg-open', args: [url] };
  throw new OperationalError(`unsupported platform for launch: ${platform}`);
}

function invokeSpawn(spawn: SpawnFunction, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: SpawnedProcess;
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore' });
    } catch (error) {
      if (error instanceof OperationalError) {
        reject(error);
      } else {
        reject(new OperationalError(`could not start ${command}`, error instanceof Error ? { cause: error } : undefined));
      }
      return;
    }

    const settle = (error?: unknown): void => {
      if (error === undefined) resolve();
      else reject(error instanceof OperationalError ? error : new OperationalError(`could not start ${command}`, error instanceof Error ? { cause: error } : undefined));
    };
    const onError = (error: unknown): void => settle(error);
    const onSpawn = (): void => settle();
    const eventMethod = typeof child.once === 'function' ? child.once.bind(child) : typeof child.on === 'function' ? child.on.bind(child) : undefined;
    if (!eventMethod) {
      try {
        child.unref?.();
        resolve();
      } catch (error) {
        settle(error);
      }
      return;
    }

    try {
      eventMethod('error', onError);
      eventMethod('spawn', onSpawn);
      child.unref?.();
    } catch (error) {
      settle(error);
    }
  });
}

export async function launchCompanion(options: LaunchOptions = {}): Promise<{ url: string; command: string; args: string[] }> {
  const dependencies = options.dependencies ?? {};
  const doctor = dependencies.doctor ?? runDoctor;
  const discover = dependencies.discoverInstall ?? discoverInstall;
  const spawn = dependencies.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, [...args], spawnOptions));
  const requestHealth = dependencies.requestHealth ?? defaultRequestHealth;
  const sleep = dependencies.sleep ?? defaultSleep;
  const commandExists = dependencies.commandExists ?? defaultCommandExists;
  const now = dependencies.now ?? Date.now;
  const setTimer = dependencies.setTimer ?? defaultSetTimer;
  const clearTimer = dependencies.clearTimer ?? defaultClearTimer;
  const platform = options.platform ?? process.platform;
  const url = `http://${HOST}:${PORT}/`;

  let probe: HealthResult | undefined;
  try { probe = await normaliseHealth(await requestHealth(HEALTH_URL)); } catch { probe = undefined; }
  if (probe && healthy(probe)) {
    if (!options.noOpen) {
      const opener = openerCommand(platform, url);
      await invokeSpawn(spawn, opener.command, opener.args);
    }
    return { url, command: '', args: [] };
  }
  if (probe && isOwnService(probe)) {
    throw new OperationalError("a companion with an outdated revision is running; run 'fractured-companion relaunch' or quit the game first");
  }
  if (probe && probe.status !== 0) {
    throw new OperationalError('port 48766 is already serving an unknown service; free it before launching');
  }

  const stateDirectory = options.stateDirectory ?? stateDir({ platform, env: options.env, home: options.home });
  const releaseLock = (dependencies.lock ?? { acquire: fileLaunchLock }).acquire(stateDirectory);
  try {
    const doctorOptions = { steamRoot: options.steamRoot, bottle: options.bottle, platform, env: options.env, home: options.home } as Parameters<DoctorFunction>[0];
  const doctorResult = await doctor(doctorOptions);
  const failure = doctorFailure(doctorResult);
  if (failure) throw failure;

  const install = await discover({ steamRoot: options.steamRoot, bottle: options.bottle, platform, env: options.env, home: options.home, execFileSync: options.execFileSync });
  let flatpak = false;
  if (platform === 'linux' && !(await commandExists('steam'))) {
    if (!(await commandExists('flatpak')) || !isFlatpakSteamRoot(install.steamRoot)) throw new OperationalError('Steam command not found and no detected Flatpak Steam installation');
    flatpak = true;
  }

  const game = launchCommand(install, platform, flatpak, options.bottle ?? 'Steam');
  await invokeSpawn(spawn, game.command, game.args);

  let isHealthy = false;
  const deadline = now() + HEALTH_DEADLINE_MS;
  while (now() < deadline) {
    const remaining = Math.max(0, deadline - now());
    if (remaining === 0) break;

    let response: HealthResult | typeof TIMED_OUT = TIMED_OUT;
    const controller = new AbortController();
    let timedOut = false;
    let rejectTimeout!: (reason?: unknown) => void;
    const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    let request: Promise<HealthResult>;
    try {
      request = Promise.resolve(requestHealth(HEALTH_URL, controller.signal)).then((value) => normaliseHealth(value));
    } catch (error) {
      request = Promise.reject(error);
    }
    let timer: unknown;
    try {
      timer = setTimer(() => {
        timedOut = true;
        controller.abort();
        rejectTimeout(new Error('health request timed out'));
      }, remaining);
      try {
        response = await Promise.race([request, timeout]);
      } catch {
        response = timedOut ? TIMED_OUT : { status: 0, body: undefined };
      }
    } finally {
      if (timer !== undefined) clearTimer(timer);
    }
    if (response !== TIMED_OUT && healthy(response)) {
      isHealthy = true;
      break;
    }
    if (response === TIMED_OUT || now() >= deadline) break;

    const delay = Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - now()));
    if (delay === 0) break;
    let releaseWait!: () => void;
    const wait = new Promise<void>((resolve) => { releaseWait = resolve; });
    let waitTimer: unknown;
    try {
      waitTimer = setTimer(releaseWait, delay);
      await Promise.race([Promise.resolve(sleep(delay)), wait]);
    } finally {
      if (waitTimer !== undefined) clearTimer(waitTimer);
    }
  }
  if (!isHealthy) throw new OperationalError(`companion host did not become healthy with the expected companion revision; open http://${HOST}:${PORT}/ manually`);

  if (!options.noOpen) {
    const opener = openerCommand(platform, url);
    await invokeSpawn(spawn, opener.command, opener.args);
  }
  return { url, command: game.command, args: game.args };
  } finally {
    releaseLock();
  }
}

export async function relaunchCompanion(options: LaunchOptions & { refresh?: (options: RefreshOptions) => RefreshResult | Promise<RefreshResult> } = {}): Promise<{ url: string; command: string; args: string[] }> {
  const dependencies = options.dependencies ?? {};
  const requestHealth = dependencies.requestHealth ?? defaultRequestHealth;
  const requestQuit = dependencies.requestQuit ?? defaultRequestQuit;
  const sleep = dependencies.sleep ?? defaultSleep;
  const now = dependencies.now ?? Date.now;
  const platform = options.platform ?? process.platform;
  const url = `http://${HOST}:${PORT}/`;
  let probe: HealthResult | undefined;
  try { probe = await normaliseHealth(await requestHealth(HEALTH_URL)); } catch { probe = undefined; }
  if (probe && isOwnService(probe)) {
    await requestQuit(url);
    const deadline = now() + 30_000;
    let stopped = false;
    while (now() < deadline) {
      try {
        const response = await normaliseHealth(await requestHealth(HEALTH_URL));
        if (response.status === 0) { stopped = true; break; }
      } catch {
        stopped = true;
        break;
      }
      const delay = Math.min(500, Math.max(0, deadline - now()));
      if (delay === 0) break;
      await sleep(delay);
    }
    if (!stopped) throw new OperationalError('the running game did not shut down; close it manually and retry');
  }
  const stateDirectory = options.stateDirectory ?? stateDir({ platform, env: options.env, home: options.home });
  const refresh = options.refresh ?? refreshCompanion;
  await refresh({ steamRoot: options.steamRoot, bottle: options.bottle, platform, stateDirectory });
  return launchCompanion(options);
}
