import vm from 'node:vm';
import { OperationalError } from '../lib/errors.ts';

function matchingClose(source: string, openIndex: number): number {
  const opener = source[openIndex];
  if (opener !== '{' && opener !== '[' && opener !== '(') throw new OperationalError(`literal scanner requires a delimiter at ${openIndex}`);
  const stack: string[] = [opener];
  let i = openIndex + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { i += 2; while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); if (end < 0) throw new OperationalError('unterminated block comment while scanning literal'); i = end + 2; continue; }
    if (ch === '"' || ch === "'") { i = skipQuoted(source, i, ch); continue; }
    if (ch === '`') { i = skipTemplate(source, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { stack.push(ch); i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      const expected = ch === '}' ? '{' : ch === ']' ? '[' : '(';
      if (stack.at(-1) !== expected) throw new OperationalError('mismatched delimiters while scanning literal');
      stack.pop(); if (stack.length === 0) return i; i++; continue;
    }
    i++;
  }
  throw new OperationalError('unterminated literal');
}

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) { if (source[i] === '\\') { i += 2; continue; } if (source[i] === quote) return i + 1; i++; }
  throw new OperationalError('unterminated string while scanning literal');
}

function skipTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === '`') return i + 1;
    if (source[i] === '$' && source[i + 1] === '{') { i = skipInterpolation(source, i + 2); continue; }
    i++;
  }
  throw new OperationalError('unterminated template while scanning literal');
}

function skipInterpolation(source: string, start: number): number {
  const stack: string[] = [];
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { i += 2; while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); if (end < 0) throw new OperationalError('unterminated block comment in template expression'); i = end + 2; continue; }
    if (ch === '"' || ch === "'") { i = skipQuoted(source, i, ch); continue; }
    if (ch === '`') { i = skipTemplate(source, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { stack.push(ch); i++; continue; }
    if (ch === '}') { if (stack.length === 0) return i + 1; if (stack.at(-1) !== '{') throw new OperationalError('mismatched template expression delimiter'); stack.pop(); i++; continue; }
    if (ch === ']' || ch === ')') { const expected = ch === ']' ? '[' : '('; if (stack.at(-1) !== expected) throw new OperationalError('mismatched template expression delimiter'); stack.pop(); i++; continue; }
    i++;
  }
  throw new OperationalError('unterminated template expression');
}

function previousSignificant(source: string, index: number): string {
  let i = index - 1;
  while (i >= 0) {
    if (/\s/.test(source[i])) { i--; continue; }
    if (i >= 1 && source[i - 1] === '*' && source[i] === '/') { const begin = source.lastIndexOf('/*', i - 1); if (begin < 0) return ''; i = begin - 1; continue; }
    return source[i];
  }
  return '';
}

function isLiteralOpener(source: string, index: number): boolean {
  const prev = previousSignificant(source, index);
  if (prev === '=' || prev === ':' || prev === ',' || prev === '(' || prev === '[') return true;
  return /\breturn\s*$/.test(source.slice(Math.max(0, index - 8), index));
}

export function sliceLiteral(source: string, anchorIndex: number): string {
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= source.length) throw new OperationalError(`literal anchor index is out of range: ${anchorIndex}`);
  let direct = anchorIndex;
  while (direct < source.length && /\s/.test(source[direct])) direct++;
  if (source[direct] !== '{' && source[direct] !== '[') {
    const equals = source.indexOf('=', anchorIndex);
    if (equals >= anchorIndex && equals - anchorIndex < 4) { direct = equals + 1; while (direct < source.length && /\s/.test(source[direct])) direct++; }
  }
  if ((source[direct] === '{' || source[direct] === '[') && direct <= anchorIndex + 3) return source.slice(direct, matchingClose(source, direct) + 1);

  const stack: Array<{ open: string; index: number; literal: boolean }> = [];
  let i = 0;
  while (i < anchorIndex) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { i += 2; while (i < anchorIndex && source[i] !== '\n' && source[i] !== '\r') i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); if (end < 0 || end >= anchorIndex) break; i = end + 2; continue; }
    if (ch === '"' || ch === "'") { i = skipQuoted(source, i, ch); continue; }
    if (ch === '`') { i = skipTemplate(source, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { stack.push({ open: ch, index: i, literal: ch !== '(' && isLiteralOpener(source, i) }); i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { const expected = ch === '}' ? '{' : ch === ']' ? '[' : '('; if (stack.at(-1)?.open === expected) stack.pop(); i++; continue; }
    i++;
  }
  for (let n = stack.length - 1; n >= 0; n--) { const candidate = stack[n]; if (!candidate.literal) continue; const close = matchingClose(source, candidate.index); if (close >= anchorIndex) return source.slice(candidate.index, close + 1); }
  throw new OperationalError('could not locate literal for anchor');
}

function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'undefined') return null;
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') throw new Error(`non-JSON value (${typeof value})`);
  if (typeof value !== 'object') throw new Error('unsupported value');
  const object = value as object;
  if (seen.has(object)) throw new Error('cyclic value');
  seen.add(object);
  try {
    if (Array.isArray(value)) return Array.from(value, (entry) => normalize(entry, seen));
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value)) output[key] = normalize((value as Record<string, unknown>)[key], seen);
    return output;
  } finally { seen.delete(object); }
}

export function evalLiteral(text: string, datasetName: string): unknown {
  try { return normalize(vm.runInNewContext(`(${text})`, Object.create(null), { timeout: 5000 }), new WeakSet<object>()); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); throw new OperationalError(`failed to evaluate ${datasetName} dataset: ${detail}`, { cause: error }); }
}
