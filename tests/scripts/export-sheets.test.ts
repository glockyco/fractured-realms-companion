import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { openDatabase, sqliteAvailable } from '../../src/lib/sqlite.ts';
import { listTables, buildSheet, toCell, buildAllSheets, buildServiceAccountJwt, sheetsFetch, resolveSpreadsheetId, readPersistedSpreadsheetId, persistSpreadsheetId, buildOverview, describeTable, dataTabRequests } from '../../scripts/export-sheets.mjs';

const HAS_SQLITE = sqliteAvailable();

/** Create a throwaway model.db-shaped fixture with a meta blob, a PK table, and a child table. */
function fixtureDb(path: string): void {
  const db = openDatabase(path)!;
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT, data_json TEXT NOT NULL);
    CREATE TABLE action_inputs (action_id TEXT, item_id TEXT, qty REAL);
  `);
  db.run('INSERT INTO meta (key, json) VALUES (?, ?)', 'patterns', '{}');
  db.run('INSERT INTO skills (id, name, data_json) VALUES (?, ?, ?)', 'woodcutting', 'Woodcutting', '{"category":"action"}');
  db.run('INSERT INTO skills (id, name, data_json) VALUES (?, ?, ?)', 'bounty', null, '{"category":"support"}');
  db.run('INSERT INTO action_inputs (action_id, item_id, qty) VALUES (?, ?, ?)', 'chop', 'twig', 1);
  db.close();
}

test('listTables returns model tables and excludes meta', { skip: !HAS_SQLITE }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'frc-sheets-'));
  try {
    const path = join(dir, 'model.db');
    fixtureDb(path);
    const db = openDatabase(path)!;
    try {
      assert.deepEqual(listTables(db), ['action_inputs', 'skills']);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSheet emits schema-order header, PK-ordered rows, lossless cells', { skip: !HAS_SQLITE }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'frc-sheets-'));
  try {
    const path = join(dir, 'model.db');
    fixtureDb(path);
    const db = openDatabase(path)!;
    try {
      const sheet = buildSheet(db, 'skills');
      assert.equal(sheet.title, 'skills');
      assert.deepEqual(sheet.header, ['id', 'name', 'data_json']);
      // Ordered by the id primary key: bounty before woodcutting.
      assert.deepEqual(sheet.rows.map((row) => row[0]), ['bounty', 'woodcutting']);
      // NULL name normalizes to an empty cell; the JSON blob passes through verbatim.
      const bounty = sheet.rows[0];
      assert.equal(toCell(bounty[1]), '');
      assert.equal(bounty[2], '{"category":"support"}');
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('toCell normalizes SQLite value kinds', () => {
  assert.equal(toCell(null), '');
  assert.equal(toCell(undefined), '');
  assert.equal(toCell(42), 42);
  assert.equal(toCell(7n), 7);
  assert.equal(toCell('{"a":1}'), '{"a":1}');
});

test('buildAllSheets covers every non-meta table', { skip: !HAS_SQLITE }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'frc-sheets-'));
  try {
    const path = join(dir, 'model.db');
    fixtureDb(path);
    const db = openDatabase(path)!;
    try {
      assert.deepEqual(buildAllSheets(db).map((sheet) => sheet.title), ['action_inputs', 'skills']);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --dry-run prints an offline summary from the state model.db', { skip: !HAS_SQLITE }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'frc-sheets-'));
  try {
    const stateHome = join(dir, 'state');
    mkdirSync(join(stateHome, 'fractured-realms-companion'), { recursive: true });
    fixtureDb(join(stateHome, 'fractured-realms-companion', 'model.db'));
    const result = spawnSync(process.execPath, ['scripts/export-sheets.mjs', '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, XDG_STATE_HOME: stateHome, LOCALAPPDATA: stateHome },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skills: 2 rows/);
    assert.match(result.stdout, /2 tabs,/);
    assert.match(result.stdout, /DRY RUN/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildServiceAccountJwt signs verifiable claims for the Sheets scope', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 1_700_000_000;
  const jwt = buildServiceAccountJwt({
    clientEmail: 'svc@example.iam.gserviceaccount.com',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    now,
  });
  const [headerSeg, claimsSeg, signatureSeg] = jwt.split('.');
  assert.ok(headerSeg && claimsSeg && signatureSeg);
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerSeg}.${claimsSeg}`),
    publicKey,
    Buffer.from(signatureSeg, 'base64url'),
  );
  assert.equal(verified, true);
  const header = JSON.parse(Buffer.from(headerSeg, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(claimsSeg, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'RS256');
  assert.equal(claims.iss, 'svc@example.iam.gserviceaccount.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.iat, now);
  assert.equal(claims.exp, now + 3600);
});

test('sheetsFetch retries on 429 with backoff then returns the parsed body', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls <= 2) return { ok: false, status: 429, text: async () => 'rate limited' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ done: true }) };
  };
  const slept: number[] = [];
  const result = await sheetsFetch('https://sheets/x', 'tok', {}, { fetchImpl, sleepImpl: async (ms: number) => { slept.push(ms); }, maxRetries: 6 });
  assert.deepEqual(result, { done: true });
  assert.equal(calls, 3, 'retried until success');
  assert.deepEqual(slept, [1000, 2000], 'exponential backoff between retries');
});

test('sheetsFetch throws immediately on a non-retryable status', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: false, status: 403, text: async () => 'forbidden' }; };
  await assert.rejects(
    () => sheetsFetch('https://sheets/x', 'tok', {}, { fetchImpl, sleepImpl: async () => {}, maxRetries: 6 }),
    /Sheets API 403/,
  );
  assert.equal(calls, 1, 'no retry on 403');
});

test('sheetsFetch gives up after maxRetries of persistent rate limiting', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: false, status: 429, text: async () => 'rate limited' }; };
  await assert.rejects(
    () => sheetsFetch('https://sheets/x', 'tok', {}, { fetchImpl, sleepImpl: async () => {}, maxRetries: 2 }),
    /Sheets API 429/,
  );
  assert.equal(calls, 3, 'initial attempt plus two retries');
});

test('resolveSpreadsheetId prefers env, then the remembered id, then errors', () => {
  assert.deepEqual(resolveSpreadsheetId({ envId: ' abc ', persistedId: 'xyz' }), { id: 'abc', source: 'env' });
  assert.deepEqual(resolveSpreadsheetId({ envId: '  ', persistedId: ' xyz ' }), { id: 'xyz', source: 'file' });
  assert.throws(() => resolveSpreadsheetId({ envId: '', persistedId: '' }), /remembered/);
});

test('persistSpreadsheetId round-trips through the config dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frc-id-'));
  try {
    assert.equal(readPersistedSpreadsheetId(dir), null);
    persistSpreadsheetId('sheet-123', dir);
    assert.equal(readPersistedSpreadsheetId(dir), 'sheet-123');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('describeTable gives curated text and humanizes unknown tables', () => {
  assert.match(describeTable('titles'), /titles/i);
  assert.equal(describeTable('mystery_widgets'), 'Mystery widgets data.');
});

test('buildOverview lays out metadata, usage, and a hyperlinked contents table', () => {
  const metadata = { buildId: '24337318', dataSchema: 2, generatedAt: '2026-07-24T00:00:00.000Z', cliVersion: '0.2.0' };
  const toc = [
    { title: 'items', rows: 548, sheetId: 111, description: 'Item catalog.' },
    { title: 'titles', rows: 42, sheetId: 222, description: 'Titles.' },
  ];
  const overview = buildOverview(metadata, toc);
  assert.equal(overview.title, 'Overview');
  const flat = overview.grid.map((row) => row.join('\u0001'));
  // metadata surfaced verbatim
  assert.ok(flat.some((line) => line.includes('Steam build') && line.includes('24337318')));
  assert.ok(flat.some((line) => line.includes('Data tool version') && line.includes('0.2.0')));
  // totals computed from the toc
  assert.ok(flat.some((line) => line.includes('Total data rows') && line.includes('590')));
  // contents rows carry a gid HYPERLINK, the row count, and the description
  const itemsRow = overview.grid.find((row) => typeof row[0] === 'string' && row[0].includes('#gid=111'));
  assert.deepEqual(itemsRow, ['=HYPERLINK("#gid=111","items")', 548, 'Item catalog.']);
  // the title row is marked bold
  assert.equal(overview.boldRows[0], 0);
  assert.ok(overview.boldRows.length >= 3);
});

test('dataTabRequests freezes, bolds, filters, and bands the written range', () => {
  const requests = dataTabRequests(7, 100, 4);
  const kinds = requests.map((request) => Object.keys(request)[0]);
  assert.deepEqual(kinds, ['updateSheetProperties', 'repeatCell', 'setBasicFilter', 'addBanding']);
  // filter and banding cover the header + all data rows across every column
  const filterRange = requests.find((r) => r.setBasicFilter).setBasicFilter.filter.range;
  assert.deepEqual(filterRange, { sheetId: 7, startRowIndex: 0, endRowIndex: 101, startColumnIndex: 0, endColumnIndex: 4 });
  assert.equal(requests.find((r) => r.addBanding).addBanding.bandedRange.range.endRowIndex, 101);
});
