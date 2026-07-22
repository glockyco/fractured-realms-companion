import vm from 'node:vm';
import { OperationalError } from '../lib/errors.ts';
import { evalLiteral, sliceEnclosing, sliceLiteral } from './scan.ts';

export interface RawGameData {
  items: Record<string, Record<string, unknown>>;
  actions: Record<string, unknown[]>;
  actionGates: Record<string, unknown>;
  skills: unknown[];
  xp: number[];
  tools: Record<string, unknown[]>;
  mapsRegular: unknown[];
  mapsDeep: unknown[];
  chartSupplyTiers: Record<string, unknown>;
  agilityCourses: unknown[];
  bags: unknown[];
  machines: unknown[];
  boons: unknown[];
  restorations: unknown[];
  recipeMeals: unknown[];
  seals: unknown[];
  patterns: Record<string, unknown>;
  grandReward: Record<string, unknown>;
  buildings: unknown[];
  buildingXp: Record<string, Record<string, Record<string, number>>>;
  zones: unknown[];
  digsites: unknown[];
  achievements: Array<Record<string, unknown>>;
  offlineGold: Record<string, number>;
  prestigeTitles: Record<string, string> | null;
  stringsEn: Record<string, string>;
  shopItems: string[];
  shopPriceMultiplier: number;
}

const ACTION_SKILLS = [
  'woodcutting', 'mining', 'fishing', 'foraging', 'trapping', 'archaeology',
  'smithing', 'crafting', 'cooking', 'brewing', 'glyphweaving', 'prayer', 'bounty',
] as const;
const TOOL_ANCHORS: Record<string, string> = {
  woodcutting: '[{id:"bronze_axe"',
  mining: '[{id:"bronze_pick"',
  fishing: '[{id:"basic_rod"',
  trapping: '[{id:"basic_trap"',
  archaeology: '[{id:"basic_trowel"',
  foraging: '[{id:"reed_basket"',
  smithing: '[{id:"inscribed_hammer"',
  brewing: '[{id:"inscribed_alembic"',
  glyphweaving: '[{id:"inscribed_quill"',
};

function fail(dataset: string, message: string): never {
  throw new OperationalError(`${dataset} dataset: ${message}`);
}
function anchor(source: string, text: string, dataset: string): number {
  const first = source.indexOf(text);
  if (first < 0 || source.indexOf(text, first + 1) >= 0) {
    fail(dataset, first < 0 ? `anchor not found (${text})` : `anchor is ambiguous (${text})`);
  }
  return first;
}
function object(value: unknown, dataset: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(dataset, 'expected object');
  return value as Record<string, unknown>;
}
function array(value: unknown, dataset: string): unknown[] {
  if (!Array.isArray(value)) fail(dataset, 'expected array');
  return value;
}
function string(value: unknown, dataset: string): string {
  if (typeof value !== 'string') fail(dataset, 'expected string');
  return value;
}
function number(value: unknown, dataset: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(dataset, 'expected finite number');
  return value;
}
function extract(source: string, anchorText: string, dataset: string): unknown {
  return evalLiteral(sliceLiteral(source, anchor(source, anchorText, dataset)), dataset);
}
function validateIdName(entry: Record<string, unknown>, dataset: string): void {
  string(entry.id, dataset);
  string(entry.name, dataset);
}
function validateActionEntry(entry: Record<string, unknown>, dataset: string, bounty = false): void {
  string(entry.id, dataset);
  number(entry.levelReq, dataset);
  number(entry.xp, dataset);
  number(entry.interval, dataset);
  if (bounty) {
    if (entry.targetId === undefined || entry.killCount === undefined || entry.combatReq === undefined) fail(dataset, 'bounty entry lacks targetId, killCount, or combatReq');
    string(entry.targetId, dataset);
    number(entry.killCount, dataset);
  }
}

function extractXp(source: string): number[] {
  const at = anchor(source, '300*Math.pow(2,', 'xp');
  const functions = /\bfunction(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g;
  let selected = '';
  for (const match of source.matchAll(functions)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    if (open > at) continue;
    try {
      const body = sliceLiteral(source, open);
      const close = open + body.length - 1;
      if (close >= at) selected = source.slice(match.index ?? 0, close + 1);
    } catch { /* continue with the next enclosing function */ }
  }
  if (!selected) fail('xp', 'could not locate enclosing function');
  let table: unknown;
  try {
    const fn = vm.runInNewContext(`(${selected})`, Object.create(null), { timeout: 5000 }) as unknown;
    if (typeof fn !== 'function') fail('xp', 'enclosing expression is not callable');
    table = (fn as () => unknown)();
  } catch (error) {
    if (error instanceof OperationalError) throw error;
    fail('xp', `function evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const values = array(table, 'xp');
  if (values.length < 100) fail('xp', `table has fewer than 100 entries (got ${values.length})`);
  const output = values.slice(0, 100).map((value) => number(value, 'xp'));
  for (let i = 2; i < output.length; i++) if (!(output[i] > output[i - 1])) fail('xp', 'table is not strictly increasing from index 2');
  return output;
}

function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}
function skipTemplateSimple(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === '`') return i + 1;
    i++;
  }
  return source.length;
}
function splitArrayEntries(text: string, dataset: string): string[] {
  if (text[0] !== '[' || text.at(-1) !== ']') fail(dataset, 'expected array literal');
  const entries: string[] = [];
  let start = 1;
  const stack: string[] = [];
  let i = 1;
  while (i < text.length - 1) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') { i += 2; while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); if (end < 0) fail(dataset, 'unterminated comment'); i = end + 2; continue; }
    if (ch === '"' || ch === "'") { i = skipString(text, i); continue; }
    if (ch === '`') { i = skipTemplateSimple(text, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') stack.push(ch);
    else if (ch === '}' || ch === ']' || ch === ')') {
      const expected = ch === '}' ? '{' : ch === ']' ? '[' : '(';
      if (stack.at(-1) !== expected) fail(dataset, 'mismatched entry delimiters');
      stack.pop();
    } else if (ch === ',' && stack.length === 0) {
      if (text.slice(start, i).trim()) entries.push(text.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  if (stack.length) fail(dataset, 'unterminated entry');
  if (text.slice(start, -1).trim()) entries.push(text.slice(start, -1).trim());
  return entries;
}
function stringField(entry: string, key: string, dataset: string): string | undefined {
  const quoted = `(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;
  const match = entry.match(new RegExp(`(?:^|[,{]\\s*)${key}\\s*:\\s*(${quoted})`));
  if (!match) return undefined;
  const literal = match[1];
  try { return String(evalLiteral(literal, dataset)); } catch { fail(dataset, `invalid ${key} string field`); }
}
function boolField(entry: string, key: string): boolean | undefined {
  const match = entry.match(new RegExp(`(?:^|[,{]\\s*)${key}\\s*:\\s*(true|false)`));
  return match ? match[1] === 'true' : undefined;
}
function metadataAchievements(source: string): Array<Record<string, unknown>> {
  const at = anchor(source, '{id:"secret_millionaire"', 'achievements');
  const text = sliceEnclosing(source, at, '[');
  const output: Array<Record<string, unknown>> = [];
  for (const entry of splitArrayEntries(text, 'achievements')) {
    const id = stringField(entry, 'id', 'achievements');
    const name = stringField(entry, 'name', 'achievements');
    const category = stringField(entry, 'category', 'achievements');
    if (!id || !name || !category) fail('achievements', 'entry lacks id, name, or category');
    const metadata: Record<string, unknown> = { id, name, category };
    const icon = stringField(entry, 'icon', 'achievements');
    const desc = stringField(entry, 'desc', 'achievements');
    const secret = boolField(entry, 'secret');
    if (icon !== undefined) metadata.icon = icon;
    if (desc !== undefined) metadata.desc = desc;
    if (secret !== undefined) metadata.secret = secret;
    output.push(metadata);
  }
  return output;
}
function extractSupplyTiers(source: string): Record<string, unknown> {
  const at = anchor(source, 'label:"Local Maps",supplies:', 'chartSupplyTiers');
  const innerText = sliceEnclosing(source, at, '{');
  const inner = object(evalLiteral(innerText, 'chartSupplyTiers'), 'chartSupplyTiers');
  const isTier = 'label' in inner && 'supplies' in inner;
  let value: Record<string, unknown> = inner;
  if (isTier) {
    const innerStart = source.lastIndexOf(innerText, at);
    const equals = source.lastIndexOf('=', innerStart);
    if (equals >= 0) {
      const outer = object(evalLiteral(sliceLiteral(source, equals), 'chartSupplyTiers'), 'chartSupplyTiers');
      if (Object.values(outer).some((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && 'supplies' in (entry as Record<string, unknown>))) value = outer;
    }
    if (value === inner) {
      const keyMatch = source.slice(Math.max(0, innerStart - 80), innerStart).match(/([A-Za-z_$][\w$]*)\s*:\s*$/);
      value = { [keyMatch?.[1] ?? 'local']: inner };
    }
  }
  for (const tier of Object.values(value)) {
    const entry = object(tier, 'chartSupplyTiers');
    string(entry.label, 'chartSupplyTiers');
    const supplies = object(entry.supplies, 'chartSupplyTiers');
    const supplyKeys = Object.keys(supplies);
    if (!supplyKeys.length || !supplyKeys.some((key) => key.includes('parchment') || key.includes('vellum')) || !supplyKeys.some((key) => key.includes('ink'))) fail('chartSupplyTiers', 'tier supplies lack parchment or ink');
    for (const value of Object.values(supplies)) number(value, 'chartSupplyTiers');
  }
  return value;
}
function extractPrestigeTitles(source: string): Record<string, string> | null {
  const candidates: Record<string, string>[] = [];
  for (const match of source.matchAll(/woodcutting:\"Master of the Grove\"/g)) {
    const at = match.index ?? -1;
    if (at < 0) continue;
    try {
      const text = sliceEnclosing(source, at, '{');
      const result: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const field of text.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(["'])(.*?)\2/g)) result[field[1]] = field[3];
      if (result.woodcutting && result.mining && result.fishing) candidates.push(result);
    } catch { /* fail-soft by design */ }
  }
  if (!candidates.length) return null;
  const canonical = JSON.stringify(candidates[0]);
  return candidates.every((candidate) => JSON.stringify(candidate) === canonical) ? candidates[0] : null;
}

function extractShop(source: string): { items: string[]; multiplier: number } {
  // Raw ingredient ids sold in the shop (Nz), spread into the buyable set.
  const raw = array(extract(source, '["wild_berries","venison","woodland_seed"', 'shop'), 'shop').map((entry) => string(entry, 'shop'));
  // Explicit non-ingredient buyables: kU = new Set(["vial","bow_string",...Nz]).
  const setStart = anchor(source, 'new Set(["vial","bow_string",', 'shop');
  const setEnd = source.indexOf(')', setStart);
  if (setEnd < 0) fail('shop', 'buyable set is not terminated');
  const explicit = [...source.slice(setStart, setEnd).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (explicit.length === 0) fail('shop', 'buyable set has no explicit ids');
  // Shop price multiplier: the game computes cost as item value * eM.
  const multiplierMatch = /\beM\s*=\s*(\d+)\b/.exec(source);
  if (!multiplierMatch) fail('shop', 'price multiplier not found');
  const multiplier = number(Number(multiplierMatch[1]), 'shop');
  return { items: [...new Set([...explicit, ...raw])], multiplier };
}

export function extractRegistries(source: string, archiveFiles: readonly string[]): RawGameData {
  const itemAt = anchor(source, 'witherwood_log:{label:', 'items');
  const rawItems = object(evalLiteral(sliceEnclosing(source, itemAt, '{'), 'items'), 'items');
  const archive = new Set(archiveFiles);
  const items: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
  const itemIds = Object.keys(rawItems);
  if (itemIds.length < 400) fail('items', `expected at least 400 entries, got ${itemIds.length}`);
  for (const id of itemIds) {
    const item = object(rawItems[id], 'items');
    string(item.label, 'items');
    string(item.type, 'items');
    items[id] = { ...item, art: archive.has(`dist/art/icons/items/${id}.png`) };
  }

  const rawActions = object(extract(source, '={woodcutting:[{id:"chop_', 'actions'), 'actions');
  const actions: Record<string, unknown[]> = Object.create(null) as Record<string, unknown[]>;
  for (const skill of ACTION_SKILLS) {
    const list = array(rawActions[skill], 'actions');
    for (const entry of list) validateActionEntry(object(entry, 'actions'), 'actions', skill === 'bounty');
    actions[skill] = list;
  }
  const rawGates = object(extract(source, '={chop_witherwood:{mapId:', 'actionGates'), 'actionGates');
  for (const gate of Object.values(rawGates)) {
    const item = object(gate, 'actionGates');
    if (item.mapId !== null) string(item.mapId, 'actionGates');
    number(item.skillLevel, 'actionGates');
  }

  const skills = array(extract(source, '[{id:"hitpoints",name:"Hitpoints"', 'skills'), 'skills');
  if (skills.length < 15 || skills.length > 25) fail('skills', `expected 15–25 entries, got ${skills.length}`);
  for (const entry of skills) { const item = object(entry, 'skills'); string(item.id, 'skills'); string(item.name, 'skills'); string(item.category, 'skills'); }

  const tools: Record<string, unknown[]> = Object.create(null) as Record<string, unknown[]>;
  for (const [skill, marker] of Object.entries(TOOL_ANCHORS)) {
    const list = array(extract(source, marker, `tools.${skill}`), `tools.${skill}`);
    for (const entry of list) {
      const item = object(entry, `tools.${skill}`);
      string(item.id, `tools.${skill}`); string(item.name, `tools.${skill}`); number(item.levelReq, `tools.${skill}`); number(item.xpBonus, `tools.${skill}`); number(item.speedBonus, `tools.${skill}`);
      if (item.cost !== undefined) number(item.cost, `tools.${skill}`);
    }
    tools[skill] = list;
  }

  function mapList(marker: string, dataset: string): unknown[] {
    const list = array(extract(source, marker, dataset), dataset);
    for (const entry of list) { const item = object(entry, dataset); string(item.id, dataset); string(item.name, dataset); string(item.tier, dataset); number(item.levelReq, dataset); number(item.xp, dataset); number(item.interval, dataset); number(item.actionsToChart, dataset); }
    return list;
  }
  const mapsRegular = mapList('[{id:"millhaven_village",name:"Millhaven Village Map"', 'mapsRegular');
  const mapsDeep = mapList('[{id:"ds_veiled_shores"', 'mapsDeep');
  const chartSupplyTiers = extractSupplyTiers(source);

  const agilityCourses = array(extract(source, '[{id:"millhaven_rooftops"', 'agilityCourses'), 'agilityCourses');
  for (const entry of agilityCourses) { const item = object(entry, 'agilityCourses'); validateIdName(item, 'agilityCourses'); number(item.levelReq, 'agilityCourses'); number(item.lapXp, 'agilityCourses'); for (const obstacle of array(item.obstacles, 'agilityCourses')) { const o = object(obstacle, 'agilityCourses'); validateIdName(o, 'agilityCourses'); number(o.xp, 'agilityCourses'); number(o.interval, 'agilityCourses'); } }

  const bagAt = anchor(source, '"travellers_pouch",size:60', 'bags');
  const bags = array(evalLiteral(sliceEnclosing(source, bagAt, '['), 'bags'), 'bags');
  for (const entry of bags) { const item = object(entry, 'bags'); string(item.id, 'bags'); number(item.size, 'bags'); number(item.cost, 'bags'); number(item.agilityReq, 'bags'); }
  const machines = array(extract(source, '[{id:"whetstone_engine"', 'machines'), 'machines');
  for (const entry of machines) { const item = object(entry, 'machines'); validateIdName(item, 'machines'); const buff = object(item.buff, 'machines'); string(buff.type, 'machines'); if (buff.value !== undefined) number(buff.value, 'machines'); const cost = object(item.cost, 'machines'); for (const value of Object.values(cost)) number(value, 'machines'); }
  const boons = array(extract(source, '[{id:"consecrate_totem"', 'boons'), 'boons');
  for (const entry of boons) { const item = object(entry, 'boons'); validateIdName(item, 'boons'); string(item.input, 'boons'); number(item.levelReq, 'boons'); number(item.xp, 'boons'); object(item.boon, 'boons'); }
  const restorations = array(extract(source, '[{id:"restore_totem"', 'restorations'), 'restorations');
  for (const entry of restorations) { const item = object(entry, 'restorations'); validateIdName(item, 'restorations'); string(item.input, 'restorations'); number(item.inputQty, 'restorations'); string(item.output, 'restorations'); number(item.levelReq, 'restorations'); number(item.xp, 'restorations'); object(item.materials, 'restorations'); }
  const recipeMeals = array(extract(source, '[{id:"meal_hunters_stew"', 'recipeMeals'), 'recipeMeals');
  for (const entry of recipeMeals) { const item = object(entry, 'recipeMeals'); validateIdName(item, 'recipeMeals'); string(item.recipeScroll, 'recipeMeals'); number(item.levelReq, 'recipeMeals'); number(item.xp, 'recipeMeals'); number(item.interval, 'recipeMeals'); object(item.inputs, 'recipeMeals'); string(item.output, 'recipeMeals'); }
  const seals = array(extract(source, '[{id:"seal_woodcutting"', 'seals'), 'seals');
  for (const entry of seals) { const item = object(entry, 'seals'); string(item.id, 'seals'); string(item.skillId, 'seals'); array(item.buffs, 'seals'); }
  const patterns = object(extract(source, '{pattern_earthen_script:{id:', 'patterns'), 'patterns');
  const grandReward = object(extract(source, '{name:"The Shattered Crown"', 'grandReward'), 'grandReward');
  const buildings = array(extract(source, '[{id:"townHall"', 'buildings'), 'buildings');
  for (const entry of buildings) { const item = object(entry, 'buildings'); validateIdName(item, 'buildings'); array(item.upgrades, 'buildings'); }
  const rawBuildingXp = object(extract(source, '{woodcuttersHut:{1:', 'buildingXp'), 'buildingXp');
  const buildingXp: Record<string, Record<string, Record<string, number>>> = Object.create(null) as Record<string, Record<string, Record<string, number>>>;
  for (const [buildingId, levelsValue] of Object.entries(rawBuildingXp)) {
    const levels = object(levelsValue, 'buildingXp');
    buildingXp[buildingId] = Object.create(null) as Record<string, Record<string, number>>;
    for (const [level, bonusesValue] of Object.entries(levels)) {
      const bonuses = object(bonusesValue, 'buildingXp');
      buildingXp[buildingId][level] = Object.create(null) as Record<string, number>;
      for (const [skillId, bonus] of Object.entries(bonuses)) buildingXp[buildingId][level][skillId] = number(bonus, 'buildingXp');
    }
  }

  const zoneAnchor = anchor(source, '[{id:"thornwood",name:"Thornwood Outskirts"', 'zones');
  const species: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const match of source.slice(Math.max(0, zoneAnchor - 600), zoneAnchor).matchAll(/(\w+)="(vermin|undead|beast|humanoid|elemental|demon|dragon)"/g)) species[match[1]] = match[2];
  const zones = array(evalLiteral(sliceLiteral(source, zoneAnchor), 'zones', species), 'zones');
  for (const zone of zones) { const item = object(zone, 'zones'); string(item.id, 'zones'); array(item.enemies, 'zones'); for (const enemy of array(item.enemies, 'zones')) { const e = object(enemy, 'zones'); string(e.id, 'zones'); if (!('hp' in e)) fail('zones', 'enemy lacks hp'); array(e.drops, 'zones'); } }

  const achievements = metadataAchievements(source);
  const digsites = array(extract(source, '[{id:"millhaven_ruins"', 'digsites'), 'digsites');
  for (const entry of digsites) { const item = object(entry, 'digsites'); validateIdName(item, 'digsites'); number(item.levelReq, 'digsites'); }
  const rawOffline = object(extract(source, '{1:10,2:30,3:100}', 'offlineGold'), 'offlineGold');
  const offlineGold: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [level, value] of Object.entries(rawOffline)) offlineGold[level] = number(value, 'offlineGold');
  const rawStrings = object(extract(source, '"name.ancient_spore":"Ancient Spore"', 'stringsEn'), 'stringsEn');
  const stringsEn: Record<string, string> = Object.create(null) as Record<string, string>;
  let names = 0; let descriptions = 0;
  for (const [key, value] of Object.entries(rawStrings)) { stringsEn[key] = string(value, 'stringsEn'); if (key.startsWith('name.')) names++; if (key.startsWith('itemdesc.')) descriptions++; }
  if (!names || !descriptions) fail('stringsEn', 'catalog lacks name.* or itemdesc.* keys');

  const shop = extractShop(source);
  return {
    items, actions, actionGates: rawGates, skills, xp: extractXp(source), tools,
    mapsRegular, mapsDeep, chartSupplyTiers, agilityCourses, bags, machines, boons,
    restorations, recipeMeals, seals, patterns, grandReward, buildings, buildingXp,
    zones, digsites, achievements, offlineGold, prestigeTitles: extractPrestigeTitles(source), stringsEn,
    shopItems: shop.items, shopPriceMultiplier: shop.multiplier,
  };
}
