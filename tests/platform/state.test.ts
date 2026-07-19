import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { OperationalError } from '../../src/lib/errors.ts';
import { stateDir } from '../../src/platform/state.ts';

test('uses LOCALAPPDATA on Windows', () => {
  assert.equal(
    stateDir({
      platform: 'win32',
      env: { LOCALAPPDATA: '/fixtures/local-app-data' },
      home: '/fixtures/home',
    }),
    resolve('/fixtures/local-app-data', 'fractured-realms-companion'),
  );
});

test('uses XDG_STATE_HOME on macOS and Linux', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    assert.equal(
      stateDir({
        platform,
        env: { XDG_STATE_HOME: '/fixtures/state' },
        home: '/fixtures/home',
      }),
      resolve('/fixtures/state', 'fractured-realms-companion'),
    );
  }
});

test('falls back to the home state directory without XDG_STATE_HOME', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    assert.equal(
      stateDir({ platform, env: {}, home: '/fixtures/home' }),
      resolve('/fixtures/home', '.local', 'state', 'fractured-realms-companion'),
    );
  }
});

test('falls back to the home state directory when XDG_STATE_HOME is empty', () => {
  for (const xdgStateHome of ['', '   ']) {
    assert.equal(
      stateDir({ platform: 'linux', env: { XDG_STATE_HOME: xdgStateHome }, home: '/fixtures/home' }),
      resolve('/fixtures/home', '.local', 'state', 'fractured-realms-companion'),
    );
  }
});

test('rejects a missing or empty Windows LOCALAPPDATA', () => {
  for (const localAppData of [undefined, '']) {
    assert.throws(
      () => stateDir({ platform: 'win32', env: { LOCALAPPDATA: localAppData }, home: '/fixtures/home' }),
      (error: unknown) => error instanceof OperationalError,
    );
  }
});
