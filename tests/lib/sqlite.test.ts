import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, sqliteAvailable } from '../../src/lib/sqlite.ts';

test('reports the builtin SQLite driver as available in the development runtime', () => {
  assert.equal(sqliteAvailable(), true);
});

test('creates, inserts, and selects rows through the common database surface', () => {
  const database = openDatabase(':memory:');
  assert.ok(database);
  try {
    database.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    database.run('INSERT INTO entries (id, label) VALUES (?, ?)', 1, 'first');
    database.run('INSERT INTO entries (id, label) VALUES (?, ?)', 2, 'second');

    const rows = database.all('SELECT id, label FROM entries ORDER BY id');
    assert.deepEqual(rows.map((row) => ({ ...(row as Record<string, unknown>) })), [
      { id: 1, label: 'first' },
      { id: 2, label: 'second' },
    ]);
  } finally {
    database.close();
  }
});

test('binds numbers, strings, and null values for run and all', () => {
  const database = openDatabase(':memory:');
  assert.ok(database);
  try {
    database.exec('CREATE TABLE values_table (number_value REAL, string_value TEXT, null_value TEXT)');
    database.run('INSERT INTO values_table VALUES (?, ?, ?)', 42.5, 'bound text', null);

    const rows = database.all('SELECT number_value, string_value, null_value FROM values_table');
    assert.deepEqual(rows.map((row) => ({ ...(row as Record<string, unknown>) })), [
      { number_value: 42.5, string_value: 'bound text', null_value: null },
    ]);
  } finally {
    database.close();
  }
});
