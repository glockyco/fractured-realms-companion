#!/usr/bin/env node
// Publish the compiled game model (`<stateDir>/model.db`) to a canonical Google
// Spreadsheet so others can build on the data. One tab per model table. Zero
// runtime dependencies: a service-account RS256 JWT is signed with node:crypto
// and the Google Sheets REST API is driven with the global fetch, so no npm
// package is added. `--dry-run` reports the tabs offline without credentials.
//
// Config (convention, no config file):
//   FRACTURED_SHEETS_SPREADSHEET_ID  target spreadsheet id (required to publish)
//   FRACTURED_SHEETS_CREDENTIALS     service-account JSON path, else the default
//                                    ~/.config/fractured-realms-companion/google-credentials.json
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import crypto from 'node:crypto';
import { stateDir } from './backup-saves.mjs';
import { openDatabase } from '../src/lib/sqlite.ts';

/** Quote a SQLite identifier, matching src/model/sqlite.ts. */
export function quote(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Model tables to publish: every table except the redundant `meta` blob store. */
export function listTables(db) {
  const rows = db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return rows.map((row) => row.name).filter((name) => name !== 'meta');
}

/** Normalize a SQLite value to a spreadsheet cell primitive (lossless). */
export function toCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'string' ? value : String(value);
}

/**
 * Extract one tab from a table: header in schema (cid) order, rows ordered by
 * primary key when present, else natural insertion order. JSON blob columns
 * (data_json, *_json) pass through verbatim so no model information is lost.
 */
export function buildSheet(db, table) {
  const info = db.all(`PRAGMA table_info(${quote(table)})`);
  const header = info.map((col) => col.name);
  const pk = info
    .filter((col) => Number(col.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((col) => quote(col.name));
  const orderBy = pk.length > 0 ? ` ORDER BY ${pk.join(',')}` : '';
  const records = db.all(`SELECT * FROM ${quote(table)}${orderBy}`);
  const rows = records.map((record) => header.map((name) => record[name]));
  return { title: table, header, rows };
}

/** Build every tab from an open model database. */
export function buildAllSheets(db) {
  return listTables(db).map((table) => buildSheet(db, table));
}

/** Build a signed service-account JWT for the Sheets scope. */
export function buildServiceAccountJwt({ clientEmail, privateKey, now }) {
  const seg = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${seg(header)}.${seg(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

/** Exchange a service-account JSON key for an OAuth2 access token. */
async function getAccessToken(credsPath) {
  let creds;
  try {
    creds = JSON.parse(readFileSync(credsPath, 'utf8'));
  } catch (error) {
    throw new Error(`service-account credentials unavailable at ${credsPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error(`service-account credentials at ${credsPath} missing client_email or private_key`);
  }
  const jwt = buildServiceAccountJwt({
    clientEmail: creds.client_email,
    privateKey: creds.private_key,
    now: Math.floor(Date.now() / 1000),
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`token request failed (${response.status}): ${text}`);
  return JSON.parse(text).access_token;
}

/** Authorized JSON fetch against the Sheets API; throws with status + body on failure. */
async function sheetsFetch(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    const hint = response.status === 403 || response.status === 404
      ? ' (check FRACTURED_SHEETS_SPREADSHEET_ID and that the sheet is shared with the service-account email)'
      : '';
    throw new Error(`Sheets API ${response.status}${hint}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Publish every sheet to the spreadsheet: create missing tabs, clear + write
 * each tab, then freeze and bold the header row. Fail-soft per tab. Returns the
 * titles that failed.
 */
export async function publishSheets(spreadsheetId, credsPath, sheets, write = (text) => process.stdout.write(text)) {
  const token = await getAccessToken(credsPath);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const meta = await sheetsFetch(`${base}?fields=sheets.properties(sheetId,title)`, token);
  const existing = new Map((meta.sheets ?? []).map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));

  const toAdd = sheets.filter((sheet) => !existing.has(sheet.title));
  if (toAdd.length > 0) {
    const body = JSON.stringify({ requests: toAdd.map((sheet) => ({ addSheet: { properties: { title: sheet.title } } })) });
    const result = await sheetsFetch(`${base}:batchUpdate`, token, { method: 'POST', body });
    result.replies.forEach((reply, index) => existing.set(toAdd[index].title, reply.addSheet.properties.sheetId));
  }

  const failures = [];
  const written = [];
  for (const sheet of sheets) {
    try {
      const range = encodeURIComponent(`'${sheet.title}'`);
      await sheetsFetch(`${base}/values/${range}:clear`, token, { method: 'POST', body: '{}' });
      const a1 = encodeURIComponent(`'${sheet.title}'!A1`);
      const values = [sheet.header, ...sheet.rows.map((row) => row.map(toCell))];
      await sheetsFetch(`${base}/values/${a1}?valueInputOption=RAW`, token, { method: 'PUT', body: JSON.stringify({ values }) });
      written.push(sheet.title);
      write(`  ${sheet.title}: ${sheet.rows.length} rows\n`);
    } catch (error) {
      failures.push(sheet.title);
      write(`  ${sheet.title}: FAILED — ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  if (written.length > 0) {
    const requests = [];
    for (const title of written) {
      const sheetId = existing.get(title);
      requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
    }
    await sheetsFetch(`${base}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests }) });
  }

  return failures;
}

const USAGE = [
  'Usage: export-sheets [--dry-run]',
  '',
  'Env:',
  '  FRACTURED_SHEETS_SPREADSHEET_ID  target spreadsheet id (required to publish)',
  '  FRACTURED_SHEETS_CREDENTIALS     service-account JSON path',
  '                                   (default: ~/.config/fractured-realms-companion/google-credentials.json)',
  '',
].join('\n');

function openModelDb() {
  const path = join(stateDir(), 'model.db');
  const db = openDatabase(path);
  if (db === null) throw new Error(`model.db unavailable at ${path} (run refresh; requires node:sqlite or bun)`);
  return db;
}

function resolveSpreadsheetId() {
  const id = process.env.FRACTURED_SHEETS_SPREADSHEET_ID;
  if (!id || id.trim().length === 0) throw new Error('FRACTURED_SHEETS_SPREADSHEET_ID is required to publish (or pass --dry-run)');
  return id.trim();
}

function resolveCredentialsPath() {
  const override = process.env.FRACTURED_SHEETS_CREDENTIALS;
  if (override && override.trim().length > 0) return override.trim();
  return join(homedir(), '.config', 'fractured-realms-companion', 'google-credentials.json');
}

/** Print a per-tab row/cell summary of what would be exported. */
export function reportSheets(sheets, write = (text) => process.stdout.write(text)) {
  let totalRows = 0;
  let totalCells = 0;
  for (const sheet of sheets) {
    const cells = (sheet.rows.length + 1) * sheet.header.length;
    totalRows += sheet.rows.length;
    totalCells += cells;
    write(`  ${sheet.title}: ${sheet.rows.length} rows, ${cells} cells\n`);
  }
  write(`${sheets.length} tabs, ${totalRows} rows, ${totalCells} cells\n`);
}

async function main(argv = process.argv.slice(2)) {
  let dryRun = false;
  try {
    const parsed = parseArgs({ args: [...argv], options: { 'dry-run': { type: 'boolean' } }, strict: true, allowPositionals: false });
    dryRun = parsed.values['dry-run'] === true;
  } catch {
    process.stderr.write(USAGE);
    return 2;
  }

  const db = openModelDb();
  let sheets;
  try {
    sheets = buildAllSheets(db);
  } finally {
    db.close();
  }

  if (dryRun) {
    reportSheets(sheets);
    process.stdout.write('DRY RUN — no changes written\n');
    return 0;
  }

  const spreadsheetId = resolveSpreadsheetId();
  const credsPath = resolveCredentialsPath();
  const failures = await publishSheets(spreadsheetId, credsPath, sheets);
  process.stdout.write(`Published ${sheets.length - failures.length}/${sheets.length} tabs to ${spreadsheetId}.\n`);
  if (failures.length > 0) {
    process.stderr.write(`Failed tabs: ${failures.join(', ')}\n`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
