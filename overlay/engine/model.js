/** Indexed, game-aware view of a compiled GameModel. */
import { levelForXp } from './formulas.js';

const n = (value, fallback = 0) => {
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) ? valueNumber : fallback;
};
const qty = (map, id) => Math.max(0, n(map?.[id], 0));
const asArray = (value) => Array.isArray(value) ? value : [];
const asObject = (value) => value && typeof value === 'object' ? value : {};
const nonGoldCosts = (cost) => Object.fromEntries(Object.entries(asObject(cost)).filter(([id]) => id !== 'gold'));

function requiredTool(action) {
  const req = action?.toolReq;
  if (!req) return null;
  if (typeof req === 'string') return req;
  return req.item ?? req.id ?? null;
}
function mapActionId(skillId, actionId) { return `${skillId}:${actionId ?? 'chart'}`; }
function itemOutputs(action) {
  const result = {};
  for (const [id, value] of Object.entries(asObject(action?.outputs))) {
    if (id !== 'gold' && n(value) > 0) result[id] = n(value);
  }
  for (const rare of asArray(action?.rareOutputs)) {
    if (rare?.item && n(rare.qty) > 0 && n(rare.chance) > 0) {
      result[rare.item] = (result[rare.item] ?? 0) + n(rare.qty) * n(rare.chance);
    }
  }
  return result;
}
function addProvider(index, provider) {
  provider.requires = [...new Set(provider.requires ?? [])].sort();
  provider.consumesItems = { ...(provider.consumesItems ?? {}) };
  provider.producesItems = { ...(provider.producesItems ?? {}) };
  provider.consumesGold = Math.max(0, n(provider.consumesGold));
  provider.xpGain = { ...(provider.xpGain ?? {}) };
  index.providers.push(provider);
  index.providersById.set(provider.id, provider);
  for (const fact of provider.requires ?? []) index.factUniverse.add(fact);
  for (const itemId of Object.keys(provider.producesItems)) {
    const list = index.producersByItem.get(itemId) ?? [];
    list.push(provider);
    index.producersByItem.set(itemId, list);
  }
  for (const fact of provider.grantsFacts ?? []) {
    const list = index.providersByFact.get(fact) ?? [];
    list.push(provider);
    index.providersByFact.set(fact, list);
    index.factUniverse.add(fact);
  }
}
function levelFact(skillId, level) { return `level:${skillId}:${Math.max(1, Math.floor(n(level, 1)))}`; }
function addLevelFact(index, skillId, level) {
  const value = Math.max(1, Math.floor(n(level, 1)));
  index.factUniverse.add(levelFact(skillId, value));
}

/**
 * Build deterministic lookup maps and normalized provider hyperedges.
 * The returned object retains the model fields and adds non-enumerable indexes.
 */
export function indexModel(modelJson = {}) {
  const model = { ...modelJson };
  const index = {
    itemsById: new Map(Object.entries(asObject(model.items))),
    actionsById: new Map(), actionsBySkill: new Map(),
    mapsById: new Map(asArray(model.maps).map((entry) => [entry.id, entry])),
    toolsById: new Map(), toolsBySkill: new Map(), bagsById: new Map(),
    machinesById: new Map(), boonsById: new Map(), restorationsById: new Map(),
    mealsById: new Map(), buildingsById: new Map(),
    providers: [], providersById: new Map(), providersByFact: new Map(),
    producersByItem: new Map(), factUniverse: new Set(),
  };
  for (const action of asArray(model.actions)) {
    if (!action?.id) continue;
    index.actionsById.set(action.id, action);
    const list = index.actionsBySkill.get(action.skillId) ?? [];
    list.push(action); index.actionsBySkill.set(action.skillId, list);
    addLevelFact(index, action.skillId, action.levelReq);
    if (action.gate) {
      if (action.gate.mapId) index.factUniverse.add(`map:${action.gate.mapId}`);
      if (action.gate.skillLevel) addLevelFact(index, action.skillId, action.gate.skillLevel);
    }
    if (action.prayerReq) addLevelFact(index, 'prayer', action.prayerReq);
  }
  for (const [skillId, tools] of Object.entries(asObject(model.tools))) {
    const list = asArray(tools);
    index.toolsBySkill.set(skillId, list);
    for (const tool of list) {
      if (!tool?.id) continue;
      index.toolsById.set(tool.id, { ...tool, skillId });
      index.factUniverse.add(`tool:${tool.id}`);
      addLevelFact(index, skillId, tool.levelReq);
    }
  }
  for (const bag of asArray(model.bags)) {
    if (!bag?.id) continue;
    index.bagsById.set(bag.id, bag); index.factUniverse.add(`bag:${bag.id}`);
    addLevelFact(index, 'agility', bag.agilityReq);
  }
  for (const map of asArray(model.maps)) {
    if (!map?.id) continue;
    index.factUniverse.add(`map:${map.id}`); addLevelFact(index, 'cartography', map.levelReq);
  }
  for (const collection of [model.boons, model.restorations, model.recipeMeals]) {
    for (const entry of asArray(collection)) {
      if (!entry?.id) continue;
      if (collection === model.boons) index.boonsById.set(entry.id, entry);
      if (collection === model.restorations) index.restorationsById.set(entry.id, entry);
      if (collection === model.recipeMeals) index.mealsById.set(entry.id, entry);
      addLevelFact(index, entry.skillId ?? (collection === model.boons ? 'prayer' : collection === model.recipeMeals ? 'cooking' : 'archaeology'), entry.levelReq);
    }
  }
  for (const machine of asArray(model.machines)) {
    if (machine?.id) { index.machinesById.set(machine.id, machine); index.factUniverse.add(`machine:${machine.id}`); }
  }
  for (const building of asArray(model.buildings)) {
    if (building?.id) index.buildingsById.set(building.id, building);
  }
  for (const skill of asArray(model.skills)) index.factUniverse.add(`seal:${skill.id}`);

  // Actions are the only automatically executable item providers (bounty is manual).
  for (const action of asArray(model.actions)) {
    const requires = [];
    if (n(action.levelReq) > 0) requires.push(levelFact(action.skillId, action.levelReq));
    if (action.gate?.mapId) requires.push(`map:${action.gate.mapId}`);
    if (action.gate?.skillLevel) requires.push(levelFact(action.skillId, action.gate.skillLevel));
    const tool = requiredTool(action); if (tool) requires.push(`tool:${tool}`);
    if (action.patternReq) requires.push(`pattern:${action.patternReq}`);
    if (n(action.prayerReq) > 0) requires.push(levelFact('prayer', action.prayerReq));
    if (action.recipeScroll) {
      const meal = asArray(model.recipeMeals).find((entry) => entry.recipeScroll === action.recipeScroll || entry.id === action.id);
      requires.push(`recipe:${meal?.id ?? action.id}`);
    }
    const provider = {
      id: `action:${mapActionId(action.skillId, action.id)}`,
      kind: 'action', skillId: action.skillId, actionId: action.id, action,
      label: action.name ?? action.id, automation: action.automation ?? (action.skillId === 'bounty' ? 'manual' : 'auto'),
      requires, consumesItems: { ...asObject(action.inputs) }, consumesGold: 0,
      producesItems: itemOutputs(action), grantsFacts: [], xpGain: { [action.skillId]: n(action.xp) },
      outputGold: n(action.outputs?.gold), rare: asArray(action.rareOutputs).map((entry) => ({ ...entry })),
    };
    for (const outputId of Object.keys(provider.producesItems)) if (index.toolsById.has(outputId)) provider.grantsFacts.push(`tool:${outputId}`);
    addProvider(index, provider);
  }
  // Enemy drops are retained as manual, non-plannable sources for wiki/routes.
  for (const zone of asArray(model.zones)) for (const enemy of asArray(zone?.enemies)) for (const drop of asArray(enemy?.drops)) if (drop?.id && n(drop.qty, 0) > 0) addProvider(index, {
    id: `enemy:${zone.id}:${enemy.id}:${drop.id}`, kind: 'enemy-drop', automation: 'manual', label: `${enemy.name ?? enemy.id} drop`,
    requires: [], consumesItems: {}, consumesGold: 0, producesItems: { [drop.id]: n(drop.qty) * n(drop.chance, 1) }, grantsFacts: [], xpGain: {},
    enemy, zone, rare: [{ item: drop.id, qty: n(drop.qty), chance: n(drop.chance, 1) }],
  });
  // Artisan tools are obtained by their action output, while shop ladders have explicit costs.
  for (const tool of index.toolsById.values()) {
    if (tool.cost == null) continue;
    addProvider(index, {
      id: `buy:tool:${tool.id}`, kind: 'manual', automation: 'manual', label: `Buy ${tool.name ?? tool.id}`,
      requires: [], consumesItems: {}, consumesGold: n(tool.cost), producesItems: {},
      grantsFacts: [`tool:${tool.id}`], xpGain: {}, purchase: { type: 'tool', id: tool.id },
    });
  }
  for (const bag of index.bagsById.values()) addProvider(index, {
    id: `buy:bag:${bag.id}`, kind: 'manual', automation: 'manual', label: `Buy ${bag.name ?? bag.id}`,
    requires: bag.agilityReq ? [levelFact('agility', bag.agilityReq)] : [], consumesItems: {},
    consumesGold: n(bag.cost), producesItems: {}, grantsFacts: [`bag:${bag.id}`], xpGain: {},
    purchase: { type: 'bag', id: bag.id },
  });
  for (const machine of index.machinesById.values()) addProvider(index, {
    id: `build:machine:${machine.id}`, kind: 'manual', automation: 'manual', label: `Build ${machine.name ?? machine.id}`,
    requires: [], consumesItems: nonGoldCosts(machine.cost), consumesGold: n(machine.cost?.gold),
    producesItems: {}, grantsFacts: [`machine:${machine.id}`], xpGain: {}, purchase: { type: 'machine', id: machine.id },
  });
  for (const building of index.buildingsById.values()) for (const upgrade of asArray(building.upgrades)) {
    const level = n(upgrade.level, 0); if (!level) continue;
    addProvider(index, {
      id: `build:outpost:${building.id}:${level}`, kind: 'manual', automation: 'manual', label: upgrade.label ?? `Upgrade ${building.name ?? building.id}`,
      requires: level > 1 ? [`outpost:${building.id}:${level - 1}`] : [], consumesItems: nonGoldCosts(upgrade.cost),
      consumesGold: n(upgrade.cost?.gold), producesItems: {}, grantsFacts: [`outpost:${building.id}:${level}`], xpGain: {},
      purchase: { type: 'outpost', id: building.id, level },
    });
  }
  for (const restoration of index.restorationsById.values()) addProvider(index, {
    id: `restore:${restoration.id}`, kind: 'manual', automation: 'manual', label: restoration.name ?? restoration.id,
    requires: [`level:archaeology:${Math.max(1, n(restoration.levelReq, 1))}`],
    consumesItems: { [restoration.input]: n(restoration.inputQty, 1), ...asObject(restoration.materials) }, consumesGold: 0,
    producesItems: { [restoration.output]: 1 }, grantsFacts: [], xpGain: { archaeology: n(restoration.xp) },
    purchase: { type: 'restoration', id: restoration.id },
  });
  for (const boon of index.boonsById.values()) addProvider(index, {
    id: `consecrate:${boon.id}`, kind: 'manual', automation: 'manual', label: boon.name ?? boon.id,
    requires: [`level:prayer:${Math.max(1, n(boon.levelReq, 1))}`], consumesItems: { [boon.input]: 1 }, consumesGold: 0,
    producesItems: {}, grantsFacts: [`boon:${boon.id}`, ...(boon.grantPattern ? [`pattern:${boon.grantPattern}`] : [])],
    xpGain: { prayer: n(boon.xp) }, purchase: { type: 'boon', id: boon.id },
  });
  for (const meal of index.mealsById.values()) addProvider(index, {
    id: `learn:recipe:${meal.id}`, kind: 'manual', automation: 'manual', label: `Learn ${meal.name ?? meal.id}`,
    requires: [`level:cooking:${Math.max(1, n(meal.levelReq, 1))}`], consumesItems: { [meal.recipeScroll]: 1 }, consumesGold: 0,
    producesItems: {}, grantsFacts: [`recipe:${meal.id}`], xpGain: {}, purchase: { type: 'recipe', id: meal.id },
  });
  for (const course of asArray(model.agilityCourses)) if (course?.id) addProvider(index, {
    id: `agility:${course.id}`, kind: 'manual', automation: 'manual', label: course.name ?? course.id,
    requires: [`level:agility:${Math.max(1, n(course.levelReq, 1))}`], consumesItems: {}, consumesGold: 0,
    producesItems: {}, grantsFacts: [], xpGain: { agility: n(course.lapXp) }, course,
  });
  // Charting follows the game's lowest-level-first selector. A provider therefore includes
  // every earlier map in its group as a prerequisite and is deterministic by bundle order.
  const maps = asArray(model.maps);
  for (const map of maps) {
    const earlier = maps.filter((candidate) => candidate.group === map.group && (n(candidate.levelReq) < n(map.levelReq)
      || (n(candidate.levelReq) === n(map.levelReq) && maps.indexOf(candidate) < maps.indexOf(map))));
    const tier = asObject(model.chartSupplyTiers)[map.tier] ?? { supplies: { parchment: 1, ink: 1 } };
    addProvider(index, {
      id: `chart:${map.id}`, kind: 'chart', automation: 'auto', label: `Chart ${map.name ?? map.id}`,
      skillId: 'cartography', actionId: null, mapId: map.id,
      requires: [levelFact('cartography', map.levelReq), ...earlier.map((entry) => `map:${entry.id}`)],
      consumesItems: { ...asObject(tier.supplies) }, consumesGold: 0, producesItems: {},
      grantsFacts: [`map:${map.id}`], xpGain: { cartography: n(map.xp) }, map,
    });
  }
  for (const [itemId, list] of index.producersByItem) list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const [fact, list] of index.providersByFact) list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  index.providers.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  Object.defineProperty(model, '_index', { value: index, enumerable: false });
  return model;
}

function occupiedSlots(state = {}) {
  return Object.entries(asObject(state.inventory)).filter(([, value]) => n(value) > 0).length;
}
function bagOutputBlocker(state, action, bagSize) {
  const after = { ...asObject(state.inventory) };
  for (const [id, amount] of Object.entries(asObject(action?.inputs))) after[id] = Math.max(0, qty(after, id) - n(amount));
  const occupied = Object.values(after).filter((value) => n(value) > 0).length;
  const ids = Object.keys(itemOutputs(action));
  if (action?.skillId === 'cooking' || action?.cooking) for (const id of ids) ids.push(`burnt_${String(id).replace(/^.*?_/, '')}`);
  const fresh = [...new Set(ids)].filter((id) => qty(after, id) <= 0);
  return occupied + fresh.length > bagSize;
}
function mapForAction(model, step) {
  if (step?.mapId) return model._index.mapsById.get(step.mapId);
  return model._index.actionsById.get(step?.actionId);
}

/** Test whether a normalized fact is true in a live game snapshot. */
export function factSatisfied(model, state = {}, fact) {
  const text = String(fact ?? '');
  const parts = text.split(':');
  const kind = parts[0];
  if (kind === 'level') return levelForXp(model.xpTable, state.skillXp?.[parts[1]]) >= n(parts[2], 1);
  if (kind === 'seal') return levelForXp(model.xpTable, state.skillXp?.[parts[1]]) >= 99;
  if (kind === 'tool') return qty(state.equipment, parts.slice(1).join(':')) > 0 || qty(state.inventory, parts.slice(1).join(':')) > 0;
  if (kind === 'bag') {
    const bag = model._index.bagsById.get(parts.slice(1).join(':'));
    return !!bag && n(state.bagSize, 48) >= n(bag.size);
  }
  if (kind === 'map') return asArray(state.chartedMaps).includes(parts.slice(1).join(':'));
  if (kind === 'recipe') return asArray(state.unlockedRecipes).includes(parts.slice(1).join(':'));
  if (kind === 'pattern') return asArray(state.unlockedGlyphPatterns).includes(parts.slice(1).join(':'));
  if (kind === 'boon') return asArray(state.activeBoons).some((entry) => (typeof entry === 'string' ? entry : entry?.id) === parts.slice(1).join(':'));
  if (kind === 'machine') return asArray(state.builtMachines).includes(parts.slice(1).join(':'));
  if (kind === 'outpost') return n(state.outpostLevels?.[parts[1]]) >= n(parts[2]);
  return false;
}

/** Return the game's start-time blocker, or null when the step may start. */
export function liveBlocker(model, state = {}, step = {}) {
  if (step.kind !== 'action') return null;
  const action = step.actionId == null
    ? model._index.providersById.get(step.providerId)?.map
    : (model._index.actionsBySkill.get(step.skillId)?.find((entry) => entry.id === step.actionId) ?? model._index.actionsById.get(step.actionId));
  const map = step.mapId ? model._index.mapsById.get(step.mapId) : null;
  if (!action && !map) return step.mapId ? `map:${step.mapId}` : null;
  const skillId = step.skillId ?? action?.skillId;
  if (n(action?.levelReq) > 0 && levelForXp(model.xpTable, state.skillXp?.[skillId]) < n(action.levelReq)) return `level:${skillId}:${n(action.levelReq)}`;
  if (action?.gate?.mapId && !factSatisfied(model, state, `map:${action.gate.mapId}`)) return `map:${action.gate.mapId}`;
  if (action?.gate?.skillLevel && levelForXp(model.xpTable, state.skillXp?.[skillId]) < n(action.gate.skillLevel)) return `level:${skillId}:${n(action.gate.skillLevel)}`;
  const tool = requiredTool(action); if (tool && !factSatisfied(model, state, `tool:${tool}`)) return `tool:${tool}`;
  if (action?.patternReq && !factSatisfied(model, state, `pattern:${action.patternReq}`)) return `pattern:${action.patternReq}`;
  if (n(action?.prayerReq) > 0 && levelForXp(model.xpTable, state.skillXp?.prayer) < n(action.prayerReq)) return `level:prayer:${n(action.prayerReq)}`;
  if (action?.recipeScroll) {
    const mealId = asArray(model.recipeMeals).find((meal) => meal.recipeScroll === action.recipeScroll || meal.id === action.id)?.id ?? action.id;
    if (!factSatisfied(model, state, `recipe:${mealId}`)) return `recipe:${mealId}`;
  }
  if (map) {
    const chartProvider = model._index.providersById.get(step.providerId);
    for (const prerequisite of chartProvider?.requires ?? []) if (prerequisite.startsWith('map:') && !factSatisfied(model, state, prerequisite)) return prerequisite;
  }
  if (map) {
    const tier = asObject(model.chartSupplyTiers)[map.tier] ?? { supplies: { parchment: 1, ink: 1 } };
    for (const [itemId, amount] of Object.entries(asObject(tier.supplies))) if (qty(state.inventory, itemId) < n(amount)) return `input:${itemId}`;
  } else for (const [itemId, amount] of Object.entries(asObject(action?.inputs))) if (qty(state.inventory, itemId) < n(amount)) return `input:${itemId}`;
  const outputIds = Object.keys(itemOutputs(action ?? {}));
  if (outputIds.length && bagOutputBlocker(state, action, Math.max(0, n(state.bagSize, 48)))) return 'bag-full';
  return null;
}

export function snapshotFacts(model, state = {}) {
  const result = new Set();
  for (const fact of model._index.factUniverse) if (factSatisfied(model, state, fact)) result.add(fact);
  return result;
}

export { requiredTool, itemOutputs, occupiedSlots };
