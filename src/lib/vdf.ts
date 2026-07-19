import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { parseValveObject, type ValveObject } from './acf.ts';

function readUtf8(path: string): string {
  try {
    const bytes = readFileSync(path);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '';
  }
}

/** Read Steam library locations; malformed or unavailable files are ignored. */
export function readLibraryFolders(path: string): string[] {
  const source = readUtf8(path);
  if (source.length === 0) return [];
  let root: ValveObject;
  try {
    root = parseValveObject(source, 'libraryfolders');
  } catch {
    return [];
  }

  const entries: Array<{ index: bigint; path: string }> = [];
  for (const [key, value] of Object.entries(root)) {
    if (!/^\d+$/.test(key)) continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const libraryPath = value.path;
    if (typeof libraryPath !== 'string') return [];
    if (libraryPath.length > 0) entries.push({ index: BigInt(key), path: libraryPath });
  }
  entries.sort((left, right) => left.index < right.index ? -1 : left.index > right.index ? 1 : 0);
  return entries.map((entry) => entry.path);
}
