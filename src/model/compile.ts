import type { ExtractionGap, PrestigeData, RawGameData } from '../extract/registries.ts';

export type JsonRecord = Record<string, unknown>;

/** One cross-registry invariant the compiled model violates. */
export interface IntegrityFinding {
  readonly check: string;
  readonly detail: string;
}

/** What this build failed to yield, and where the result is internally inconsistent. */
export interface ExtractionReport {
  readonly unavailable: readonly ExtractionGap[];
  readonly integrity: readonly IntegrityFinding[];
}

export interface ActionRecord extends JsonRecord {
  id: string;
  skillId: string;
  gate: { mapId: string | null; skillLevel: number } | null;
  automation: 'auto' | 'manual';
}

export interface GameModel {
  schema_version: 1;
  build_id: string;
  xpTable: number[];
  skills: unknown[];
  items: Record<string, JsonRecord>;
  actions: ActionRecord[];
  tools: Record<string, unknown[]>;
  maps: unknown[];
  chartSupplyTiers: Record<string, unknown>;
  agilityCourses: unknown[];
  bags: unknown[];
  machines: unknown[];
  boons: unknown[];
  restorations: unknown[];
  recipeMeals: unknown[];
  seals: unknown[];
  patterns: Record<string, unknown>;
  grandReward: JsonRecord;
  buildings: unknown[];
  buildingXp: Record<string, Record<string, Record<string, number>>>;
  zones: unknown[];
  digsites: unknown[];
  achievements: Array<Record<string, unknown>>;
  offlineGold: Record<string, number>;
  titles: Array<Record<string, unknown>>;
  prestige: PrestigeData | null;
  stringsEn: Record<string, string>;
  shop: Record<string, number>;
  equipment: Record<string, JsonRecord>;
  weapons: Record<string, JsonRecord>;
  foodHeal: Record<string, number>;
  enemyAttacks: Record<string, unknown[]>;
  potions: Record<string, JsonRecord>;
  extraction: ExtractionReport;
}

function record(value: unknown): JsonRecord {
  return (typeof value === 'object' && value !== null ? value : {}) as JsonRecord;
}

function actionGate(raw: unknown): ActionRecord['gate'] {
  if (raw === null || raw === undefined) return null;
  const value = record(raw);
  const skillLevel = value.skillLevel;
  if (typeof skillLevel !== 'number') return null;
  const mapId = value.mapId;
  return { mapId: mapId === null || mapId === undefined ? null : String(mapId), skillLevel };
}

/**
 * Cross-registry invariants. An anchor that slides onto a decoy literal yields a
 * plausible-looking registry, so shape validation alone cannot catch it; these
 * checks compare registries against each other. They report rather than throw,
 * because a degraded registry is already accounted for in `unavailable`.
 */
function integrityFindings(model: Omit<GameModel, 'extraction'>): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const names = (ids: Iterable<string>): string => {
    const sorted = [...new Set(ids)].sort();
    return sorted.length > 6 ? `${sorted.slice(0, 6).join(', ')} (+${sorted.length - 6} more)` : sorted.join(', ');
  };

  // Weapons carry the unarmed pseudo-entry `fists` and tool ids are equipment-slot
  // ids, so neither collection is expected to resolve against `items`.
  const missingItems = new Set<string>();
  const requireItem = (id: unknown): void => {
    if (typeof id !== 'string' || id === '' || id === 'gold') return;
    if (!Object.hasOwn(model.items, id)) missingItems.add(id);
  };
  for (const action of model.actions) {
    for (const id of Object.keys(record(action.inputs))) requireItem(id);
    for (const id of Object.keys(record(action.outputs))) requireItem(id);
    for (const rare of Array.isArray(action.rareOutputs) ? action.rareOutputs : []) requireItem(record(rare).item);
  }
  for (const id of Object.keys(model.shop)) requireItem(id);
  for (const id of Object.keys(model.equipment)) requireItem(id);
  if (missingItems.size) findings.push({ check: 'item-refs', detail: `${missingItems.size} referenced item ids are absent from items: ${names(missingItems)}` });

  const skillIds = new Set(model.skills.map((skill) => String(record(skill).id ?? '')));
  const missingSkills = new Set(model.actions.map((action) => action.skillId).filter((id) => !skillIds.has(id)));
  if (missingSkills.size) findings.push({ check: 'skill-refs', detail: `${missingSkills.size} action skill ids are absent from skills: ${names(missingSkills)}` });

  const badPrices = new Set(Object.entries(model.shop).filter(([, price]) => !(Number.isFinite(price) && price > 0)).map(([id]) => id));
  if (badPrices.size) findings.push({ check: 'shop-prices', detail: `${badPrices.size} shop entries are not priced above zero: ${names(badPrices)}` });

  const xp = model.xpTable;
  const xpProblem = !Array.isArray(xp) || xp.length < 100
    ? `expected at least 100 thresholds, got ${Array.isArray(xp) ? xp.length : 'none'}`
    : xp[1] !== 0
      ? `level 1 must cost 0 xp, got ${xp[1]}`
      : (() => {
        for (let level = 2; level < xp.length; level += 1) if (!(xp[level]! > xp[level - 1]!)) return `curve stops increasing at level ${level}`;
        return '';
      })();
  if (xpProblem) findings.push({ check: 'xp-curve', detail: xpProblem });

  return findings;
}

/**
 * Compile the extractor's bundle-shaped registries into the deterministic
 * model consumed by the overlay. The raw registries remain untouched.
 */
export function compileModel(raw: RawGameData, buildId: string): GameModel {
  const actions: ActionRecord[] = [];
  for (const [skillId, entries] of Object.entries(raw.actions)) {
    for (const entry of entries) {
      const source = { ...record(entry) };
      // xpOld is historical pre-rebalance data and must never enter the model.
      delete source.xpOld;
      const id = String(source.id ?? '');
      actions.push({
        ...source,
        id,
        skillId,
        gate: actionGate(raw.actionGates[id]),
        automation: skillId === 'bounty' ? 'manual' : 'auto',
      });
    }
  }

  const maps = [
    ...raw.mapsRegular.map((map) => ({ ...record(map), group: 'regular' as const })),
    ...raw.mapsDeep.map((map) => ({ ...record(map), group: 'deep' as const })),
  ];

  // Shop-buyable materials are priced by the game's own source-graph rule
  // (item value times the shop multiplier), matching how it lists shop sources.
  const shop: Record<string, number> = {};
  for (const id of raw.shopItems ?? []) {
    const item = record(raw.items[id]);
    const value = typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : 0;
    shop[id] = value * (raw.shopPriceMultiplier ?? 0);
  }

  // Fold equip requirements + secret flag onto each gear item, mirroring the
  // game's own render fallbacks (armour defaults to Defence, weapons to their
  // style). `kind` discriminates the unified gear projection downstream.
  const secretGear = new Set(raw.secretItems ?? []);
  const equipReq = (id: string, fallbackSkill: string): { reqSkill: string; reqLevel: number } => {
    const req = raw.equipRequirements?.[id];
    return { reqSkill: req?.skill ?? fallbackSkill, reqLevel: typeof req?.level === 'number' ? req.level : 1 };
  };
  const equipment: Record<string, JsonRecord> = {};
  for (const [id, value] of Object.entries(raw.equipment ?? {})) {
    const row = record(value);
    equipment[id] = { ...row, kind: 'armour', secret: secretGear.has(id), ...equipReq(id, 'defence') };
  }
  const weapons: Record<string, JsonRecord> = {};
  for (const [id, value] of Object.entries(raw.weapons ?? {})) {
    const row = record(value);
    weapons[id] = { ...row, kind: 'weapon', secret: secretGear.has(id), ...equipReq(id, typeof row.type === 'string' ? row.type : 'attack') };
  }

  const compiled: Omit<GameModel, 'extraction'> = {
    schema_version: 1,
    build_id: buildId,
    xpTable: raw.xp,
    skills: raw.skills,
    items: raw.items,
    actions,
    tools: raw.tools,
    maps,
    chartSupplyTiers: raw.chartSupplyTiers,
    agilityCourses: raw.agilityCourses,
    bags: raw.bags,
    machines: raw.machines,
    boons: raw.boons,
    restorations: raw.restorations,
    recipeMeals: raw.recipeMeals,
    seals: raw.seals,
    patterns: raw.patterns,
    grandReward: raw.grandReward,
    buildings: raw.buildings,
    buildingXp: raw.buildingXp,
    zones: raw.zones,
    digsites: raw.digsites,
    achievements: raw.achievements,
    offlineGold: raw.offlineGold,
    titles: raw.titles,
    prestige: raw.prestige,
    stringsEn: raw.stringsEn,
    shop,
    equipment,
    weapons,
    foodHeal: raw.foodHeal,
    enemyAttacks: raw.enemyAttacks,
    potions: raw.potions,
  };
  return { ...compiled, extraction: { unavailable: raw.unavailable ?? [], integrity: integrityFindings(compiled) } };
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) output[key] = sorted(source[key]);
    return output;
  }
  return value;
}

/** Serialize a model with recursively sorted object keys and stable array order. */
export function serializeModel(model: GameModel): string {
  return JSON.stringify(sorted(model));
}
