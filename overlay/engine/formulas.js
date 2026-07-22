/** Pure game-rate formulas. No module state is mutated. */
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const qty = (map, id) => Math.max(0, number(map?.[id], 0));
const list = (value) => Array.isArray(value) ? value : [];

function threshold(table, level) {
  const requested = Math.max(1, Math.min(99, Math.floor(number(level, 1))));
  if (Array.isArray(table)) {
    const index = table.length >= 100 ? requested : requested - 1;
    const value = Number(table[index]);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }
  if (table && typeof table === 'object') {
    const value = Number(table[requested] ?? table[String(requested)]);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }
  return requested === 1 ? 0 : Number.POSITIVE_INFINITY;
}

/** Return the highest level whose threshold is no greater than xp. */
export function levelForXp(xpTable, xp) {
  const value = Math.max(0, number(xp, 0));
  for (let level = 99; level >= 1; level -= 1) if (threshold(xpTable, level) <= value) return level;
  return 1;
}
export function xpForLevel(xpTable, level) { return threshold(xpTable, level); }

/** Highest owned, level-eligible tool in the skill's ladder. */
export function toolBest(model, state = {}, skillId) {
  const tools = model?._index?.toolsBySkill?.get(skillId) ?? model?.tools?.[skillId] ?? [];
  const level = levelForXp(model?.xpTable, state.skillXp?.[skillId]);
  let best = null;
  for (const tool of list(tools)) {
    if (number(tool.levelReq) > level) continue;
    if (qty(state.equipment, tool.id) <= 0 && qty(state.inventory, tool.id) <= 0) continue;
    if (!best || number(tool.levelReq) > number(best.levelReq)) best = tool;
  }
  return best;
}
function sealEntries(model, state = {}) {
  const seals = list(model?.seals);
  const collected = state.collectedSeals;
  return seals.filter((seal) => (Array.isArray(collected) ? collected.includes(seal.id) : collected?.[seal.id] === true));
}
function applies(buff, skillId, seal) {
  const target = buff.skill ?? seal?.skillId;
  return target === 'all' || target === skillId || (target === 'gathering' && ['woodcutting', 'mining', 'fishing', 'foraging', 'trapping', 'archaeology'].includes(skillId))
    || (target === 'combat' && ['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints'].includes(skillId));
}
export function sealIntervalReduction(model, state, skillId) {
  return sealEntries(model, state).reduce((sum, seal) => sum + list(seal.buffs).filter((buff) => buff.type === 'interval_reduction' && applies(buff, skillId, seal)).reduce((s, buff) => s + number(buff.value), 0), 0);
}
export function sealXpBonus(model, state, skillId) {
  return sealEntries(model, state).reduce((sum, seal) => sum + list(seal.buffs).filter((buff) => buff.type === 'xp' && applies(buff, skillId, seal)).reduce((s, buff) => s + number(buff.value), 0), 0);
}
export function sealDoubleChance(model, state, skillId) {
  return sealEntries(model, state).reduce((sum, seal) => sum + list(seal.buffs).filter((buff) => buff.type === 'double_yield' && applies(buff, skillId, seal)).reduce((s, buff) => s + number(buff.value), 0), 0);
}
export function brewDoubleChance(model, state) {
  return list(model?.machines).filter((machine) => list(state.builtMachines).includes(machine.id) && machine.buff?.type === 'potion_double')
    .reduce((sum, machine) => sum + number(machine.buff?.value), 0);
}
function machineSmithingSpeed(model, state) {
  return list(model?.machines).filter((machine) => list(state.builtMachines).includes(machine.id) && machine.buff?.type === 'smithing')
    .reduce((sum, machine) => sum + number(machine.buff?.speedBonus), 0);
}
function intervalAction(action) { return number(action?.interval, 0); }

/** Effective action-tick interval (milliseconds), including the game's clamp. */
export function effectiveInterval(model, state = {}, skillId, action = {}) {
  if (skillId === 'cartography' && action?.actionsToChart != null) return cartographyInterval(model, state, action);
  const level = levelForXp(model?.xpTable, state.skillXp?.[skillId]);
  const req = number(action.levelReq, 1);
  const best = toolBest(model, state, skillId);
  const toolSpeed = number(best?.speedBonus, 0);
  const smithing = skillId === 'smithing' ? machineSmithingSpeed(model, state) : 0;
  const seal = sealIntervalReduction(model, state, skillId);
  const levelSpeed = Math.min(0.5, Math.max(0, (level - req) / 99 * 0.5));
  const speed = (1 - toolSpeed) * (1 - smithing) * (1 - seal) * (1 - levelSpeed);
  return Math.max(500, Math.round(intervalAction(action) * speed));
}
/** Effective cartography tick interval: cartography has no tool or level-surplus term. */
export function cartographyInterval(model, state = {}, map = {}) {
  return Math.max(500, Math.round(number(map.interval) * (1 - sealIntervalReduction(model, state, 'cartography'))));
}

function machineXpBonus(model, state, skillId) {
  return list(model?.machines).filter((machine) => list(state.builtMachines).includes(machine.id) && machine.buff?.type === 'xp' && list(machine.buff?.skills).some((skill) => skill === skillId || skill === 'all' || (skill === 'gathering' && ['woodcutting', 'mining', 'fishing', 'foraging', 'trapping', 'archaeology'].includes(skillId)) || (skill === 'combat' && ['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints'].includes(skillId))))
    .reduce((sum, machine) => sum + number(machine.buff?.value ?? machine.buff?.xpBonus), 0);
}
/** XP multiplier from every additive save-state bonus. */
export function xpMultiplier(model, state = {}, skillId) {
  let multiplier = 1;
  for (const [buildingId, level] of Object.entries(state.outpostLevels ?? {})) {
    const bonus = model?.buildingXp?.[buildingId]?.[level]?.[skillId];
    multiplier += number(bonus);
  }
  for (const entry of list(state.activeBoons)) {
    const bonuses = typeof entry === 'string' ? model?._index?.boonsById?.get(entry)?.boon?.bonuses : entry?.bonuses;
    multiplier += number(bonuses?.[skillId]);
  }
  multiplier += machineXpBonus(model, state, skillId);
  multiplier += sealXpBonus(model, state, skillId);
  if (state.grandRewardClaimed) multiplier += 0.15;
  multiplier += number(state.prestigeRank?.[skillId]) * 0.01;
  return multiplier;
}
export function xpPerRun(model, state, skillId, action) {
  const best = toolBest(model, state, skillId);
  return number(action?.xp) * xpMultiplier(model, state, skillId) * (1 + number(best?.xpBonus));
}
export function burnChance(level, levelReq) { return 0.37 * (0.8 ** (number(level) - number(levelReq))); }
export function sellValue(item, qtyToSell) { return number(item?.value) * Math.max(0, number(qtyToSell)); }

/** Gold per millisecond from direct gold actions or a single-action sell chain. */
export function goldRate(model, state = {}) {
  let best = 0;
  for (const action of list(model?.actions)) {
    if ((action.automation ?? (action.skillId === 'bounty' ? 'manual' : 'auto')) !== 'auto') continue;
    const interval = effectiveInterval(model, state, action.skillId, action);
    if (interval <= 0) continue;
    let gold = number(action.outputs?.gold);
    for (const [itemId, amount] of Object.entries(action.outputs ?? {})) {
      if (itemId === 'gold') continue;
      gold += sellValue(model.items?.[itemId], amount);
    }
    best = Math.max(best, gold / interval);
  }
  return best;
}

export { threshold };
