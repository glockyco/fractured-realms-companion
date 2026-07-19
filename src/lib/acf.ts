import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { ConfigurationError, OperationalError } from './errors.ts';

export interface ValveObject {
  [key: string]: string | ValveObject;
}
export type ValveValue = string | ValveObject;

interface Token {
  readonly kind: 'string' | '{' | '}';
  readonly value: string;
  readonly offset: number;
}

class ValveSyntaxError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === undefined) break;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '{' || character === '}') {
      tokens.push({ kind: character, value: character, offset: index });
      index += 1;
      continue;
    }
    if (character !== '"') {
      throw new ValveSyntaxError(`expected quoted token at offset ${index}`);
    }

    const start = index;
    index += 1;
    let value = '';
    let closed = false;
    while (index < source.length) {
      const current = source[index];
      if (current === undefined) break;
      if (current === '"') {
        index += 1;
        tokens.push({ kind: 'string', value, offset: start });
        closed = true;
        break;
      }
      if (current === '\r' || current === '\n') {
        throw new ValveSyntaxError(`unterminated quoted token at offset ${start}`);
      }
      if (current === '\\') {
        index += 1;
        const escaped = source[index];
        if (escaped === undefined) {
          throw new ValveSyntaxError(`unterminated escape at offset ${start}`);
        }
        if (escaped === '"' || escaped === '\\') value += escaped;
        else value += `\\${escaped}`;
        index += 1;
        continue;
      }
      value += current;
      index += 1;
    }
    if (!closed) throw new ValveSyntaxError(`unterminated quoted token at offset ${start}`);
  }
  return tokens;
}

function defineField(target: ValveObject, key: string, value: ValveValue): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function parseObject(tokens: readonly Token[], start: number): { value: ValveObject; next: number } {
  const value: ValveObject = {};
  let index = start;
  while (index < tokens.length && tokens[index]?.kind !== '}') {
    const key = tokens[index];
    if (key === undefined || key.kind !== 'string') {
      throw new ValveSyntaxError(`expected quoted key at offset ${key?.offset ?? 'end of input'}`);
    }
    index += 1;
    if (Object.hasOwn(value, key.value)) {
      throw new ValveSyntaxError(`duplicate definition for ${JSON.stringify(key.value)}`);
    }
    const next = tokens[index];
    if (next === undefined) throw new ValveSyntaxError(`missing value for ${JSON.stringify(key.value)}`);
    if (next.kind === '{') {
      const nested = parseObject(tokens, index + 1);
      defineField(value, key.value, nested.value);
      index = nested.next;
    } else if (next.kind === 'string') {
      defineField(value, key.value, next.value);
      index += 1;
    } else {
      throw new ValveSyntaxError(`invalid value for ${JSON.stringify(key.value)}`);
    }
  }
  if (tokens[index]?.kind !== '}') throw new ValveSyntaxError('unterminated object');
  return { value, next: index + 1 };
}

/** Parse one quoted Valve object, rejecting unsupported syntax and duplicates. */
export function parseValveObject(source: string, expectedRoot?: string): ValveObject {
  let tokens: Token[];
  try {
    tokens = tokenize(source);
    if (tokens.length === 0) throw new ValveSyntaxError('empty object');
    const root = tokens[0];
    if (root?.kind !== 'string') throw new ValveSyntaxError('object must start with a quoted root key');
    if (expectedRoot !== undefined && root.value !== expectedRoot) {
      throw new ValveSyntaxError(`object must start with ${JSON.stringify(expectedRoot)}`);
    }
    if (tokens[1]?.kind !== '{') throw new ValveSyntaxError('root key must be followed by an object');
    const parsed = parseObject(tokens, 2);
    if (parsed.next !== tokens.length) {
      const trailing = tokens[parsed.next];
      throw new ValveSyntaxError(`unexpected token at offset ${trailing?.offset ?? 'end of input'}`);
    }
    return parsed.value;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigurationError(`malformed Valve object: ${message}`, { cause: error });
  }
}

const REQUIRED_FIELDS = ['appid', 'name', 'installdir', 'buildid'] as const;
export type SteamManifest = { appid: string; name: string; installdir: string; buildid: string };

function readUtf8(path: string, description: string): string {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new OperationalError(`cannot read ${description}: ${path}`, { cause: error });
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new OperationalError(`cannot decode ${description} as UTF-8: ${path}`, { cause: error });
  }
}

/** Read and validate the required top-level values from a Steam app manifest. */
export function readSteamManifest(path: string): SteamManifest {
  const source = readUtf8(path, 'Steam app manifest');
  let fields: ValveObject;
  try {
    fields = parseValveObject(source, 'AppState');
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw new ConfigurationError(`malformed Steam app manifest ${path}: ${error.message}`, { cause: error });
    }
    throw error;
  }
  const missing = REQUIRED_FIELDS.filter((field) => !Object.hasOwn(fields, field));
  if (missing.length > 0) {
    throw new ConfigurationError(`Steam app manifest missing required field(s): ${missing.join(', ')}`);
  }
  const result = {} as SteamManifest;
  for (const field of REQUIRED_FIELDS) {
    const value = fields[field];
    if (typeof value !== 'string') {
      throw new ConfigurationError(`Steam app manifest required field is not a value: ${field}`);
    }
    if (value.length === 0) {
      throw new ConfigurationError(`Steam app manifest required field is empty: ${field}`);
    }
    result[field] = value;
  }
  return result;
}
