/** Shortest-hyperpath closure over indexed facts and providers. */
import { snapshotFacts } from './model.js';
import { effectiveInterval, cartographyInterval, xpForLevel, xpPerRun, levelForXp } from './formulas.js';

const finite = (value) => Number.isFinite(value);
const num = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
const items = (model) => model._index?.itemsById ?? new Map(Object.entries(model.items ?? {}));
const stateFacts = (model, snapshotOrFacts) => snapshotOrFacts instanceof Set || Array.isArray(snapshotOrFacts)
  ? new Set(snapshotOrFacts) : snapshotFacts(model, snapshotOrFacts ?? {});
function currentQty(snapshot, itemId) { return Math.max(0, num(snapshot?.inventory?.[itemId])); }
function goldRate(model, state) {
  // Kept local to avoid making closure's labels depend on target quantities.
  let best = 0;
  for (const provider of model._index.providers) {
    if (provider.automation !== 'auto' || provider.kind !== 'action') continue;
    const interval = effectiveInterval(model, state, provider.skillId, provider.action);
    let gold = num(provider.outputGold);
    for (const [itemId, amount] of Object.entries(provider.action?.outputs ?? {})) {
      if (itemId === 'gold') continue;
      gold += num(items(model).get(itemId)?.value) * num(amount);
    }
    if (interval > 0) best = Math.max(best, gold / interval);
  }
  return best;
}
function levelCost(model, snapshot, skillId, targetLevel, memo) {
  const target = Math.max(1, Math.min(99, Math.floor(num(targetLevel, 1))));
  const startXp = num(snapshot?.skillXp?.[skillId]);
  const start = levelForXp(model.xpTable, startXp);
  if (target <= start) return 0;
  const key = `${skillId}:${target}:${start}`;
  if (memo.has(key)) return memo.get(key);
  let total = 0;
  for (let level = start; level < target; level += 1) {
    const segmentXp = Math.max(startXp, xpForLevel(model.xpTable, level));
    const gap = Math.max(0, xpForLevel(model.xpTable, level + 1) - segmentXp);
    const segmentState = { ...snapshot, skillXp: { ...(snapshot?.skillXp ?? {}), [skillId]: segmentXp } };
    let rate = 0;
    for (const action of model._index.actionsBySkill.get(skillId) ?? []) {
      if (num(action.levelReq) > level || (action.gate?.mapId && !stateFacts(model, snapshot).has(`map:${action.gate.mapId}`))) continue;
      const xp = xpPerRun(model, segmentState, skillId, action);
      const interval = effectiveInterval(model, segmentState, skillId, action);
      if (xp > 0 && interval > 0) rate = Math.max(rate, xp / interval);
    }
    if (rate <= 0) { total = Number.POSITIVE_INFINITY; break; }
    total += gap / rate;
  }
  memo.set(key, total); return total;
}
function providerInterval(model, snapshot, provider) {
  if (provider.kind === 'action') return effectiveInterval(model, snapshot, provider.skillId, provider.action);
  if (provider.kind === 'chart') return cartographyInterval(model, snapshot, provider.map);
  // Manual operations have no automatable duration. Their expected cost is an unlock
  // dependency cost only; this keeps them visible without pretending a click has TTK.
  return 0;
}

/**
 * Compute least labels for all facts reachable from the snapshot. Labels are expected
 * milliseconds; provider edge costs include input acquisition at current-state rates.
 */
export function computeReach(model, snapshotOrFacts = {}) {
  if (!model?._index) model = (awaitImportModel(model)); // never reached for indexed consumers
  const snapshot = snapshotOrFacts instanceof Set || Array.isArray(snapshotOrFacts) ? {} : snapshotOrFacts ?? {};
  const initial = stateFacts(model, snapshotOrFacts);
  const costs = new Map(); const chosenProvider = new Map(); const parents = new Map();
  for (const fact of initial) { costs.set(fact, 0); parents.set(fact, []); }
  const itemCosts = new Map();
  const itemProvider = new Map();
  const levelMemo = new Map();
  const rateGold = goldRate(model, snapshot);
  const candidateItemCost = (itemId) => {
    const stock = currentQty(snapshot, itemId);
    if (stock > 0) return 0;
    return itemCosts.get(itemId) ?? Number.POSITIVE_INFINITY;
  };
  for (const fact of model._index.factUniverse) if (fact.startsWith('level:') && !costs.has(fact)) {
    const [, skill, level] = fact.split(':');
    const cost = levelCost(model, snapshot, skill, num(level), levelMemo);
    if (finite(cost)) {
      costs.set(fact, cost); chosenProvider.set(fact, { id: `level:${skill}:${level}`, kind: 'level', skillId: skill, level: num(level) });
      parents.set(fact, []);
    }
  }
  // Iterative relaxation is label-setting for monotone hyperedges and also handles
  // simple production chains without introducing a second graph representation.
  for (let pass = 0; pass < Math.max(8, model._index.providers.length * 2 + 8); pass += 1) {
    let changed = false;
    for (const provider of model._index.providers) {
      let requirementCost = 0; let ready = true;
      const providerParents = [];
      for (const fact of provider.requires ?? []) {
        let cost = costs.get(fact);
        if (!finite(cost) && fact.startsWith('level:')) {
          const [, skill, level] = fact.split(':');
          cost = levelCost(model, snapshot, skill, num(level), levelMemo);
        }
        if (!finite(cost)) { ready = false; break; }
        requirementCost += cost; providerParents.push(fact);
      }
      if (!ready) continue;
      for (const [itemId, neededValue] of Object.entries(provider.consumesItems ?? {})) {
        const needed = Math.max(0, num(neededValue) - currentQty(snapshot, itemId));
        if (!needed) continue;
        const cost = candidateItemCost(itemId);
        if (!finite(cost)) { ready = false; break; }
        requirementCost += needed * cost;
      }
      if (!ready) continue;
      if (provider.consumesGold > 0) {
        const neededGold = Math.max(0, provider.consumesGold - num(snapshot?.gold));
        if (neededGold > 0) {
          if (rateGold <= 0) { ready = false; continue; }
          requirementCost += neededGold / rateGold;
        }
      }
      const runCost = providerInterval(model, snapshot, provider);
      const totalCost = requirementCost + runCost;
      for (const [itemId, outputValue] of Object.entries(provider.producesItems ?? {})) {
        const output = num(outputValue);
        if (output <= 0) continue;
        const unit = totalCost / output;
        const old = itemCosts.get(itemId);
        const oldProvider = itemProvider.get(itemId);
        if (old === undefined || unit < old - 1e-9 || (Math.abs(unit - old) <= 1e-9 && provider.id < (oldProvider?.id ?? '\uffff'))) {
          itemCosts.set(itemId, unit); itemProvider.set(itemId, provider); changed = true;
        }
      }
      for (const fact of provider.grantsFacts ?? []) {
        const old = costs.get(fact);
        if (old === undefined || totalCost < old - 1e-9 || (Math.abs(totalCost - old) <= 1e-9 && provider.id < (chosenProvider.get(fact)?.id ?? '\uffff'))) {
          costs.set(fact, totalCost); chosenProvider.set(fact, provider); parents.set(fact, providerParents); changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // Level facts are computed with the per-segment leveling DP and can satisfy provider gates.
  for (const fact of model._index.factUniverse) if (fact.startsWith('level:') && !costs.has(fact)) {
    const [, skill, level] = fact.split(':');
    const cost = levelCost(model, snapshot, skill, num(level), levelMemo);
    if (finite(cost)) {
      costs.set(fact, cost); chosenProvider.set(fact, { id: `level:${skill}:${level}`, kind: 'level', skillId: skill, level: num(level) });
      parents.set(fact, []);
    }
  }
  // A level label can unlock an action whose item provider was deferred in the prior pass.
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    for (const provider of model._index.providers) {
      let ready = true; let total = 0; const providerParents = [];
      for (const fact of provider.requires ?? []) {
        const cost = costs.get(fact); if (!finite(cost)) { ready = false; break; }
        total += cost; providerParents.push(fact);
      }
      if (!ready) continue;
      for (const [itemId, value] of Object.entries(provider.consumesItems ?? {})) {
        const missing = Math.max(0, num(value) - currentQty(snapshot, itemId));
        total += missing * (itemCosts.get(itemId) ?? Number.POSITIVE_INFINITY);
      }
      if (provider.consumesGold > 0) {
        const neededGold = Math.max(0, provider.consumesGold - num(snapshot?.gold));
        total += neededGold > 0 && rateGold > 0 ? neededGold / rateGold : neededGold > 0 ? Number.POSITIVE_INFINITY : 0;
      }
      if (!finite(total)) continue;
      total += providerInterval(model, snapshot, provider);
      for (const fact of provider.grantsFacts ?? []) {
        const old = costs.get(fact);
        if (old === undefined || total < old - 1e-9 || (Math.abs(total - old) <= 1e-9 && provider.id < (chosenProvider.get(fact)?.id ?? '\uffff'))) {
          costs.set(fact, total); chosenProvider.set(fact, provider); parents.set(fact, providerParents); changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const labels = new Map([...costs].map(([fact, cost]) => [fact, { cost, chosenProvider: chosenProvider.get(fact), parents: parents.get(fact) ?? [] }]));
  const result = {
    facts: labels,
    costs,
    chosenProvider,
    parents,
    itemCosts,
    itemProviders: itemProvider,
    get(fact) { return labels.get(fact) ?? null; },
    cost(fact) { return costs.get(fact) ?? Number.POSITIVE_INFINITY; },
    has(fact) { return finite(costs.get(fact)); },
  };
  return result;
}

// Kept as a defensive error rather than importing model.js dynamically (the public API
// requires callers to pass an indexed model, and synchronous browser bundles cannot await).
function awaitImportModel(model) { throw new TypeError('computeReach requires the result of indexModel(modelJson)'); }

export function timeToLevel(model, snapshot = {}, skillId, targetLevel) {
  return levelCost(model, snapshot, skillId, targetLevel, new Map());
}

export { levelCost };
