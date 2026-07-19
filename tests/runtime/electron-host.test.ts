import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const FRACTURED_SERVICE = 'FRACTURED_REALMS_COMPANION_V1';
const runtimeDirectory = path.dirname(fileURLToPath(new URL('../../runtime/electron-host.cjs', import.meta.url)));
const { start } = createRequire(import.meta.url)(
  path.join(runtimeDirectory, 'electron-host.cjs'),
) as {
  start: (config: Record<string, unknown>) => Promise<HostHandle>;
};

type HostHandle = {
  url: string;
  close: () => Promise<void>;
};

type Response = {
  statusCode: number;
  body: string;
};

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const address = probe.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function get(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = request(url, { method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, body }));
      response.once('error', reject);
    });
    client.once('error', reject);
    client.end();
  });
}

const OMIT_COMPANION = Symbol('omit companion');

function createConfig(root: string, port: number, companion: unknown = OMIT_COMPANION): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    schema_version: 1,
    id: 'fractured-realms',
    display_name: 'Fractured Realms',
    service: FRACTURED_SERVICE,
    assets_relative_to_runtime: path.relative(runtimeDirectory, root),
    bind_host: '127.0.0.1',
    browser_host: '127.0.0.1',
    port,
    max_request_bytes: 65536,
  };
  if (companion !== OMIT_COMPANION) profile.companion = companion;
  return {
    app: {
      on() {},
      removeListener() {},
    },
    shell: { openExternal: async () => {} },
    path,
    fs,
    profile,
    adapter: {
      id: FRACTURED_SERVICE,
      bridgeScript: () => '<script data-bridge>window.__bridge = true;</script>',
      handleApi: async () => null,
    },
  };
}

function createAssets(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'fractured-companion-host-'));
  writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><script type="module" src="/app.js"></script></head><body></body></html>',
  );
  return root;
}

test('injects the bridge and companion overlay before the first module script', async () => {
  const root = createAssets();
  const handle = await start(createConfig(root, await availablePort(), true));
  try {
    const response = await get(`${handle.url}index.html`);
    assert.equal(response.statusCode, 200);
    const bridge = response.body.indexOf('<script data-bridge>');
    const overlay = response.body.indexOf('<script type="module" src="/companion/overlay.js"></script>');
    const originalModule = response.body.indexOf('<script type="module" src="/app.js"></script>');
    assert.ok(bridge >= 0);
    assert.ok(overlay > bridge);
    assert.ok(originalModule > overlay);

    const health = await get(`${handle.url}health`);
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), {
      ok: true,
      service: FRACTURED_SERVICE,
      host: '127.0.0.1',
      port: Number(new URL(handle.url).port),
    });
  } finally {
    await handle.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('omits the companion overlay when companion is false', async () => {
  const root = createAssets();
  const handle = await start(createConfig(root, await availablePort(), false));
  try {
    const response = await get(`${handle.url}index.html`);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<script data-bridge>/);
    assert.doesNotMatch(response.body, /\/companion\/overlay\.js/);
    assert.ok(response.body.indexOf('<script data-bridge>') < response.body.indexOf('<script type="module" src="/app.js"></script>'));
  } finally {
    await handle.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a profile without companion', async () => {
  const root = createAssets();
  try {
    await assert.rejects(
      start(createConfig(root, await availablePort())),
      /Invalid browser profile: missing companion/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a profile with a nonboolean companion value', async () => {
  const root = createAssets();
  try {
    await assert.rejects(
      start(createConfig(root, await availablePort(), 'true')),
      /Invalid browser profile companion/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
