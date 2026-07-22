import type { RawGameData } from '../extract/registries.ts';

export type JsonRecord = Record<string, unknown>;

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
  prestigeTitles: Record<string, string> | null;
  stringsEn: Record<string, string>;
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

  return {
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
    prestigeTitles: raw.prestigeTitles,
    stringsEn: raw.stringsEn,
  };
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
