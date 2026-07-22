/** Compile typed targets into deterministic executable/manual Step IR. */
import { computeReach } from './closure.js';
import { factSatisfied, requiredTool, itemOutputs } from './model.js';
import { burnChance, brewDoubleChance, cartographyInterval, effectiveInterval, goldRate, levelForXp, sealDoubleChance, xpForLevel, xpMultiplier, xpPerRun } from './formulas.js';

const num = (value, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const obj = (value) => value && typeof value === 'object' ? value : {};
const arr = (value) => Array.isArray(value) ? value : [];
const ceilRuns = (amount, perRun) => perRun > 0 ? Math.max(1, Math.ceil(amount / perRun - 1e-12)) : 0;

function ensureIndexed(model) {
  if (!model?._index) throw new TypeError('plan requires the result of indexModel(modelJson)');
}
function outputFor(provider, itemId) { return Math.max(0, num(provider.producesItems?.[itemId])); }
function actionRequirements(provider) {
  return provider?.requires ?? [];
}
function snapshotCopy(snapshot = {}) {
  return {
    ...snapshot,
    skillXp: { ...obj(snapshot.skillXp) }, inventory: { ...obj(snapshot.inventory) }, equipment: { ...obj(snapshot.equipment) },
    chartedMaps: arr(snapshot.chartedMaps).slice(), unlockedRecipes: arr(snapshot.unlockedRecipes).slice(),
    unlockedGlyphPatterns: arr(snapshot.unlockedGlyphPatterns).slice(), activeBoons: arr(snapshot.activeBoons).slice(),
    builtMachines: arr(snapshot.builtMachines).slice(), outpostLevels: { ...obj(snapshot.outpostLevels) },
    bagSize: snapshot.bagSize == null ? 48 : num(snapshot.bagSize, 48), gold: num(snapshot.gold),
  };
}

/** Produce a plan for one D3 target. */
export function plan(model, snapshot = {}, target = {}) {
  ensureIndexed(model);
  const state = snapshotCopy(snapshot);
  const reach = computeReach(model, snapshot);
  // goldRate and snapshot-relative action intervals are invariant for this plan call
  // (they read the fixed original snapshot), so compute them once instead of per
  // estimateProvider invocation, which chooseProvider fans out across many candidates.
  const snapshotGoldRate = goldRate(model, snapshot);
  const snapshotIntervalMemo = new Map();
  const snapshotInterval = (provider) => {
    if (provider.kind !== 'action') return 0;
    let value = snapshotIntervalMemo.get(provider);
    if (value === undefined) { value = effectiveInterval(model, snapshot, provider.skillId, provider.action); snapshotIntervalMemo.set(provider, value); }
    return value;
  };
  const steps = []; const notes = []; const plannedFacts = new Set(); const itemStack = new Set(); const acquiredBy = new Map();
  let serial = 0; let failure = null;
  const stepIds = () => steps.map((step) => step.id);
  const quantity = (id) => Math.max(0, num(state.inventory[id]));
  const factNow = (fact) => factSatisfied(model, state, fact) || plannedFacts.has(fact);
  const markFailure = (reason, fact) => { if (!failure) failure = fact ? { fact, reason } : { reason }; return false; };

  const applyExpectedProduction = (step, provider, runs) => {
    for (const [id, amount] of Object.entries(step.expected?.produces ?? {})) if (id !== 'gold') state.inventory[id] = quantity(id) + num(amount);
    if (provider?.outputGold) state.gold += num(provider.outputGold) * runs;
    for (const [skillId, amount] of Object.entries(provider?.xpGain ?? {})) {
      if (provider?.kind === 'action') state.skillXp[skillId] = num(state.skillXp[skillId]) + xpPerRun(model, state, skillId, provider.action) * runs;
      else if (provider?.kind === 'chart') state.skillXp[skillId] = num(state.skillXp[skillId]) + num(amount) * xpMultiplier(model, state, skillId) * runs;
      else state.skillXp[skillId] = num(state.skillXp[skillId]) + num(amount) * runs;
    }
    if (provider?.mapId) state.chartedMaps.push(provider.mapId);
    if (provider?.purchase?.type === 'bag') state.bagSize = Math.max(state.bagSize, num(model._index.bagsById.get(provider.purchase.id)?.size));
    if (provider?.purchase?.type === 'machine') state.builtMachines.push(provider.purchase.id);
    if (provider?.purchase?.type === 'boon') state.activeBoons.push({ id: provider.purchase.id });
    if (provider?.purchase?.type === 'recipe') state.unlockedRecipes.push(provider.purchase.id);
    for (const fact of provider?.grantsFacts ?? []) plannedFacts.add(fact);
  };
  const expectedProduces = (provider, runs) => {
    const produces = {};
    const outputFactor = (1 + (provider.skillId === 'brewing' ? brewDoubleChance(model, state) : 0)) * (1 + sealDoubleChance(model, state, provider.skillId));
    const cookingBurn = provider.skillId === 'cooking' ? burnChance(levelForXp(model.xpTable, state.skillXp?.cooking), provider.action?.levelReq) : 0;
    for (const [itemId, value] of Object.entries(provider.producesItems ?? {})) {
      const amount = num(value) * runs * outputFactor;
      if (cookingBurn > 0) {
        const suffix = String(itemId).replace(/^.*?_/, '');
        produces[itemId] = (produces[itemId] ?? 0) + amount * (1 - cookingBurn);
        produces[`burnt_${suffix}`] = (produces[`burnt_${suffix}`] ?? 0) + amount * cookingBurn;
      } else produces[itemId] = (produces[itemId] ?? 0) + amount;
    }
    if (provider.outputGold) produces.gold = (produces.gold ?? 0) + num(provider.outputGold) * runs;
    return produces;
  };
  const expectedDuration = (provider, runs) => {
    if (provider.automation !== 'auto' || (provider.kind !== 'action' && provider.kind !== 'chart')) return null;
    if (provider.kind === 'chart') return cartographyInterval(model, state, provider.map) * Math.max(0, runs);
    const local = { ...state, skillXp: { ...state.skillXp } };
    let total = 0;
    for (let run = 0; run < Math.max(0, runs); run += 1) {
      total += effectiveInterval(model, local, provider.skillId, provider.action);
      local.skillXp[provider.skillId] = num(local.skillXp[provider.skillId]) + xpPerRun(model, local, provider.skillId, provider.action);
    }
    return total;
  };
  const applyExpected = (step, provider, runs) => {
    // Item consumption is NOT applied here: inputs are reserved out of the pool in
    // ensureProviderInputs, before sibling sub-chains plan against the same stock.
    if (provider?.consumesGold) state.gold = Math.max(0, num(state.gold) - num(provider.consumesGold));
    applyExpectedProduction(step, provider, runs);
  };
  const addStep = (provider, runs, purpose, stop, deps, extra = {}) => {
    const isAction = (provider.kind === 'action' || provider.kind === 'chart') && provider.automation === 'auto';
    const id = extra.id ?? `${isAction ? (provider.kind === 'chart' ? 'chart' : 'action') : 'manual'}:${provider.skillId ?? provider.id}:${provider.actionId ?? provider.id}:${serial++}`;
    const produces = expectedProduces(provider, runs);
    const consumes = {};
    for (const [itemId, value] of Object.entries(provider.consumesItems ?? {})) consumes[itemId] = num(value) * runs;
    const expectedMs = expectedDuration(provider, runs);
    const step = {
      id, kind: isAction ? 'action' : 'manual', label: provider.label ?? provider.id,
      ...(provider.skillId ? { skillId: provider.skillId } : {}), ...(provider.actionId != null ? { actionId: provider.actionId } : {}),
      providerId: provider.id,
      ...(isAction ? {} : { instruction: provider.label ?? provider.id }), deps: [...new Set(deps)].sort(), stop,
      expected: { runs, ms: expectedMs, produces, consumes },
      purpose, ...extra,
    };
    steps.push(step); applyExpected(step, provider, runs); return step;
  };

  const estimateProvider = (provider, itemId, needed) => {
    let cost = provider.automation === 'auto' && provider.kind === 'action' ? snapshotInterval(provider) : 0;
    if (provider.kind === 'chart') cost = num(provider.map?.interval) * Math.max(1, num(provider.map?.actionsToChart, 1));
    for (const fact of actionRequirements(provider)) {
      if (factNow(fact)) continue;
      const label = reach.get(fact)?.cost;
      if (Number.isFinite(label)) cost += label;
      else if (fact.startsWith('level:')) {
        const [, skill, level] = fact.split(':');
        const current = levelForXp(model.xpTable, state.skillXp[skill]);
        if (current < num(level)) return Number.POSITIVE_INFINITY;
      } else return Number.POSITIVE_INFINITY;
    }
    const rate = snapshotGoldRate;
    if (provider.consumesGold > 0) {
      const neededGold = Math.max(0, provider.consumesGold - num(state.gold));
      if (neededGold > 0) cost += rate > 0 ? neededGold / rate : Number.POSITIVE_INFINITY;
    }
    for (const [input, amount] of Object.entries(provider.consumesItems ?? {})) {
      const missing = Math.max(0, num(amount) * Math.max(1, Math.ceil(needed / Math.max(1, outputFor(provider, itemId)))) - quantity(input));
      const per = reach.itemCosts?.get(input);
      if (missing && !Number.isFinite(per)) return Number.POSITIVE_INFINITY;
      cost += missing * (per ?? 0);
    }
    const output = outputFor(provider, itemId);
    if (itemId && output <= 0) return Number.POSITIVE_INFINITY;
    if (!itemId) return cost;
    return cost + ceilRuns(Math.max(0, needed), output) * (provider.kind === 'action' ? snapshotInterval(provider) : 0);
  };

  function ensureLevel(skillId, level) {
    const goal = Math.max(1, Math.floor(num(level)));
    while (levelForXp(model.xpTable, state.skillXp[skillId]) < goal) {
      let simulatedXp = num(state.skillXp[skillId]);
      let selected = null; let selectedRuns = 0; let selectedStop = 0;
      while (levelForXp(model.xpTable, simulatedXp) < goal) {
        const currentLevel = levelForXp(model.xpTable, simulatedXp);
        const candidates = (model._index.actionsBySkill.get(skillId) ?? []).filter((action) => num(action.levelReq) <= currentLevel);
        candidates.sort((a, b) => {
          const ar = xpPerRun(model, { ...state, skillXp: { ...state.skillXp, [skillId]: simulatedXp } }, skillId, a) / Math.max(1, effectiveInterval(model, { ...state, skillXp: { ...state.skillXp, [skillId]: simulatedXp } }, skillId, a));
          const br = xpPerRun(model, { ...state, skillXp: { ...state.skillXp, [skillId]: simulatedXp } }, skillId, b) / Math.max(1, effectiveInterval(model, { ...state, skillXp: { ...state.skillXp, [skillId]: simulatedXp } }, skillId, b));
          return br - ar || String(a.id).localeCompare(String(b.id));
        });
        const action = candidates[0];
        if (!action) return markFailure(`no action can reach level ${goal}`, `level:${skillId}:${goal}`);
        const gain = xpPerRun(model, { ...state, skillXp: { ...state.skillXp, [skillId]: simulatedXp } }, skillId, action);
        const boundary = Math.min(xpForLevel(model.xpTable, goal), xpForLevel(model.xpTable, currentLevel + 1));
        const runs = ceilRuns(Math.max(0, boundary - simulatedXp), gain);
        if (!runs) break;
        if (selected && selected.id !== action.id) break;
        selected = action; selectedRuns += runs; simulatedXp += gain * runs; selectedStop = boundary;
      }
      if (!selected || selectedRuns <= 0) return markFailure(`no action can reach level ${goal}`, `level:${skillId}:${goal}`);
      const provider = model._index.providersById.get(`action:${skillId}:${selected.id}`);
      if (!provider) return markFailure(`missing provider for ${skillId}:${selected.id}`, `level:${skillId}:${goal}`);
      const deps = ensureProviderRequirements(provider); if (failure) return false;
      // A training action that consumes items (e.g. smelting bars to level smithing)
      // needs those inputs provisioned too, or the emitted step is infeasible.
      const inputDeps = ensureProviderInputs(provider, selectedRuns, null); if (failure) return false;
      addStep(provider, selectedRuns, 'train', { type: 'xp', skillId, xpAtLeast: selectedStop }, [...deps, ...inputDeps], { actionId: selected.id });
    }
    return true;
  }
  function ensureFactImpl(fact) {
    if (factNow(fact)) return [];
    if (plannedFacts.has(fact)) return [];
    if (fact.startsWith('level:')) {
      const [, skill, level] = fact.split(':');
      const before = stepIds(); if (!ensureLevel(skill, num(level))) return null;
      return steps.map((s) => s.id).filter((id) => !before.includes(id));
    }
    if (fact.startsWith('seal:')) {
      const before = stepIds(); if (!ensureLevel(fact.slice(5), 99)) return null;
      return steps.map((s) => s.id).filter((id) => !before.includes(id));
    }
    const providers = model._index.providersByFact.get(fact) ?? [];
    let provider = providers.find((candidate) => Number.isFinite(estimateProvider(candidate, Object.keys(candidate.producesItems ?? {})[0] ?? '', 1)));
    if (!provider) {
      // A crafted tool fact can be granted by an action's item output but is not in the
      // direct fact provider index when a fixture omits tool metadata.
      const toolId = fact.startsWith('tool:') ? fact.slice(5) : null;
      if (toolId) provider = model._index.providers.find((candidate) => candidate.producesItems?.[toolId] > 0);
    }
    if (!provider) return markFailure(`unreachable fact ${fact}`, fact) ? [] : null;
    const before = stepIds();
    const deps = ensureProviderRequirements(provider); if (failure) return null;
    const inputDeps = ensureProviderInputs(provider, 1, Object.keys(provider.producesItems ?? {})[0]); if (failure) return null;
    const allDeps = [...new Set([...deps, ...inputDeps])];
    let stop = { type: 'fact', fact };
    if (provider.kind === 'action' || provider.kind === 'chart') {
      let runs = provider.kind === 'chart' ? Math.max(1, num(provider.map?.actionsToChart, 1)) : 1;
      if (provider.kind === 'chart') stop = { type: 'fact', fact };
      addStep(provider, runs, 'unlock', stop, allDeps, provider.kind === 'chart' ? { mapId: provider.mapId } : {});
    } else {
      const runs = 1; addStep(provider, runs, 'unlock', stop, allDeps);
    }
    return steps.map((s) => s.id).filter((id) => !before.includes(id));
  }
  function ensureProviderRequirements(provider) {
    const deps = [];
    for (const fact of actionRequirements(provider)) {
      const made = ensureFactImpl(fact); if (failure) return deps;
      if (made) deps.push(...made);
    }
    return [...new Set(deps)];
  }
  function ensureProviderInputs(provider, runs, targetItem) {
    const deps = [];
    for (const [input, amount] of Object.entries(provider.consumesItems ?? {})) {
      const need = num(amount) * runs;
      if (itemStack.has(input)) {
        if (outputFor(provider, input) > num(amount)) continue;
        markFailure('cycle', undefined); return deps;
      }
      const made = ensureItem(input, need); if (failure) return deps;
      if (made) deps.push(...made);
      // Reserve this consumer's share immediately so later consumers of the same
      // base item see only the true surplus and provision the cumulative demand.
      state.inventory[input] = Math.max(0, quantity(input) - need);
    }
    return [...new Set(deps)];
  }
  function chooseProvider(itemId, needed) {
    const candidates = (model._index.producersByItem.get(itemId) ?? []).filter((provider) => outputFor(provider, itemId) > 0);
    const automated = candidates.filter((provider) => provider.automation === 'auto');
    const pool = automated.length ? automated : candidates;
    const ranked = pool.map((provider) => ({ provider, cost: estimateProvider(provider, itemId, needed) }))
      .filter((entry) => Number.isFinite(entry.cost)).sort((a, b) => a.cost - b.cost || String(a.provider.id).localeCompare(String(b.provider.id)));
    return ranked[0]?.provider ?? null;
  }
  function ensureItem(itemId, wanted) {
    const targetQty = Math.max(0, num(wanted));
    const deficit = targetQty - quantity(itemId);
    if (deficit <= 1e-9) return [];
    if (itemStack.has(itemId)) return [];
    itemStack.add(itemId);
    const provider = chooseProvider(itemId, deficit);
    if (!provider) { itemStack.delete(itemId); markFailure(`no finite source for ${itemId}`, itemId); return null; }
    const output = outputFor(provider, itemId);
    const runs = ceilRuns(deficit, output);
    const existing = acquiredBy.get(itemId);
    if (existing && existing.provider.id === provider.id && existing.step.stop?.type === 'itemQty') {
      const inputDeps = ensureProviderInputs(provider, runs, itemId); if (failure) { itemStack.delete(itemId); return null; }
      const step = existing.step;
      const additionalProduces = expectedProduces(provider, runs);
      for (const [id, amount] of Object.entries(additionalProduces)) step.expected.produces[id] = num(step.expected.produces[id]) + num(amount);
      for (const [id, amount] of Object.entries(provider.consumesItems ?? {})) step.expected.consumes[id] = num(step.expected.consumes[id]) + num(amount) * runs;
      step.expected.runs += runs;
      step.expected.ms = (step.expected.ms ?? 0) + (expectedDuration(provider, runs) ?? 0);
      step.stop.qty += output * runs;
      step.deps = [...new Set([...step.deps, ...inputDeps])].sort();
      applyExpectedProduction({ expected: { produces: additionalProduces } }, provider, runs);
      itemStack.delete(itemId);
      return [step.id, ...inputDeps];
    }
    const deps = ensureProviderRequirements(provider); if (failure) { itemStack.delete(itemId); return null; }
    const inputDeps = ensureProviderInputs(provider, runs, itemId); if (failure) { itemStack.delete(itemId); return null; }
    const allDeps = [...new Set([...deps, ...inputDeps])];
    const threshold = quantity(itemId) + output * runs;
    const stop = provider.kind === 'action' || provider.kind === 'chart'
      ? { type: 'itemQty', itemId, qty: threshold } : (provider.grantsFacts?.[0] ? { type: 'fact', fact: provider.grantsFacts[0] } : { type: 'runs', runs: 1 });
    const step = addStep(provider, runs, 'acquire', stop, allDeps, provider.kind === 'chart' ? { mapId: provider.mapId } : {});
    if (provider.kind === 'action' || provider.kind === 'chart') acquiredBy.set(itemId, { provider, step });
    if (provider.rare?.some((entry) => entry.item === itemId)) notes.push(`Expected-value rare source: ${provider.id}`);
    itemStack.delete(itemId);
    return [step.id, ...allDeps];
  }
  function addActionTarget(provider, runs, purpose = 'goal', stop = { type: 'runs', runs }) {
    const deps = ensureProviderRequirements(provider); if (failure) return;
    const inputDeps = ensureProviderInputs(provider, runs, null); if (failure) return;
    addStep(provider, runs, purpose, stop, [...deps, ...inputDeps]);
  }

  // Keep the dependency order helper as a declaration so ensureFact can call it above.
  function ensureFact(fact) { return ensureFactImpl(fact); }
  const type = target?.type ?? 'item';
  if (type === 'item' || type === 'item-gain') {
    const amount = type === 'item' ? num(target.qty) : quantity(target.itemId) + num(target.gain);
    ensureItem(target.itemId, amount);
  } else if (type === 'level') {
    ensureLevel(target.skillId, num(target.level));
  } else if (type === 'xp') {
    const currentXp = num(state.skillXp[target.skillId]);
    if (currentXp < num(target.xp)) ensureLevel(target.skillId, levelForXp(model.xpTable, num(target.xp)));
    if (num(state.skillXp[target.skillId]) < num(target.xp)) {
      const candidates = (model._index.actionsBySkill.get(target.skillId) ?? []).filter((action) => num(action.levelReq) <= levelForXp(model.xpTable, state.skillXp[target.skillId]))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const action = candidates[0];
      if (!action) markFailure(`no action can reach xp ${target.xp}`, `level:${target.skillId}:${levelForXp(model.xpTable, num(target.xp))}`);
      else { const p = model._index.providersById.get(`action:${target.skillId}:${action.id}`); addActionTarget(p, ceilRuns(num(target.xp) - num(state.skillXp[target.skillId]), xpPerRun(model, state, target.skillId, action)), 'train', { type: 'xp', skillId: target.skillId, xpAtLeast: num(target.xp) }); }
    }
  } else if (type === 'action') {
    let provider = model._index.providersById.get(`action:${target.skillId}:${target.actionId}`);
    if (!provider && target.skillId === 'agility') provider = model._index.providersById.get(`agility:${target.actionId}`);
    if (!provider && target.skillId === 'cartography') provider = model._index.providersById.get(`chart:${target.actionId}`);
    if (!provider) markFailure(`unknown action ${target.skillId}:${target.actionId}`);
    else {
      const interval = provider.kind === 'chart' ? cartographyInterval(model, state, provider.map) : effectiveInterval(model, state, target.skillId, provider.action);
      const defaultRuns = provider.kind === 'chart' ? Math.max(1, num(provider.map?.actionsToChart, 1)) : 1;
      const runs = target.runs != null ? Math.max(0, Math.ceil(num(target.runs))) : target.minutes != null ? Math.max(1, Math.ceil(num(target.minutes, 0) * 60000 / Math.max(1, interval))) : defaultRuns;
      const stop = provider.kind === 'chart' ? { type: 'fact', fact: `map:${provider.mapId}` } : { type: target.runs != null ? 'runs' : 'time', ...(target.runs != null ? { runs } : { ms: num(target.minutes) * 60000 }) };
      addActionTarget(provider, runs, 'goal', stop);
    }
  } else if (type === 'unlock') ensureFact(target.fact);
  else if (type === 'gold') {
    if (num(state.gold) < num(target.amount)) {
      const candidates = model._index.providers.filter((provider) => provider.kind === 'action' && provider.automation === 'auto' && (provider.outputGold > 0 || Object.keys(provider.producesItems).some((id) => model.items?.[id]?.value > 0)));
      candidates.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const provider = candidates[0];
      if (!provider) markFailure('no finite gold source');
      else {
        const perRun = provider.outputGold + Object.entries(provider.producesItems).reduce((sum, [id, amount]) => sum + num(model.items?.[id]?.value) * num(amount), 0);
        const runs = ceilRuns(num(target.amount) - num(state.gold), perRun);
        addActionTarget(provider, runs, 'goal', { type: 'runs', runs });
      }
    }
  } else markFailure(`unknown target type ${type}`);

  if (failure) return { ok: false, steps, blocked: failure, notes };
  return { ok: true, steps, notes };
}

export { snapshotCopy };
