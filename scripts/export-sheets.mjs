#!/usr/bin/env node
// Publish the compiled game model (`<stateDir>/model.db`) to a canonical Google
// Spreadsheet so others can build on the data. An Overview landing tab (metadata
// and a hyperlinked table of contents) plus one tab per model table. Zero
// runtime dependencies: a service-account RS256 JWT is signed with node:crypto
// and the Google Sheets REST API is driven with the global fetch, so no npm
// package is added. `--dry-run` reports the tabs offline without credentials.
//
// Config (convention, no config file):
//   FRACTURED_SHEETS_SPREADSHEET_ID  target spreadsheet id (required to publish)
//   FRACTURED_SHEETS_CREDENTIALS     service-account JSON path, else the default
//                                    ~/.config/fractured-realms-companion/google-credentials.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

export const OVERVIEW_TITLE = 'Overview';

/** Human one-liners for each model table; unknown tables fall back to a humanized name. */
const TABLE_DESCRIPTIONS = {
  achievements: 'Achievements: names, categories, and unlock conditions.',
  action_inputs: 'Items each skill action consumes, per run.',
  action_outputs: 'Items each skill action produces, per run.',
  action_rares: 'Rare bonus drops from skill actions, with chances.',
  actions: 'Every skill action: level, XP, interval, and gating.',
  agility_courses: 'Agility courses and their obstacles.',
  bags: 'Storage bags: size, cost, and agility requirement.',
  boons: 'Prayer boons and the skill bonuses they grant.',
  building_upgrade_costs: 'Per-item material costs for building upgrades.',
  building_upgrades: 'Town building upgrade levels and effects.',
  buildings: 'Town buildings and their upgrade tracks.',
  chart_supply_tiers: 'Cartography supply tiers used to chart maps.',
  digsites: 'Archaeology dig sites and level requirements.',
  enemies: 'Enemies: HP, combat stats, and tags.',
  enemy_attacks: 'Per-enemy attack tables (weights and effects).',
  enemy_drops: 'Loot each enemy drops, with chances.',
  equipment: 'Armour: slot, defence, requirements, and secret flag.',
  food: 'Cooked food and the HP each item heals.',
  grand_reward: 'The grand reward and its bonuses.',
  items: 'Master item catalog: label, type, value, and icon.',
  machine_costs: 'Per-item build costs for skill machines.',
  machines: 'Skill machines and the buffs they provide.',
  maps: 'Cartography maps (regular and deep) and their tiers.',
  obstacles: 'Individual agility obstacles: XP and interval.',
  offline_gold: 'Offline gold earned per minute, by level.',
  outpost_xp: 'Outpost building XP bonuses, by level.',
  patterns: 'Glyphweaving patterns and their sources.',
  potions: 'Potions: effect family, magnitude, and durations.',
  prestige_bonuses: 'Native and cross bonuses unlocked at each prestige rank.',
  prestige_config: 'Global prestige rules: max rank and per-rank XP/speed bonus.',
  prestige_thresholds: 'Cumulative prestige XP required for each rank, per skill.',
  prestige_tracks: 'Per-skill prestige tracks: category and max prestige XP.',
  recipe_meals: 'Cooking recipe meals: inputs, XP, and healing.',
  restorations: 'Prayer restorations: inputs and outputs.',
  seal_buffs: 'Individual buffs granted by each mastery seal.',
  seals: 'Mastery seals and the skills they empower.',
  shop: 'Shop-buyable items and their prices.',
  skills: 'All skills: id, name, and category.',
  strings: 'Localized display strings (names and descriptions).',
  titles: 'Earnable titles: mastery, prestige, and special.',
  tools: 'Skill tools: level, XP/speed bonuses, and cost.',
  xp_table: 'Level-to-XP thresholds (1..99).',
  zones: 'Combat zones and the enemies within.',
};

/** A readable description for a table, falling back to a humanized name. */
export function describeTable(name) {
  return TABLE_DESCRIPTIONS[name] ?? `${name.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())} data.`;
}

/** Read publish metadata from the staged pack manifest and the CLI package. */
export function readMetadata() {
  const load = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
  const pack = load(join(stateDir(), 'pack', 'pack.json'));
  const pkg = load(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
  return {
    buildId: pack.build_id ?? 'unknown',
    dataSchema: pack.schema_version ?? 'unknown',
    generatedAt: pack.generated_at ?? 'unknown',
    cliVersion: pkg.version ?? 'unknown',
  };
}

/**
 * Build the Overview landing tab: a grid of USER_ENTERED cells with a title, a
 * metadata block, usage notes, and a hyperlinked table of contents. `toc` entries
 * carry each tab's { title, rows, sheetId, description }. Returns the grid plus the
 * row indices that should be rendered bold.
 */
export function buildOverview(metadata, toc) {
  const totalRows = toc.reduce((sum, entry) => sum + entry.rows, 0);
  const grid = [];
  const boldRows = [];
  const heading = (row) => { boldRows.push(grid.length); grid.push(row); };
  heading(['Fractured Realms \u2014 Game Data']);
  grid.push([]);
  grid.push(['Steam build', String(metadata.buildId)]);
  grid.push(['Data generated (UTC)', String(metadata.generatedAt)]);
  grid.push(['Data tool version', String(metadata.cliVersion)]);
  grid.push(['Data schema', String(metadata.dataSchema)]);
  grid.push(['Tables', toc.length, 'Total data rows', totalRows]);
  grid.push([]);
  heading(['How to use']);
  grid.push(['Each tab below is one dataset. Row 1 is the header \u2014 use the filter buttons to sort and filter.']);
  grid.push(["Columns ending in _json (e.g. data_json) hold each record's full raw data as JSON."]);
  grid.push(['Durations and intervals are in milliseconds; XP and values are raw game numbers.']);
  grid.push(['To build on this data: File \u2192 Make a copy, or read the tabs via the Google Sheets API.']);
  grid.push([]);
  heading(['Contents']);
  heading(['Tab', 'Rows', 'Description']);
  for (const entry of toc) grid.push([`=HYPERLINK("#gid=${entry.sheetId}","${entry.title}")`, entry.rows, entry.description]);
  grid.push([]);
  grid.push(['Generated automatically \u2014 edits here are overwritten on each publish.']);
  return { title: OVERVIEW_TITLE, grid, boldRows };
}

/** Frozen bold header, banding, and a filter for one written data tab. */
export function dataTabRequests(sheetId, rowCount, colCount) {
  const range = { sheetId, startRowIndex: 0, endRowIndex: rowCount + 1, startColumnIndex: 0, endColumnIndex: colCount };
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
    { setBasicFilter: { filter: { range } } },
    { addBanding: { bandedRange: { range, rowProperties: { headerColor: { red: 0.85, green: 0.85, blue: 0.85 }, firstBandColor: { red: 1, green: 1, blue: 1 }, secondBandColor: { red: 0.96, green: 0.96, blue: 0.96 } } } } },
  ];
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Authorized JSON fetch against the Sheets API. Retries with exponential backoff on
 * 429/503: a full publish issues more write requests than Google's ~60/min/user quota
 * allows, so without backoff the final tabs fail with RATE_LIMIT_EXCEEDED. `deps` is
 * injectable for tests.
 */
export async function sheetsFetch(url, token, init = {}, deps = {}) {
  const { fetchImpl = fetch, sleepImpl = sleep, maxRetries = 6 } = deps;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
      await sleepImpl(Math.min(64_000, 1_000 * 2 ** attempt));
      continue;
    }
    const hint = response.status === 403 || response.status === 404
      ? ' (check FRACTURED_SHEETS_SPREADSHEET_ID and that the sheet is shared with the service-account email)'
      : '';
    throw new Error(`Sheets API ${response.status}${hint}: ${text}`);
  }
}

/**
 * Publish the model to the spreadsheet: prune tabs for retired tables, ensure the
 * Overview landing tab and one tab per table exist, write values (Overview with
 * USER_ENTERED so its links resolve, data tabs RAW), then format data tabs with a
 * frozen bold header, banding, and a filter. Fail-soft per tab; returns failed titles.
 */
export async function publishSheets(spreadsheetId, credsPath, sheets, metadata = {}, write = (text) => process.stdout.write(text)) {
  const token = await getAccessToken(credsPath);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const meta = await sheetsFetch(`${base}?fields=sheets.properties(sheetId,title),sheets.bandedRanges(bandedRangeId)`, token);
  const existing = new Map((meta.sheets ?? []).map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  const staleBandings = (meta.sheets ?? []).flatMap((sheet) => (sheet.bandedRanges ?? []).map((band) => band.bandedRangeId));

  // Mirror the model exactly, but always keep the Overview landing tab: drop tabs
  // for tables that no longer exist so the canonical sheet never carries stale
  // registries. Sheets requires at least one tab, so a book-emptying delete is skipped.
  const desired = new Set([OVERVIEW_TITLE, ...sheets.map((sheet) => sheet.title)]);
  const stale = [...existing].filter(([title]) => !desired.has(title));
  if (stale.length > 0 && stale.length < existing.size) {
    const body = JSON.stringify({ requests: stale.map(([, sheetId]) => ({ deleteSheet: { sheetId } })) });
    await sheetsFetch(`${base}:batchUpdate`, token, { method: 'POST', body });
    for (const [title] of stale) { existing.delete(title); write(`  ${title}: removed (retired table)\n`); }
  }

  const missing = [OVERVIEW_TITLE, ...sheets.map((sheet) => sheet.title)].filter((title) => !existing.has(title));
  if (missing.length > 0) {
    const body = JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) });
    const result = await sheetsFetch(`${base}:batchUpdate`, token, { method: 'POST', body });
    result.replies.forEach((reply, index) => existing.set(missing[index], reply.addSheet.properties.sheetId));
  }

  const failures = [];
  const written = [];

  // Overview first: build its table of contents from the now-known tab ids and write
  // it with USER_ENTERED so the HYPERLINK navigation formulas resolve.
  const toc = sheets.map((sheet) => ({ title: sheet.title, rows: sheet.rows.length, sheetId: existing.get(sheet.title), description: describeTable(sheet.title) }));
  const overview = buildOverview(metadata, toc);
  try {
    await sheetsFetch(`${base}/values/${encodeURIComponent(`'${overview.title}'`)}:clear`, token, { method: 'POST', body: '{}' });
    await sheetsFetch(`${base}/values/${encodeURIComponent(`'${overview.title}'!A1`)}?valueInputOption=USER_ENTERED`, token, { method: 'PUT', body: JSON.stringify({ values: overview.grid }) });
    write(`  ${overview.title}: landing page\n`);
  } catch (error) {
    failures.push(overview.title);
    write(`  ${overview.title}: FAILED \u2014 ${error instanceof Error ? error.message : String(error)}\n`);
  }

  for (const sheet of sheets) {
    try {
      const range = encodeURIComponent(`'${sheet.title}'`);
      await sheetsFetch(`${base}/values/${range}:clear`, token, { method: 'POST', body: '{}' });
      const a1 = encodeURIComponent(`'${sheet.title}'!A1`);
      const values = [sheet.header, ...sheet.rows.map((row) => row.map(toCell))];
      await sheetsFetch(`${base}/values/${a1}?valueInputOption=RAW`, token, { method: 'PUT', body: JSON.stringify({ values }) });
      written.push(sheet);
      write(`  ${sheet.title}: ${sheet.rows.length} rows\n`);
    } catch (error) {
      failures.push(sheet.title);
      write(`  ${sheet.title}: FAILED \u2014 ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  // One batched formatting pass: clear stale banding, format the Overview, and give
  // every written data tab a frozen bold header, banding, and a filter.
  const requests = staleBandings.map((bandedRangeId) => ({ deleteBanding: { bandedRangeId } }));
  const overviewId = existing.get(overview.title);
  if (overviewId !== undefined && !failures.includes(overview.title)) {
    const overviewCols = Math.max(1, ...overview.grid.map((row) => row.length));
    // Reset formatting first: values:clear leaves prior bold in place, which would
    // misalign when rows shift between publishes.
    requests.push({ repeatCell: { range: { sheetId: overviewId, startRowIndex: 0, endRowIndex: overview.grid.length, startColumnIndex: 0, endColumnIndex: overviewCols }, cell: { userEnteredFormat: { textFormat: { bold: false, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(bold,fontSize)' } });
    requests.push({ updateSheetProperties: { properties: { sheetId: overviewId, index: 0, gridProperties: { frozenRowCount: 1 } }, fields: 'index,gridProperties.frozenRowCount' } });
    requests.push({ repeatCell: { range: { sheetId: overviewId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat(bold,fontSize)' } });
    for (const row of overview.boldRows.slice(1)) requests.push({ repeatCell: { range: { sheetId: overviewId, startRowIndex: row, endRowIndex: row + 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
  }
  for (const sheet of written) {
    const sheetId = existing.get(sheet.title);
    if (sheetId === undefined) continue;
    requests.push(...dataTabRequests(sheetId, sheet.rows.length, sheet.header.length));
  }
  if (requests.length > 0) await sheetsFetch(`${base}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests }) });

  return failures;
}

const USAGE = [
  'Usage: export-sheets [--dry-run]',
  '',
  'Env:',
  '  FRACTURED_SHEETS_SPREADSHEET_ID  target spreadsheet id (required only on the first',
  '                                   publish; remembered in the config dir afterward)',
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

/** Machine-local config directory, shared with the service-account credentials. */
export function configDir() {
  return join(homedir(), '.config', 'fractured-realms-companion');
}

/** Path of the remembered spreadsheet id. */
export function spreadsheetIdPath(dir = configDir()) {
  return join(dir, 'spreadsheet-id');
}

/** Read the remembered spreadsheet id, or null when none has been saved. */
export function readPersistedSpreadsheetId(dir = configDir()) {
  try {
    const value = readFileSync(spreadsheetIdPath(dir), 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Remember a spreadsheet id so future runs need no env var. */
export function persistSpreadsheetId(id, dir = configDir()) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(spreadsheetIdPath(dir), `${id}\n`);
}

/**
 * Resolve the target spreadsheet: an explicit env var wins, else the remembered id.
 * Pure so callers own the IO; `source` lets the caller persist a freshly supplied id.
 */
export function resolveSpreadsheetId({ envId, persistedId } = {}) {
  const env = typeof envId === 'string' ? envId.trim() : '';
  if (env.length > 0) return { id: env, source: 'env' };
  const persisted = typeof persistedId === 'string' ? persistedId.trim() : '';
  if (persisted.length > 0) return { id: persisted, source: 'file' };
  throw new Error('Set FRACTURED_SHEETS_SPREADSHEET_ID once (it is remembered afterward), or pass --dry-run');
}

function resolveCredentialsPath() {
  const override = process.env.FRACTURED_SHEETS_CREDENTIALS;
  if (override && override.trim().length > 0) return override.trim();
  return join(configDir(), 'google-credentials.json');
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
    process.stdout.write(`Plus an "${OVERVIEW_TITLE}" landing tab (metadata + hyperlinked contents).\n`);
    process.stdout.write('DRY RUN — no changes written\n');
    return 0;
  }

  const { id: spreadsheetId, source } = resolveSpreadsheetId({
    envId: process.env.FRACTURED_SHEETS_SPREADSHEET_ID,
    persistedId: readPersistedSpreadsheetId(),
  });
  const credsPath = resolveCredentialsPath();
  const failures = await publishSheets(spreadsheetId, credsPath, sheets, readMetadata());
  const totalTabs = sheets.length + 1; // data tabs + Overview
  process.stdout.write(`Published ${totalTabs - failures.length}/${totalTabs} tabs to ${spreadsheetId}.\n`);
  if (source === 'env') {
    try { persistSpreadsheetId(spreadsheetId); process.stdout.write(`Remembered spreadsheet id (${spreadsheetIdPath()}); future runs need no env var.\n`); }
    catch { /* persistence is a convenience, not required for the publish */ }
  }
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
