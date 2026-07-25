import vm from 'node:vm';
import { OperationalError } from '../lib/errors.ts';
import { evalLiteral, sliceEnclosing, sliceLiteral } from './scan.ts';

/** One prestige-capable skill's track: XP curve and the bonuses unlocked per rank. */
export interface PrestigeSkill {
  category: string;
  maxXp: number;
  thresholds: number[];
  native: Array<[number, string]>;
  cross: Array<[number, string]>;
}
/** The full prestige system: global rank rules plus the per-skill tracks. */
export interface PrestigeData {
  maxRank: number;
  xpBonusPerRank: number;
  speedBonusPerRank: number;
  rankLabels: string[];
  weights: number[];
  categoryTotals: Record<string, number>;
  skills: Record<string, PrestigeSkill>;
}

/** One registry the current game build did not yield, and why. */
export interface ExtractionGap {
  readonly dataset: string;
  readonly reason: string;
}

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
  titles: Array<Record<string, unknown>>;
  prestige: PrestigeData | null;
  stringsEn: Record<string, string>;
  shopItems: string[];
  shopPriceMultiplier: number;
  equipment: Record<string, Record<string, unknown>>;
  weapons: Record<string, Record<string, unknown>>;
  equipRequirements: Record<string, { skill: string; level: number }>;
  foodHeal: Record<string, number>;
  secretItems: string[];
  enemyAttacks: Record<string, unknown[]>;
  potions: Record<string, Record<string, unknown>>;
  /** Registries this build did not yield, sorted by dataset. Empty when complete. */
  unavailable: ExtractionGap[];
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

/** A developer error: an anchor that depends on a minifier-assigned name. */
export class AnchorHygieneError extends Error {}
// A minified identifier is reassigned by the mangler on every game rebuild, so an
// anchor containing one breaks even when no game content changed. Anchor on game
// content (ids, keys, player-visible strings) or on literal structure instead.
const MANGLED_ANCHOR = /(^|[^A-Za-z0-9_$."'])[A-Za-z_$][A-Za-z0-9_$]{0,2}\s*=(?!=)/;

function fail(dataset: string, message: string): never {
  throw new OperationalError(`${dataset} dataset: ${message}`);
}
/**
 * Locate a unique anchor. Exported as the seam for the hygiene guard's own test:
 * every registry lookup funnels through here, so the guard cannot be bypassed.
 */
export function anchor(source: string, text: string, dataset: string): number {
  if (MANGLED_ANCHOR.test(text)) throw new AnchorHygieneError(`${dataset} dataset: anchor depends on a minified identifier (${text})`);
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
// The in-game titles registry, assembled exactly as the renderer builds it
// (`[...mastery, ...prestige, ...static]`): a Mastery title for every skill
// (level 99), a Prestige title for every skill that has a prestige track (rank
// X), and a fixed set of Collection, Achievement, Combat, and Easter Egg titles.
// Names, sources, categories, and icons are reproduced verbatim from the bundle;
// nothing is inferred from ids.
function extractTitles(source: string, skillList: readonly unknown[]): Array<Record<string, unknown>> {
  const skills = skillList.map((entry) => object(entry, 'titles'));
  const masteryNames = object(evalLiteral(sliceEnclosing(source, anchor(source, 'woodcutting:"Grandmaster Woodcutter"', 'titles'), '{'), 'titles'), 'titles');
  const prestigeConfig = object(evalLiteral(sliceEnclosing(source, anchor(source, 'woodcutting:{title:', 'titles'), '{'), 'titles'), 'titles');
  const staticTitles = array(extract(source, '[{id:"seal_bearer",name:"Sealbearer"', 'titles'), 'titles').map((entry) => object(entry, 'titles'));

  const titles: Array<Record<string, unknown>> = [];
  for (const skill of skills) {
    const id = string(skill.id, 'titles');
    const name = string(skill.name, 'titles');
    const mastery = masteryNames[id];
    titles.push({ id: `max_${id}`, name: typeof mastery === 'string' ? mastery : `Grandmaster ${name}`, source: `Reach level 99 in ${name}`, category: 'Mastery', icon: '\u{1F3C6}', skillId: id });
  }
  for (const skill of skills) {
    const id = string(skill.id, 'titles');
    if (!Object.hasOwn(prestigeConfig, id)) continue;
    const name = string(skill.name, 'titles');
    const prestige = object(prestigeConfig[id], 'titles').title;
    titles.push({ id: `prestige_${id}_x`, name: typeof prestige === 'string' ? prestige : `${name} Transcendent`, source: `Reach Prestige Rank X in ${name}`, category: 'Prestige', icon: '\u2726', skillId: id });
  }
  for (const entry of staticTitles) {
    validateIdName(entry, 'titles');
    string(entry.source, 'titles');
    string(entry.category, 'titles');
    string(entry.icon, 'titles');
    titles.push(entry);
  }
  if (!staticTitles.length) fail('titles', 'expected at least one static title');
  return titles;
}

function prestigeBonuses(value: unknown, dataset: string): Array<[number, string]> {
  return array(value, dataset).map((pair) => {
    const tuple = array(pair, dataset);
    if (tuple.length !== 2) fail(dataset, 'bonus entry must be a [rank, description] pair');
    return [number(tuple[0], dataset), string(tuple[1], dataset)];
  });
}

// The prestige system, reproduced as the renderer computes it. Once a skill is at
// the level cap, overflow XP becomes prestige XP for that skill, capped at its
// category total and converted to a rank 0..maxRank via cumulative thresholds the
// game derives from a fixed weight distribution scaled by the category total.
// Every rank grants a flat XP and speed bonus; the per-skill config lists the
// extra native (same-skill) and cross (related-skill) bonuses unlocked at
// specific ranks.
function extractPrestige(source: string): PrestigeData {
  const config = object(evalLiteral(sliceEnclosing(source, anchor(source, 'woodcutting:{title:', 'prestige'), '{'), 'prestige'), 'prestige');
  const weights = array(extract(source, '[60,77,93,110,120,130,140,160,175,192]', 'prestige'), 'prestige').map((weight) => number(weight, 'prestige'));
  const rawTotals = object(extract(source, '{gathering:129e5,artisan:585e4,cooking:43e5}', 'prestige'), 'prestige');
  const skillCategory = object(extract(source, '{woodcutting:"gathering"', 'prestige'), 'prestige');
  const rankLabels = array(extract(source, '["I","II","III"', 'prestige'), 'prestige').map((label) => string(label, 'prestige'));
  // The three rank constants are bare numbers with no content of their own; anchor
  // on the adjacent player-visible reward string and read them positionally.
  const constAt = anchor(source, '"Gold prestige badge on skill"', 'prestige');
  const constMatch = /const\s+[A-Za-z_$][\w$]*=(\d+),[A-Za-z_$][\w$]*=([0-9.]+),[A-Za-z_$][\w$]*=([0-9.]+);/.exec(source.slice(constAt, constAt + 160));
  if (!constMatch) fail('prestige', 'could not parse rank constants');
  const maxRank = Number(constMatch[1]);
  const xpBonusPerRank = Number(constMatch[2]);
  const speedBonusPerRank = Number(constMatch[3]);
  if (!(maxRank > 0) || !(xpBonusPerRank > 0) || !(speedBonusPerRank > 0)) fail('prestige', 'rank constants are non-positive');

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) fail('prestige', 'weight distribution sums to zero');
  if (weights.length !== maxRank) fail('prestige', `weight bands (${weights.length}) do not match max rank (${maxRank})`);
  if (rankLabels.length !== maxRank) fail('prestige', `rank labels (${rankLabels.length}) do not match max rank (${maxRank})`);

  const categoryTotals: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [category, total] of Object.entries(rawTotals)) categoryTotals[category] = number(total, 'prestige');

  const skills: Record<string, PrestigeSkill> = Object.create(null) as Record<string, PrestigeSkill>;
  for (const [id, value] of Object.entries(config)) {
    const entry = object(value, 'prestige');
    const category = string(skillCategory[id], 'prestige');
    const total = categoryTotals[category];
    if (typeof total !== 'number') fail('prestige', `skill ${id} has unknown category ${category}`);
    let cumulative = 0;
    const thresholds = weights.map((weight) => (cumulative += Math.round((weight / weightSum) * total), cumulative));
    skills[id] = { category, maxXp: thresholds[thresholds.length - 1]!, thresholds, native: prestigeBonuses(entry.native, 'prestige'), cross: prestigeBonuses(entry.cross, 'prestige') };
  }
  if (!Object.keys(skills).length) fail('prestige', 'expected at least one prestige skill');
  return { maxRank, xpBonusPerRank, speedBonusPerRank, rankLabels, weights, categoryTotals, skills };
}

function extractEquipment(source: string): Record<string, Record<string, unknown>> {
  const at = anchor(source, 'bronze_helm:{slot:"helm",def:5}', 'equipment');
  const raw = object(evalLiteral(sliceEnclosing(source, at, '{'), 'equipment'), 'equipment');
  const ids = Object.keys(raw);
  if (ids.length < 100) fail('equipment', `expected at least 100 entries, got ${ids.length}`);
  const output: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
  for (const id of ids) {
    const entry = object(raw[id], 'equipment');
    string(entry.slot, 'equipment');
    number(entry.def, 'equipment');
    output[id] = entry;
  }
  return output;
}

// Weapons are a registry separate from armour (equipment): each carries a combat
// style plus attack/strength/speed and, for special gear, rare modifiers (crit,
// lifesteal, multishot, bleed, free-cast) preserved verbatim in the entry.
function extractWeapons(source: string): Record<string, Record<string, unknown>> {
  const at = anchor(source, 'fists:{type:"melee",attack:0,strength:0,speed:2400}', 'weapons');
  const raw = object(evalLiteral(sliceEnclosing(source, at, '{'), 'weapons'), 'weapons');
  const ids = Object.keys(raw);
  if (ids.length < 10) fail('weapons', `expected at least 10 entries, got ${ids.length}`);
  const output: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
  for (const id of ids) {
    const entry = object(raw[id], 'weapons');
    string(entry.type, 'weapons');
    number(entry.attack, 'weapons');
    number(entry.strength, 'weapons');
    number(entry.speed, 'weapons');
    output[id] = entry;
  }
  return output;
}

// Equip-level requirements live in two id-keyed tables the game merges at render:
// armour (default skill defence) and weapons (default skill = weapon style).
function extractEquipRequirements(source: string): Record<string, { skill: string; level: number }> {
  const output: Record<string, { skill: string; level: number }> = Object.create(null) as Record<string, { skill: string; level: number }>;
  for (const anchorText of ['bronze_helm:{skill:"defence",level:1}', 'bronze_dagger:{skill:"attack",level:1}']) {
    const at = anchor(source, anchorText, 'equipRequirements');
    const raw = object(evalLiteral(sliceEnclosing(source, at, '{'), 'equipRequirements'), 'equipRequirements');
    for (const [id, value] of Object.entries(raw)) {
      const entry = object(value, 'equipRequirements');
      output[id] = { skill: string(entry.skill, 'equipRequirements'), level: number(entry.level, 'equipRequirements') };
    }
  }
  if (Object.keys(output).length < 10) fail('equipRequirements', `expected at least 10 entries, got ${Object.keys(output).length}`);
  return output;
}

// Base cooked-food heal values (id -> HP), distinct from recipe-meal heals.
function extractFoodHeal(source: string): Record<string, number> {
  const at = anchor(source, 'cooked_shrimp:5,cooked_beef:5', 'foodHeal');
  const raw = object(evalLiteral(sliceEnclosing(source, at, '{'), 'foodHeal'), 'foodHeal');
  const output: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [id, value] of Object.entries(raw)) output[id] = number(value, 'foodHeal');
  if (Object.keys(output).length < 5) fail('foodHeal', `expected at least 5 entries, got ${Object.keys(output).length}`);
  return output;
}

// Boss-unique gear the compendium hides until found (two Sets of item ids).
function extractSecretItems(source: string): string[] {
  const output = new Set<string>();
  for (const anchorText of ['new Set(["dragonfang_greatblade"', 'new Set(["goblin_crown"']) {
    const at = anchor(source, anchorText, 'secretItems');
    const bracket = source.indexOf('[', at);
    const list = array(evalLiteral(sliceLiteral(source, bracket), 'secretItems'), 'secretItems');
    for (const entry of list) output.add(string(entry, 'secretItems'));
  }
  return [...output].sort();
}

function extractEnemyAttacks(source: string): Record<string, unknown[]> {
  const at = anchor(source, '{giant_rat:[{name:"Gnaw",weight:60', 'enemyAttacks');
  const raw = object(evalLiteral(sliceEnclosing(source, at, '{'), 'enemyAttacks'), 'enemyAttacks');
  const ids = Object.keys(raw);
  if (ids.length < 40) fail('enemyAttacks', `expected at least 40 enemies, got ${ids.length}`);
  const output: Record<string, unknown[]> = Object.create(null) as Record<string, unknown[]>;
  for (const id of ids) {
    const moves = array(raw[id], 'enemyAttacks');
    for (const move of moves) {
      const entry = object(move, 'enemyAttacks');
      string(entry.name, 'enemyAttacks');
      number(entry.weight, 'enemyAttacks');
      number(entry.mult, 'enemyAttacks');
      if (entry.msg !== undefined) string(entry.msg, 'enemyAttacks');
      if (entry.icon !== undefined) string(entry.icon, 'enemyAttacks');
    }
    output[id] = moves;
  }
  return output;
}

function extractPotions(source: string): Record<string, Record<string, unknown>> {
  const at = anchor(source, 'weak_str_potion:{slot:"damage"', 'potions');
  const text = sliceEnclosing(source, at, '{');
  const references = new Set<string>();
  for (const match of text.matchAll(/:\s*([A-Za-z_$][\w$]*)\b/g)) {
    if (!['null', 'true', 'false', 'undefined', 'NaN', 'Infinity'].includes(match[1])) references.add(match[1]);
  }
  const scope: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const window = source.slice(Math.max(0, at - 4096), at);
  for (const reference of references) {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...window.matchAll(new RegExp(`\\b${escaped}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?(?:e[0-9]+)?)\\b`, 'g'))];
    if (!matches.length) fail('potions', `unresolved numeric binding ${reference}`);
    scope[reference] = Number(matches.at(-1)![1]);
  }
  const raw = object(evalLiteral(text, 'potions', scope), 'potions');
  const ids = Object.keys(raw);
  if (ids.length < 10) fail('potions', `expected at least 10 entries, got ${ids.length}`);
  const output: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
  for (const id of ids) {
    const entry = object(raw[id], 'potions');
    if (!('slot' in entry) || (entry.slot !== null && entry.slot !== undefined)) string(entry.slot, 'potions');
    if (entry.mult !== undefined && entry.mult !== null) number(entry.mult, 'potions');
    if (entry.durMs !== undefined && entry.durMs !== null) number(entry.durMs, 'potions');
    if (entry.cdMs !== undefined && entry.cdMs !== null) number(entry.cdMs, 'potions');
    string(entry.family, 'potions');
    output[id] = entry;
  }
  return output;
}

function extractShop(source: string): { items: string[]; multiplier: number } {
  // Raw ingredient ids sold in the shop, spread into the buyable set.
  const rawAt = anchor(source, '["wild_berries","venison","woodland_seed"', 'shop');
  const rawText = sliceLiteral(source, rawAt);
  const raw = array(evalLiteral(rawText, 'shop'), 'shop').map((entry) => string(entry, 'shop'));
  // Explicit non-ingredient buyables: new Set(["vial","bow_string",...ingredients]).
  const setStart = anchor(source, 'new Set(["vial","bow_string",', 'shop');
  const setEnd = source.indexOf(')', setStart);
  if (setEnd < 0) fail('shop', 'buyable set is not terminated');
  const explicit = [...source.slice(setStart, setEnd).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (explicit.length === 0) fail('shop', 'buyable set has no explicit ids');
  // Shop price multiplier: the game computes cost as item value * multiplier, and
  // binds it immediately after the ingredient list. Read it positionally so the
  // minified binding name never matters.
  const tailAt = rawAt + rawText.length;
  const multiplierMatch = /^,[A-Za-z_$][\w$]*=(\d+(?:\.\d+)?)(?=[,;])/.exec(source.slice(tailAt, tailAt + 64));
  if (!multiplierMatch) fail('shop', 'price multiplier not found');
  const multiplier = number(Number(multiplierMatch[1]), 'shop');
  if (!(multiplier > 0)) fail('shop', 'price multiplier is not positive');
  return { items: [...new Set([...explicit, ...raw])], multiplier };
}

export function extractRegistries(source: string, archiveFiles: readonly string[]): RawGameData {
  // Extraction is deliberately not all-or-nothing. The five critical registries
  // below abort the refresh because nothing works without them; every other
  // registry degrades to an empty value and is named in `unavailable`, so a game
  // update that reshapes one table costs that table instead of the whole product.
  const unavailable: ExtractionGap[] = [];
  function optional<T>(dataset: string, produce: () => T, fallback: T): T {
    try {
      return produce();
    } catch (error) {
      // A hygiene violation is our bug, not a game change, so it must never degrade.
      if (error instanceof AnchorHygieneError) throw error;
      unavailable.push({ dataset, reason: error instanceof Error ? error.message : String(error) });
      return fallback;
    }
  }

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
    const dataset = `tools.${skill}`;
    tools[skill] = optional(dataset, () => {
      const list = array(extract(source, marker, dataset), dataset);
      for (const entry of list) {
        const item = object(entry, dataset);
        string(item.id, dataset); string(item.name, dataset); number(item.levelReq, dataset); number(item.xpBonus, dataset); number(item.speedBonus, dataset);
        if (item.cost !== undefined) number(item.cost, dataset);
      }
      return list;
    }, []);
  }

  function mapList(marker: string, dataset: string): unknown[] {
    const list = array(extract(source, marker, dataset), dataset);
    for (const entry of list) { const item = object(entry, dataset); string(item.id, dataset); string(item.name, dataset); string(item.tier, dataset); number(item.levelReq, dataset); number(item.xp, dataset); number(item.interval, dataset); number(item.actionsToChart, dataset); }
    return list;
  }
  const mapsRegular = optional('mapsRegular', () => mapList('[{id:"millhaven_village",name:"Millhaven Village Map"', 'mapsRegular'), []);
  const mapsDeep = optional('mapsDeep', () => mapList('[{id:"ds_veiled_shores"', 'mapsDeep'), []);
  const chartSupplyTiers = optional('chartSupplyTiers', () => extractSupplyTiers(source), {});

  const agilityCourses = optional('agilityCourses', () => {
    const list = array(extract(source, '[{id:"millhaven_rooftops"', 'agilityCourses'), 'agilityCourses');
    for (const entry of list) { const item = object(entry, 'agilityCourses'); validateIdName(item, 'agilityCourses'); number(item.levelReq, 'agilityCourses'); number(item.lapXp, 'agilityCourses'); for (const obstacle of array(item.obstacles, 'agilityCourses')) { const o = object(obstacle, 'agilityCourses'); validateIdName(o, 'agilityCourses'); number(o.xp, 'agilityCourses'); number(o.interval, 'agilityCourses'); } }
    return list;
  }, []);

  const bags = optional('bags', () => {
    const bagAt = anchor(source, '"travellers_pouch",size:60', 'bags');
    const list = array(evalLiteral(sliceEnclosing(source, bagAt, '['), 'bags'), 'bags');
    for (const entry of list) { const item = object(entry, 'bags'); string(item.id, 'bags'); number(item.size, 'bags'); number(item.cost, 'bags'); number(item.agilityReq, 'bags'); }
    return list;
  }, []);
  const machines = optional('machines', () => {
    const list = array(extract(source, '[{id:"whetstone_engine"', 'machines'), 'machines');
    for (const entry of list) { const item = object(entry, 'machines'); validateIdName(item, 'machines'); const buff = object(item.buff, 'machines'); string(buff.type, 'machines'); if (buff.value !== undefined) number(buff.value, 'machines'); const cost = object(item.cost, 'machines'); for (const value of Object.values(cost)) number(value, 'machines'); }
    return list;
  }, []);
  const boons = optional('boons', () => {
    const list = array(extract(source, '[{id:"consecrate_totem"', 'boons'), 'boons');
    for (const entry of list) { const item = object(entry, 'boons'); validateIdName(item, 'boons'); string(item.input, 'boons'); number(item.levelReq, 'boons'); number(item.xp, 'boons'); object(item.boon, 'boons'); }
    return list;
  }, []);
  const restorations = optional('restorations', () => {
    const list = array(extract(source, '[{id:"restore_totem"', 'restorations'), 'restorations');
    for (const entry of list) { const item = object(entry, 'restorations'); validateIdName(item, 'restorations'); string(item.input, 'restorations'); number(item.inputQty, 'restorations'); string(item.output, 'restorations'); number(item.levelReq, 'restorations'); number(item.xp, 'restorations'); object(item.materials, 'restorations'); }
    return list;
  }, []);
  const recipeMeals = optional('recipeMeals', () => {
    const list = array(extract(source, '[{id:"meal_hunters_stew"', 'recipeMeals'), 'recipeMeals');
    for (const entry of list) { const item = object(entry, 'recipeMeals'); validateIdName(item, 'recipeMeals'); string(item.recipeScroll, 'recipeMeals'); number(item.levelReq, 'recipeMeals'); number(item.xp, 'recipeMeals'); number(item.interval, 'recipeMeals'); object(item.inputs, 'recipeMeals'); string(item.output, 'recipeMeals'); }
    return list;
  }, []);
  const seals = optional('seals', () => {
    const list = array(extract(source, '[{id:"seal_woodcutting"', 'seals'), 'seals');
    for (const entry of list) { const item = object(entry, 'seals'); string(item.id, 'seals'); string(item.skillId, 'seals'); array(item.buffs, 'seals'); }
    return list;
  }, []);
  const patterns = optional('patterns', () => object(extract(source, '{pattern_earthen_script:{id:', 'patterns'), 'patterns'), {});
  const grandReward = optional('grandReward', () => object(extract(source, '{name:"The Shattered Crown"', 'grandReward'), 'grandReward'), {});
  const buildings = optional('buildings', () => {
    const list = array(extract(source, '[{id:"townHall"', 'buildings'), 'buildings');
    for (const entry of list) { const item = object(entry, 'buildings'); validateIdName(item, 'buildings'); array(item.upgrades, 'buildings'); }
    return list;
  }, []);
  const buildingXp = optional('buildingXp', () => {
    const rawBuildingXp = object(extract(source, '{woodcuttersHut:{1:', 'buildingXp'), 'buildingXp');
    const output: Record<string, Record<string, Record<string, number>>> = Object.create(null) as Record<string, Record<string, Record<string, number>>>;
    for (const [buildingId, levelsValue] of Object.entries(rawBuildingXp)) {
      const levels = object(levelsValue, 'buildingXp');
      output[buildingId] = Object.create(null) as Record<string, Record<string, number>>;
      for (const [level, bonusesValue] of Object.entries(levels)) {
        const bonuses = object(bonusesValue, 'buildingXp');
        output[buildingId][level] = Object.create(null) as Record<string, number>;
        for (const [skillId, bonus] of Object.entries(bonuses)) output[buildingId][level][skillId] = number(bonus, 'buildingXp');
      }
    }
    return output;
  }, {});

  const zones = optional('zones', () => {
    const zoneAnchor = anchor(source, '[{id:"thornwood",name:"Thornwood Outskirts"', 'zones');
    const species: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const match of source.slice(Math.max(0, zoneAnchor - 600), zoneAnchor).matchAll(/(\w+)="(vermin|undead|beast|humanoid|elemental|demon|dragon)"/g)) species[match[1]] = match[2];
    const list = array(evalLiteral(sliceLiteral(source, zoneAnchor), 'zones', species), 'zones');
    for (const zone of list) { const item = object(zone, 'zones'); string(item.id, 'zones'); array(item.enemies, 'zones'); for (const enemy of array(item.enemies, 'zones')) { const e = object(enemy, 'zones'); string(e.id, 'zones'); if (!('hp' in e)) fail('zones', 'enemy lacks hp'); array(e.drops, 'zones'); } }
    return list;
  }, []);

  const achievements = optional('achievements', () => metadataAchievements(source), []);
  const digsites = optional('digsites', () => {
    const list = array(extract(source, '[{id:"millhaven_ruins"', 'digsites'), 'digsites');
    for (const entry of list) { const item = object(entry, 'digsites'); validateIdName(item, 'digsites'); number(item.levelReq, 'digsites'); }
    return list;
  }, []);
  const offlineGold = optional('offlineGold', () => {
    const rawOffline = object(extract(source, '{1:10,2:30,3:100}', 'offlineGold'), 'offlineGold');
    const output: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [level, value] of Object.entries(rawOffline)) output[level] = number(value, 'offlineGold');
    return output;
  }, {});
  const stringsEn = optional('stringsEn', () => {
    const rawStrings = object(extract(source, '"name.ancient_spore":"Ancient Spore"', 'stringsEn'), 'stringsEn');
    const output: Record<string, string> = Object.create(null) as Record<string, string>;
    let names = 0; let descriptions = 0;
    for (const [key, value] of Object.entries(rawStrings)) { output[key] = string(value, 'stringsEn'); if (key.startsWith('name.')) names++; if (key.startsWith('itemdesc.')) descriptions++; }
    if (!names || !descriptions) fail('stringsEn', 'catalog lacks name.* or itemdesc.* keys');
    return output;
  }, {});

  // The buyable id list and its price multiplier are one unit: a surviving id list
  // with a failed multiplier would price every shop item at zero.
  const shop = optional('shop', () => extractShop(source), { items: [] as string[], multiplier: 0 });
  const equipment = optional('equipment', () => extractEquipment(source), {});
  const weapons = optional('weapons', () => extractWeapons(source), {});
  const equipRequirements = optional('equipRequirements', () => extractEquipRequirements(source), {});
  const foodHeal = optional('foodHeal', () => extractFoodHeal(source), {});
  const secretItems = optional('secretItems', () => extractSecretItems(source), []);
  const enemyAttacks = optional('enemyAttacks', () => extractEnemyAttacks(source), {});
  const potions = optional('potions', () => extractPotions(source), {});
  const titles = optional('titles', () => extractTitles(source, skills), []);
  const prestige = optional<PrestigeData | null>('prestige', () => extractPrestige(source), null);
  return {
    items, actions, actionGates: rawGates, skills, xp: extractXp(source), tools,
    mapsRegular, mapsDeep, chartSupplyTiers, agilityCourses, bags, machines, boons,
    restorations, recipeMeals, seals, patterns, grandReward, buildings, buildingXp,
    zones, digsites, achievements, offlineGold, titles, prestige, stringsEn,
    shopItems: shop.items, shopPriceMultiplier: shop.multiplier,
    equipment,
    weapons,
    equipRequirements,
    foodHeal,
    secretItems,
    enemyAttacks,
    potions,
    // Sorted: serializeModel orders object keys but preserves array order, so this
    // sort is what keeps model.json byte-stable across runs.
    unavailable: unavailable.sort((a, b) => a.dataset.localeCompare(b.dataset)),
  };
}
