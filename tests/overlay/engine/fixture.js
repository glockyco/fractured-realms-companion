export function xpTable() {
  const table = Array.from({ length: 100 }, () => 0);
  for (let level = 2; level < 100; level += 1) table[level] = 100 * (level - 1);
  return table;
}

export function baseModel(overrides = {}) {
  const model = {
    schema_version: 1, build_id: 'fixture', xpTable: xpTable(),
    skills: [
      { id: 'woodcutting', name: 'Woodcutting', category: 'action' },
      { id: 'cartography', name: 'Cartography', category: 'action' },
      { id: 'prayer', name: 'Prayer', category: 'action' },
      { id: 'agility', name: 'Agility', category: 'action' },
    ],
    items: {
      log: { label: 'Log', type: 'Resource', value: 1, art: false },
      gated: { label: 'Gated', type: 'Resource', value: 1, art: false },
      slow: { label: 'Slow', type: 'Resource', value: 1, art: false },
      fast: { label: 'Fast', type: 'Resource', value: 1, art: false },
      tool: { label: 'Tool', type: 'Tool', value: 0, art: false },
      parchment: { label: 'Parchment', type: 'Resource', value: 0, art: false },
      ink: { label: 'Ink', type: 'Resource', value: 0, art: false },
      ore: { label: 'Ore', type: 'Resource', value: 1, art: false },
      goldSource: { label: 'Gold Source', type: 'Resource', value: 0, art: false },
    },
    actions: [
      { id: 'A', name: 'A', skillId: 'woodcutting', levelReq: 1, xp: 10, interval: 3000, inputs: {}, outputs: { log: 1 }, automation: 'auto', gate: null },
      { id: 'B', name: 'B', skillId: 'woodcutting', levelReq: 5, xp: 30, interval: 4000, inputs: {}, outputs: { log: 1 }, automation: 'auto', gate: null },
    ],
    tools: { woodcutting: [{ id: 'tool', name: 'Tool', levelReq: 1, xpBonus: 0, speedBonus: 0, cost: 200 }] },
    maps: [], chartSupplyTiers: {}, agilityCourses: [], bags: [], machines: [], boons: [], restorations: [], recipeMeals: [], seals: [], patterns: {}, grandReward: {}, buildings: [], buildingXp: {}, zones: [], digsites: [], achievements: [], offlineGold: {}, prestigeTitles: null, stringsEn: {},
    ...overrides,
  };
  return model;
}

export function snapshot(overrides = {}) {
  return {
    skillXp: { woodcutting: 0, cartography: 0, prayer: 0, agility: 0 }, inventory: {}, equipment: {}, gold: 0, bagSize: 48,
    chartedMaps: [], mapProgress: {}, unlockedRecipes: [], unlockedGlyphPatterns: [], activeBoons: [], builtMachines: [], outpostLevels: {}, prestigeRank: {}, ...overrides,
  };
}
