import { createRequire } from 'node:module';

/** Common database surface shared by the Node and Bun SQLite drivers. */
export interface SqlDb {
  exec(sql: string): void;
  run(sql: string, ...params: unknown[]): void;
  all(sql: string, ...params: unknown[]): unknown[];
  close(): void;
}

interface PreparedStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface NativeDatabase {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  close(): void;
}

type DatabaseConstructor = new (path: string) => NativeDatabase;

const require = createRequire(import.meta.url);
let cachedDriver: DatabaseConstructor | null | undefined;

function loadDriver(): DatabaseConstructor | null {
  if (cachedDriver !== undefined) return cachedDriver;

  const moduleName = process.versions.bun ? 'bun:sqlite' : 'node:sqlite';
  const constructorName = process.versions.bun ? 'Database' : 'DatabaseSync';

  try {
    const loaded: unknown = require(moduleName);
    if (typeof loaded !== 'object' || loaded === null) {
      cachedDriver = null;
      return cachedDriver;
    }
    const candidate: unknown = Reflect.get(loaded, constructorName);
    cachedDriver = typeof candidate === 'function' ? candidate as DatabaseConstructor : null;
  } catch {
    cachedDriver = null;
  }

  return cachedDriver;
}

function wrapDatabase(database: NativeDatabase): SqlDb {
  return {
    exec(sql: string): void {
      database.exec(sql);
    },
    run(sql: string, ...params: unknown[]): void {
      database.prepare(sql).run(...params);
    },
    all(sql: string, ...params: unknown[]): unknown[] {
      return database.prepare(sql).all(...params);
    },
    close(): void {
      database.close();
    },
  };
}

/** Whether the runtime's builtin SQLite driver can be loaded. */
export function sqliteAvailable(): boolean {
  return loadDriver() !== null;
}

/** Open a database, returning null when this runtime has no builtin SQLite driver. */
export function openDatabase(path: string): SqlDb | null {
  const Database = loadDriver();
  if (Database === null) return null;
  return wrapDatabase(new Database(path));
}
