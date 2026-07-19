import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationalError } from '../src/lib/errors.ts';
import { launchCompanion, relaunchCompanion, type HealthResult, type SpawnFunction } from '../src/launch.ts';
import { COMPANION_REVISION } from '../src/patch/revision.ts';
import type { SteamInstall } from '../src/platform/steam.ts';

const healthy = (): HealthResult => ({
  status: 200,
  body: { ok: true, service: 'FRACTURED_REALMS_COMPANION_V1', revision: COMPANION_REVISION, host: '127.0.0.1', port: 48766 },
});

function install(platform: NodeJS.Platform, root = '/fixtures/Steam'): SteamInstall {
  return {
    platform,
    steamRoot: root,
    steamExe: platform === 'linux' ? 'steam' : `${root}/Steam.exe`,
    manifestPath: `${root}/steamapps/appmanifest_3789070.acf`,
    installDir: `${root}/steamapps/common/Fractured Realms`,
    ...(platform === 'darwin' ? { winePath: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine' } : {}),
  };
}

function harness(platform: NodeJS.Platform, steamInstall = install(platform)) {
  const calls: Array<{ command: string; args: readonly string[]; options: object }> = [];
  const spawn: SpawnFunction = (command, args, options) => {
    calls.push({ command, args, options });
    return { unref() {} };
  };
  let firstProbe = true;
  return {
    calls,
    options: {
      platform,
      noOpen: false,
      stateDirectory: '/tmp/fractured-realms-companion-test-state',
      dependencies: {
        doctor: async () => ({ rows: [{ status: 'PASS' as const, check: 'all', message: 'ok' }], blocking: false }),
        discoverInstall: () => steamInstall,
        spawn,
        lock: { acquire: () => () => {} },
        requestHealth: async () => {
          if (firstProbe) { firstProbe = false; throw new Error('not running'); }
          return healthy();
        },
        sleep: async () => {},
        commandExists: () => true,
        now: () => Date.now(),
      },
    },
  };
}

test('preflight reuses a healthy current companion without spawning Steam', async () => {
  const h = harness('linux');
  h.options.dependencies.requestHealth = async () => healthy();
  const result = await launchCompanion(h.options);
  assert.equal(result.command, '');
  assert.deepEqual(h.calls.map((call) => call.command), ['xdg-open']);
  const noOpen = harness('linux');
  noOpen.options.noOpen = true;
  noOpen.options.dependencies.requestHealth = async () => healthy();
  await launchCompanion(noOpen.options);
  assert.equal(noOpen.calls.length, 0);
});

test('preflight rejects an own service with an outdated revision', async () => {
  const h = harness('linux');
  h.options.dependencies.requestHealth = async () => ({ status: 200, body: { ok: true, service: 'FRACTURED_REALMS_COMPANION_V1', revision: '0'.repeat(64), host: '127.0.0.1', port: 48766 } });
  await assert.rejects(launchCompanion(h.options), /relaunch/);
  assert.equal(h.calls.length, 0);
});

test('preflight rejects a foreign service on the companion port', async () => {
  const h = harness('linux');
  h.options.dependencies.requestHealth = async () => ({ status: 200, body: { ok: true, service: 'OTHER', host: '127.0.0.1', port: 48766 } });
  await assert.rejects(launchCompanion(h.options), /unknown service/);
  assert.equal(h.calls.length, 0);
});

test('launch lock contention prevents Steam spawn', async () => {
  const h = harness('linux');
  h.options.dependencies.lock = { acquire: () => { throw new OperationalError('another fractured-companion launch is already in progress'); } };
  await assert.rejects(launchCompanion(h.options), /another fractured-companion launch/);
  assert.equal(h.calls.length, 0);
});

test('uses exact macOS CrossOver argv and opens once after health', async () => {
  const h = harness('darwin', install('darwin', '/Users/me/Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam'));
  const result = await launchCompanion(h.options);
  assert.deepEqual(result, {
    url: 'http://127.0.0.1:48766/',
    command: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine',
    args: ['--bottle', 'Steam', '--no-wait', '/Users/me/Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/Steam.exe', '-applaunch', '3789070', '--companion-browser', '--companion-no-open'],
  });
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0], { command: result.command, args: result.args, options: { detached: true, stdio: 'ignore' } });
  assert.deepEqual(h.calls[1], { command: 'open', args: [result.url], options: { detached: true, stdio: 'ignore' } });
});

test('uses exact Windows Steam argv', async () => {
  const h = harness('win32', {
    ...install('win32', 'C:/Steam'),
    steamExe: 'C:/Steam/Steam.exe',
  });
  const result = await launchCompanion(h.options);
  assert.equal(result.command, 'C:/Steam/Steam.exe');
  assert.deepEqual(result.args, ['-applaunch', '3789070', '--companion-browser', '--companion-no-open']);
  assert.equal(h.calls[1]?.command, 'cmd');
  assert.deepEqual(h.calls[1]?.args, ['/c', 'start', '', result.url]);
});

test('prefers the Steam command on Linux', async () => {
  const h = harness('linux');
  const seen: string[] = [];
  h.options.dependencies.commandExists = (command: string) => { seen.push(command); return command === 'steam'; };
  const result = await launchCompanion(h.options);
  assert.equal(result.command, 'steam');
  assert.deepEqual(result.args, ['-applaunch', '3789070', '--companion-browser', '--companion-no-open']);
  assert.deepEqual(seen, ['steam']);
});

test('falls back to Flatpak for a detected Flatpak Steam root', async () => {
  const root = '/home/test/.var/app/com.valvesoftware.Steam/.local/share/Steam';
  const h = harness('linux', install('linux', root));
  h.options.dependencies.commandExists = (command: string) => command === 'flatpak';
  const result = await launchCompanion(h.options);
  assert.equal(result.command, 'flatpak');
  assert.deepEqual(result.args, ['run', 'com.valvesoftware.Steam', '-applaunch', '3789070', '--companion-browser', '--companion-no-open']);
});

test('doctor FAIL prevents discovery and spawn', async () => {
  let discovered = false;
  let spawned = false;
  await assert.rejects(
    launchCompanion({
      platform: 'linux',
      dependencies: {
        requestHealth: async () => { throw new Error('not running'); },
        doctor: async () => ({ rows: [{ status: 'FAIL' as const, check: 'archive', message: 'foreign patch' }], blocking: true }),
        discoverInstall: () => { discovered = true; return install('linux'); },
        spawn: (() => { spawned = true; return { unref() {} }; }) as SpawnFunction,
      },
    }),
    (error: unknown) => error instanceof OperationalError && error.message.includes('archive: foreign patch'),
  );
  assert.equal(discovered, false);
  assert.equal(spawned, false);
});

test('polls until valid health then opens exactly once', async () => {
  const h = harness('linux');
  const responses: HealthResult[] = [
    { status: 200, body: { ok: true, service: 'wrong', host: '127.0.0.1', port: 48766 } },
    healthy(),
  ];
  const delays: number[] = [];
  let firstProbe = true;
  h.options.dependencies.requestHealth = async () => {
    if (firstProbe) { firstProbe = false; throw new Error('not running'); }
    return responses.shift() ?? healthy();
  };
  h.options.dependencies.sleep = async (milliseconds: number) => { delays.push(milliseconds); };
  await launchCompanion(h.options);
  assert.deepEqual(delays, [5000]);
  assert.equal(h.calls.filter((call) => call.command === 'xdg-open').length, 1);
});

test('noOpen suppresses the opener', async () => {
  const h = harness('linux');
  await launchCompanion({ ...h.options, noOpen: true });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]?.command, 'steam');
});

test('wrong service times out with a manual URL', async () => {
  const h = harness('linux');
  let firstProbe = true;
  h.options.dependencies.requestHealth = async () => {
    if (firstProbe) { firstProbe = false; throw new Error('not running'); }
    return { status: 200, body: { ok: true, service: 'wrong', host: '127.0.0.1', port: 48766 } };
  };
  let attempts = 0;
  let clock = 0;
  h.options.dependencies.now = () => clock;
  h.options.dependencies.setTimer = () => ({ timeout: true });
  h.options.dependencies.clearTimer = () => {};
  h.options.dependencies.sleep = async (milliseconds: number) => {
    attempts += 1;
    clock += milliseconds;
  };
  await assert.rejects(
    launchCompanion(h.options),
    (error: unknown) => error instanceof OperationalError && error.message.includes('http://127.0.0.1:48766/'),
  );
  assert.equal(attempts, 24);
  assert.equal(h.calls.length, 1);
});

test('async game spawn ENOENT rejects operationally', async () => {
  const h = harness('linux');
  h.options.dependencies.spawn = (command, args, options) => {
    h.calls.push({ command, args, options });
    return {
      once(event, listener) {
        if (event === 'error') queueMicrotask(() => listener(Object.assign(new Error('missing'), { code: 'ENOENT' })));
        return this;
      },
      unref() {},
    };
  };
  await assert.rejects(
    launchCompanion(h.options),
    (error: unknown) => error instanceof OperationalError && error.message.includes('could not start steam'),
  );
  assert.equal(h.calls.length, 1);
});

test('async opener EACCES rejects operationally after game spawn', async () => {
  const h = harness('linux');
  h.options.dependencies.spawn = (command, args, options) => {
    h.calls.push({ command, args, options });
    if (command === 'steam') return { unref() {} };
    return {
      once(event, listener) {
        if (event === 'error') queueMicrotask(() => listener(Object.assign(new Error('denied'), { code: 'EACCES' })));
        return this;
      },
      unref() {},
    };
  };
  await assert.rejects(
    launchCompanion(h.options),
    (error: unknown) => error instanceof OperationalError && error.message.includes('could not start xdg-open'),
  );
  assert.deepEqual(h.calls.map((call) => call.command), ['steam', 'xdg-open']);
});


test('relaunch quits an own service, refreshes, and launches once', async () => {
  const h = harness('linux');
  const own = { status: 200, body: { ok: true, service: 'FRACTURED_REALMS_COMPANION_V1', revision: '0'.repeat(64), host: '127.0.0.1', port: 48766 } };
  const responses: Array<HealthResult | Error> = [own, new Error('stopped'), new Error('not running'), healthy()];
  const quitCalls: string[] = [];
  const refreshCalls: unknown[] = [];
  h.options.dependencies.requestHealth = async () => {
    const response = responses.shift() ?? healthy();
    if (response instanceof Error) throw response;
    return response;
  };
  h.options.dependencies.requestQuit = async (url: string) => { quitCalls.push(url); };
  h.options.refresh = async (options: unknown) => { refreshCalls.push(options); return {} as never; };
  h.options.noOpen = true;
  await relaunchCompanion(h.options);
  assert.deepEqual(quitCalls, ['http://127.0.0.1:48766/']);
  assert.equal(refreshCalls.length, 1);
  assert.deepEqual(h.calls.map((call) => call.command), ['steam']);
});

test('relaunch with nothing running skips quit', async () => {
  const h = harness('linux');
  let quit = false;
  let probes = 0;
  h.options.dependencies.requestHealth = async () => {
    probes += 1;
    if (probes <= 2) throw new Error('not running');
    return healthy();
  };
  h.options.dependencies.requestQuit = async () => { quit = true; };
  h.options.refresh = async () => ({}) as never;
  h.options.noOpen = true;
  await relaunchCompanion(h.options);
  assert.equal(quit, false);
  assert.deepEqual(h.calls.map((call) => call.command), ['steam']);
});

test('hung health probe resolves at the injected deadline', async () => {
  const h = harness('linux');
  let clock = 0;
  let firstProbe = true;
  h.options.dependencies.requestHealth = () => {
    if (firstProbe) { firstProbe = false; return Promise.reject(new Error('not running')); }
    return new Promise<HealthResult>(() => {});
  };
  h.options.dependencies.setTimer = (callback, milliseconds) => {
    clock += milliseconds;
    callback();
    return undefined;
  };
  h.options.dependencies.clearTimer = () => {};
  await assert.rejects(
    launchCompanion(h.options),
    (error: unknown) => error instanceof OperationalError && error.message.includes('http://127.0.0.1:48766/'),
  );
  assert.equal(clock, 120_000);
});
