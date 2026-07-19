import { execFileSync, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { OperationalError } from './lib/errors.ts';
import { runDoctor } from './doctor.ts';
import { discoverInstall, type DiscoverInstallOptions, type SteamInstall } from './platform/steam.ts';

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
}

export interface LaunchOptions extends DiscoverInstallOptions {
  noOpen?: boolean;
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
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function defaultSetTimer(callback: () => void, milliseconds: number): unknown {
  const timer = setTimeout(callback, milliseconds);
  timer.unref?.();
  return timer;
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

function healthy(response: HealthResult): boolean {
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
  if (!isHealthy) throw new OperationalError(`companion host did not become healthy; open http://${HOST}:${PORT}/ manually`);

  const url = `http://${HOST}:${PORT}/`;
  if (!options.noOpen) {
    const opener = openerCommand(platform, url);
    await invokeSpawn(spawn, opener.command, opener.args);
  }
  return { url, command: game.command, args: game.args };
}
