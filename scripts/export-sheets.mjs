#!/usr/bin/env node
// Read the compiled game model (`<stateDir>/model.db`) and report every table
// that the Google Sheets publisher would export, one row/cell summary per tab.
// Zero runtime dependencies: Node built-ins plus the shared `openDatabase`
// helper. The publish path (service-account auth + Sheets REST) is layered on in
// a later change; this file owns the lossless table -> tab extraction that both
// the preview and the publisher share.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

const USAGE = 'Usage: export-sheets\n';

function openModelDb() {
  const path = join(stateDir(), 'model.db');
  const db = openDatabase(path);
  if (db === null) throw new Error(`model.db unavailable at ${path} (run refresh; requires node:sqlite or bun)`);
  return db;
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
  if (argv.length > 0) {
    process.stderr.write(USAGE);
    return 2;
  }
  const db = openModelDb();
  try {
    reportSheets(buildAllSheets(db));
  } finally {
    db.close();
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
