import vm from 'node:vm';
import { OperationalError } from '../lib/errors.ts';
import { evalLiteral, sliceLiteral } from './scan.ts';

export interface ExtractedDatasets {
  items: Record<string, Record<string, unknown>>;
  actions: Record<string, unknown[]>;
  skills: unknown[];
  xp: number[];
  buildings: unknown[];
  digsites: unknown[];
  stringsEn: Record<string, string>;
}

const ACTION_SKILLS = ['woodcutting', 'mining', 'fishing', 'foraging', 'trapping', 'archaeology', 'smithing', 'crafting', 'cooking', 'brewing', 'glyphweaving'];
function fail(dataset: string, message: string): never { throw new OperationalError(`${dataset} dataset: ${message}`); }
function anchor(source: string, text: string, dataset: string): number { const first = source.indexOf(text); if (first < 0 || source.indexOf(text, first + 1) >= 0) fail(dataset, first < 0 ? `anchor not found (${text})` : `anchor is ambiguous (${text})`); return first; }
function object(value: unknown, dataset: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(dataset, 'expected object'); return value as Record<string, unknown>; }
function array(value: unknown, dataset: string): unknown[] { if (!Array.isArray(value)) fail(dataset, 'expected array'); return value; }
function string(value: unknown, dataset: string): string { if (typeof value !== 'string') fail(dataset, 'expected string'); return value; }
function number(value: unknown, dataset: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) fail(dataset, 'expected finite number'); return value; }

function extract(source: string, anchorText: string, dataset: string): unknown { return evalLiteral(sliceLiteral(source, anchor(source, anchorText, dataset)), dataset); }

function extractXp(source: string): number[] {
  const marker = 'Math.floor(t/3.5)';
  const at = anchor(source, marker, 'xp');
  const functions = /\bfunction(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g;
  let selected = '';
  for (const match of source.matchAll(functions)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    if (open > at) continue;
    try { const body = sliceLiteral(source, open); const close = open + body.length - 1; if (close >= at) selected = source.slice(match.index ?? 0, close + 1); } catch { /* try next enclosing function */ }
  }
  if (!selected) fail('xp', 'could not locate enclosing function');
  let table: unknown;
  try { const fn = vm.runInNewContext(`(${selected})`, Object.create(null), { timeout: 5000 }) as unknown; if (typeof fn !== 'function') fail('xp', 'enclosing expression is not callable'); table = (fn as () => unknown)(); }
  catch (error) { if (error instanceof OperationalError) throw error; fail('xp', `function evaluation failed: ${error instanceof Error ? error.message : String(error)}`); }
  const values = array(table, 'xp');
  if (values.length < 100) fail('xp', 'table has fewer than 100 entries');
  const output = values.map((value) => number(value, 'xp'));
  for (let i = 2; i < output.length; i++) if (!(output[i] > output[i - 1])) fail('xp', 'table is not strictly increasing from index 2');
  return output;
}

export function extractDatasets(source: string, archiveFiles: readonly string[]): ExtractedDatasets {
  const rawItems = object(extract(source, 'witherwood_log:{label:', 'items'), 'items');
  const art = new Set(archiveFiles);
  const items: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
  const ids = Object.keys(rawItems);
  if (ids.length < 400) fail('items', `expected at least 400 entries, got ${ids.length}`);
  for (const id of ids) { const item = object(rawItems[id], 'items'); string(item.label, 'items'); string(item.type, 'items'); items[id] = { ...item, art: art.has(`dist/art/icons/items/${id}.png`) }; }

  const rawActions = object(extract(source, '={woodcutting:[{id:"chop_', 'actions'), 'actions');
  const rawActionGates = object(extract(source, '={chop_witherwood:{mapId:', 'action gates'), 'action gates');
  for (const skill of ACTION_SKILLS) { const list = array(rawActions[skill], 'actions'); for (const action of list) { const item = object(action, 'actions'); string(item.id, 'actions'); number(item.levelReq, 'actions'); number(item.xp, 'actions'); number(item.interval, 'actions'); } }
  const actions: Record<string, unknown[]> = Object.create(null) as Record<string, unknown[]>;
  for (const [key, value] of Object.entries(rawActions)) {
    actions[key] = array(value, 'actions').map((entry) => {
      const action = object(entry, 'actions');
      const gateValue = rawActionGates[string(action.id, 'actions')];
      if (gateValue === undefined) return action;
      const gate = object(gateValue, 'action gates');
      const gateLevelReq = number(gate.skillLevel, 'action gates');
      const mapReq = gate.mapId;
      if (mapReq !== null && typeof mapReq !== 'string') fail('action gates', 'expected mapId to be a string or null');
      return { ...action, gateLevelReq, ...(mapReq ? { mapReq } : {}) };
    });
  }

  const skills = array(extract(source, '[{id:"hitpoints",name:"Hitpoints"', 'skills'), 'skills');
  if (skills.length < 15 || skills.length > 25) fail('skills', `expected 15–25 entries, got ${skills.length}`);
  for (const skill of skills) object(skill, 'skills');
  const buildings = array(extract(source, '[{id:"townHall"', 'buildings'), 'buildings'); for (const building of buildings) { const item = object(building, 'buildings'); string(item.id, 'buildings'); string(item.name, 'buildings'); array(item.upgrades, 'buildings'); }
  const digsites = array(extract(source, '[{id:"millhaven_ruins"', 'digsites'), 'digsites'); for (const site of digsites) { const item = object(site, 'digsites'); string(item.id, 'digsites'); string(item.name, 'digsites'); number(item.levelReq, 'digsites'); }
  const stringsRaw = object(extract(source, '"name.ancient_spore":"Ancient Spore"', 'strings-en'), 'strings-en');
  const stringsEn: Record<string, string> = Object.create(null) as Record<string, string>; let names = 0; let descriptions = 0; for (const [key, value] of Object.entries(stringsRaw)) { stringsEn[key] = string(value, 'strings-en'); if (key.startsWith('name.')) names++; else if (key.startsWith('itemdesc.')) descriptions++; } if (!names || !descriptions) fail('strings-en', 'catalog lacks name.* or itemdesc.* keys');
  return { items, actions, skills, xp: extractXp(source), buildings, digsites, stringsEn };
}
