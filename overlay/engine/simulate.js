/** Expected-value forward simulator for engine Step IR. */
import { factSatisfied, liveBlocker, occupiedSlots } from './model.js';
import { burnChance, brewDoubleChance, cartographyInterval, effectiveInterval, levelForXp, sealDoubleChance, xpMultiplier, xpPerRun } from './formulas.js';

const num = (value, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const obj = (value) => value && typeof value === 'object' ? value : {};
const arr = (value) => Array.isArray(value) ? value : [];
function cloneState(snapshot = {}) {
  return {
    ...snapshot, skillXp: { ...obj(snapshot.skillXp) }, inventory: { ...obj(snapshot.inventory) }, equipment: { ...obj(snapshot.equipment) },
    chartedMaps: arr(snapshot.chartedMaps).slice(), unlockedRecipes: arr(snapshot.unlockedRecipes).slice(), unlockedGlyphPatterns: arr(snapshot.unlockedGlyphPatterns).slice(), activeBoons: arr(snapshot.activeBoons).slice(), builtMachines: arr(snapshot.builtMachines).slice(), outpostLevels: { ...obj(snapshot.outpostLevels) },
    mapProgress: { ...obj(snapshot.mapProgress) }, supplies: { ...obj(snapshot.supplies) }, bagSize: snapshot.bagSize == null ? 48 : num(snapshot.bagSize, 48), gold: num(snapshot.gold),
  };
}
function add(map, id, value) { map[id] = num(map[id]) + num(value); }
function providerFor(model, step) {
  if (step.providerId) return model._index.providersById.get(step.providerId);
  if (step.actionId != null) return model._index.providersById.get(`action:${step.skillId}:${step.actionId}`);
  return null;
}
function outputIds(model, provider, step) {
  const ids = Object.keys(provider?.producesItems ?? {});
  if (provider?.rare?.length) for (const rare of provider.rare) if (num(rare.qty) * num(rare.chance) > 0) ids.push(rare.item);
  if (provider?.kind === 'action' && provider.skillId === 'cooking') {
    for (const id of Object.keys(provider.producesItems ?? {})) ids.push(`burnt_${String(id).replace(/^.*?_/, '')}`);
  }
  return [...new Set(ids)].filter(Boolean);
}
function checkBag(model, state, provider, step) {
  const before = occupiedSlots(state);
  const postConsume = { ...state.inventory };
  for (const [id, amount] of Object.entries(provider?.consumesItems ?? {})) postConsume[id] = Math.max(0, num(postConsume[id]) - num(amount));
  const afterConsume = Object.values(postConsume).filter((value) => num(value) > 0).length;
  const newIds = outputIds(model, provider, step).filter((id) => num(postConsume[id]) <= 0);
  if (afterConsume + newIds.length > Math.max(0, num(state.bagSize, 48))) return 'bag overflow';
  return null;
}
function applyProviderRun(model, state, provider, step, runs = 1) {
  for (const [id, amount] of Object.entries(provider?.consumesItems ?? {})) state.inventory[id] = Math.max(0, num(state.inventory[id]) - num(amount) * runs);
  if (provider?.consumesGold) state.gold = Math.max(0, num(state.gold) - num(provider.consumesGold) * runs);
  if (provider?.kind === 'chart') {
    const map = provider.map; const done = num(map?.actionsToChart, 1);
    const mapId = provider.mapId;
    const tier = model.chartSupplyTiers?.[map?.tier] ?? { supplies: { parchment: 1, ink: 1 } };
    for (const [id, amount] of Object.entries(tier.supplies ?? {})) state.inventory[id] = Math.max(0, num(state.inventory[id]) - num(amount) * runs);
    state.mapProgress[mapId] = num(state.mapProgress[mapId]) + (100 / done) * runs;
    if (state.mapProgress[mapId] >= 100 - 1e-9 && !state.chartedMaps.includes(mapId)) state.chartedMaps.push(mapId);
  } else {
    const multiplier = (1 + (provider?.skillId === 'brewing' ? brewDoubleChance(model, state) : 0)) * (1 + sealDoubleChance(model, state, provider?.skillId));
    const outputs = { ...provider?.producesItems };
    const cookingBurn = provider?.skillId === 'cooking' ? burnChance(levelForXp(model.xpTable, state.skillXp?.cooking), provider.action?.levelReq) : 0;
    for (const [id, amount] of Object.entries(outputs)) {
      const value = num(amount) * multiplier * runs;
      if (cookingBurn > 0) {
        const suffix = String(id).replace(/^.*?_/, '');
        add(state.inventory, id, value * (1 - cookingBurn));
        add(state.inventory, `burnt_${suffix}`, value * cookingBurn);
      } else add(state.inventory, id, value);
    }
    if (provider?.outputGold) state.gold += num(provider.outputGold) * runs;
  }
  for (const [skillId, amount] of Object.entries(provider?.xpGain ?? {})) {
    const gain = (provider?.kind === 'action' ? xpPerRun(model, state, skillId, provider.action) : provider?.kind === 'chart' ? num(amount) * xpMultiplier(model, state, skillId) : num(amount)) * runs;
    add(state.skillXp, skillId, gain);
  }
  for (const fact of provider?.grantsFacts ?? []) applyFact(model, state, fact);
}
function applyFact(model, state, fact) {
  const [kind, ...rest] = String(fact).split(':'); const id = rest.join(':');
  if (kind === 'map' && !state.chartedMaps.includes(id)) state.chartedMaps.push(id);
  if (kind === 'recipe' && !state.unlockedRecipes.includes(id)) state.unlockedRecipes.push(id);
  if (kind === 'pattern' && !state.unlockedGlyphPatterns.includes(id)) state.unlockedGlyphPatterns.push(id);
  if (kind === 'machine' && !state.builtMachines.includes(id)) state.builtMachines.push(id);
  if (kind === 'boon' && !state.activeBoons.some((entry) => (typeof entry === 'string' ? entry : entry?.id) === id)) state.activeBoons.push({ id });
  if (kind === 'bag') state.bagSize = Math.max(state.bagSize, num(model._index.bagsById.get(id)?.size));
  if (kind === 'outpost') state.outpostLevels[rest[0]] = Math.max(num(state.outpostLevels[rest[0]]), num(rest[1]));
}
function applyManual(model, state, provider, step) {
  // Expected fields carry aggregate quantities; manual XP is represented by provider.xpGain.
  for (const [id, amount] of Object.entries(step.expected?.consumes ?? {})) state.inventory[id] = Math.max(0, num(state.inventory[id]) - num(amount));
  if (provider?.consumesGold) state.gold = Math.max(0, num(state.gold) - num(provider.consumesGold));
  for (const [id, amount] of Object.entries(step.expected?.produces ?? {})) if (id !== 'gold') add(state.inventory, id, amount);
  if (provider?.outputGold) state.gold += num(provider.outputGold);
  const runs = Math.max(1, num(step.expected?.runs, 1));
  for (const [skillId, amount] of Object.entries(provider?.xpGain ?? {})) add(state.skillXp, skillId, num(amount) * runs);
  for (const fact of provider?.grantsFacts ?? []) applyFact(model, state, fact);
  if (provider?.purchase?.type === 'tool') add(state.equipment, provider.purchase.id, 1);
}
function actionDuration(model, state, provider, step, runs) {
  if (provider?.kind === 'chart') return cartographyInterval(model, state, provider.map) * Math.max(1, Math.ceil(runs));
  if (provider?.kind === 'action') return effectiveInterval(model, state, provider.skillId, provider.action) * Math.max(0, runs);
  return 0;
}

/** Simulate all steps using instant optimistic or outstanding manual semantics. */
export function simulate(model, snapshot = {}, steps = [], opts = {}) {
  const state = cloneState(snapshot); const policy = opts.manualPolicy ?? 'instant';
  const perStep = []; const readyAt = {}; const completed = new Set(); const pending = new Set(steps.map((step) => step.id));
  let clock = 0; let infeasibility = null; let progressed = true;
  const fail = (step, reason) => { if (!infeasibility) infeasibility = { stepId: step.id, reason }; };
  const stopAlreadySatisfied = (step) => {
    const stop = step?.stop;
    if (!stop) return false;
    if (stop.type === 'fact') return factSatisfied(model, state, stop.fact);
    if (stop.type === 'itemQty') return num(state.inventory?.[stop.itemId]) >= num(stop.qty);
    if (stop.type === 'xp') return num(state.skillXp?.[stop.skillId]) >= num(stop.xpAtLeast);
    return false;
  };
  const depsReady = (step) => (step.deps ?? []).every((id) => completed.has(id));
  const runAuto = (step, provider) => {
    const runs = Math.max(0, num(step.expected?.runs, 0));
    if (!runs) { completed.add(step.id); pending.delete(step.id); perStep.push({ id: step.id, startMs: clock, endMs: clock }); return true; }
    const start = clock;
    // Walk a bounded number of runs precisely to catch blockers and bag overflow and to
    // let the tick interval settle as XP rises, then extrapolate the remainder. Walking
    // every run explodes for high-level or high-quantity goals (hundreds of thousands of runs).
    const walk = Math.min(runs, 2048);
    for (let run = 0; run < walk; run += 1) {
      const blocker = liveBlocker(model, state, step);
      if (blocker && blocker !== 'bag-full') { fail(step, blocker); return false; }
      const bagError = checkBag(model, state, provider, step);
      if (bagError) { fail(step, bagError); return false; }
      const duration = actionDuration(model, state, provider, step, 1);
      applyProviderRun(model, state, provider, step);
      clock += duration;
    }
    if (runs > walk) {
      const remaining = runs - walk;
      clock += actionDuration(model, state, provider, step, 1) * remaining;
      applyProviderRun(model, state, provider, step, remaining);
    }
    completed.add(step.id); pending.delete(step.id); perStep.push({ id: step.id, startMs: start, endMs: clock }); return true;
  };
  const runManual = (step, provider) => {
    const firstReady = readyAt[step.id] == null;
    if (firstReady) readyAt[step.id] = clock;
    if (policy === 'outstanding') {
      if (firstReady) perStep.push({ id: step.id, startMs: clock, endMs: clock });
      return false;
    }
    const start = clock; applyManual(model, state, provider, step); completed.add(step.id); pending.delete(step.id);
    perStep.push({ id: step.id, startMs: start, endMs: clock }); return true;
  };
  // Repeated passes allow later independent actions to run around an outstanding manual
  // step and allow manual steps whose dependencies finish later to receive their ETA.
  while (progressed && pending.size && !infeasibility) {
    progressed = false;
    for (const step of steps) {
      if (!pending.has(step.id) || !depsReady(step)) continue;
      if (stopAlreadySatisfied(step)) {
        if (step.kind === 'manual' && readyAt[step.id] == null) readyAt[step.id] = clock;
        completed.add(step.id); pending.delete(step.id); perStep.push({ id: step.id, startMs: clock, endMs: clock }); progressed = true; continue;
      }
      const provider = providerFor(model, step);
      if (step.kind === 'manual') {
        const did = runManual(step, provider); progressed ||= did;
        continue;
      }
      if (!provider) { fail(step, 'missing provider'); break; }
      const before = pending.size; const did = runAuto(step, provider); progressed ||= pending.size < before;
      if (infeasibility) break;
      if (!did && pending.size === before) continue;
    }
    // A pending auto step that is blocked by an outstanding manual dependency is not a
    // global failure: scheduler-faithful simulation simply stops when no independent work remains.
  }
  // Manual steps with no outstanding dependencies become actionable at the final simulated moment.
  for (const step of steps) if (step.kind === 'manual' && readyAt[step.id] == null && pending.has(step.id) && (step.deps ?? []).every((id) => completed.has(id))) readyAt[step.id] = clock;
  return { perStep, endState: state, infeasibility, totalMs: clock, readyAt };
}

export { cloneState, providerFor };
