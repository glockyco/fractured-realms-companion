/** Deterministic, snapshot-only dependency planning for the companion overlay. */

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function quantity(map, itemId) {
  if (!map || typeof map !== 'object') return 0;
  return Math.max(0, number(map[itemId], 0));
}

function threshold(table, level) {
  if (Array.isArray(table)) {
    const value = table[table.length >= 100 ? level : level - 1];
    return Number.isFinite(Number(value)) ? Number(value) : Number.POSITIVE_INFINITY;
  }
  if (table && typeof table === 'object') {
    const value = table[level] ?? table[String(level)];
    return Number.isFinite(Number(value)) ? Number(value) : Number.POSITIVE_INFINITY;
  }
  return level === 1 ? 0 : Number.POSITIVE_INFINITY;
}

/** Return the highest level whose threshold is <= xp. */
export function levelForXp(xpTable, xp) {
  const value = Math.max(0, number(xp, 0));
  for (let level = 99; level >= 1; level -= 1) {
    if (threshold(xpTable, level) <= value) return level;
  }
  return 1;
}

function actionEntries(actions) {
  if (!actions || typeof actions !== 'object') return [];
  const result = [];
  for (const [skillId, list] of Object.entries(actions)) {
    if (Array.isArray(list)) {
      for (const action of list) if (action && typeof action === 'object') result.push({ skillId, action });
    } else if (list && typeof list === 'object') {
      for (const [id, action] of Object.entries(list)) {
        if (action && typeof action === 'object') result.push({ skillId, action: { id, ...action } });
      }
    }
  }
  return result;
}

function outputOf(action, itemId) {
  const value = number(action?.outputs?.[itemId], 0);
  return value > 0 ? value : 0;
}

function itemName(items, itemId) {
  if (Array.isArray(items)) return items.find((item) => item?.id === itemId)?.label ?? itemId;
  return items?.[itemId]?.label ?? itemId;
}

function requiredLevel(action) {
  return Math.max(number(action?.levelReq, 0), number(action?.gateLevelReq, 0));
}

function sourceCompare(left, right) {
  const level = requiredLevel(left.action) - requiredLevel(right.action);
  if (level) return level;
  const interval = number(left.action.interval, Number.POSITIVE_INFINITY)
    - number(right.action.interval, Number.POSITIVE_INFINITY);
  if (interval) return interval;
  const skill = String(left.skillId).localeCompare(String(right.skillId));
  return skill || String(left.action.id ?? '').localeCompare(String(right.action.id ?? ''));
}

function requiredTool(action) {
  const required = action?.toolReq;
  if (required == null || required === '') return null;
  if (typeof required === 'string') return required;
  return required?.item ?? required?.id ?? null;
}

function hasToolUnlock(action, equipment) {
  const toolId = requiredTool(action);
  return !toolId || quantity(equipment, toolId) > 0;
}

function isBagFull(snapshot) {
  const inventory = snapshot?.inventory && typeof snapshot.inventory === 'object' ? snapshot.inventory : {};
  const reserved = new Set();
  if (snapshot?.combatWeapon && snapshot.combatWeapon !== 'fists') reserved.add(snapshot.combatWeapon);
  const armour = snapshot?.equippedArmour && typeof snapshot.equippedArmour === 'object' ? snapshot.equippedArmour : {};
  for (const [slot, itemId] of Object.entries(armour)) if (slot !== 'ammo' && itemId) reserved.add(itemId);
  const occupied = Object.entries(inventory).reduce((count, [itemId, value]) => (
    number(value, 0) - (reserved.has(itemId) ? 1 : 0) > 0 ? count + 1 : count
  ), 0);
  return occupied >= Math.max(0, number(snapshot?.bagSize, 48));
}

function blockedStep(itemId, items, reason, details = {}) {
  return {
    skillId: details.skillId ?? '',
    actionId: details.actionId ?? '',
    actionName: details.actionName ?? itemName(items, itemId),
    count: 0,
    produceItemId: itemId,
    produceQty: 0,
    levelReq: requiredLevel(details),
    interval: number(details.interval, 0),
    blocked: { reason, ...details },
  };
}

export function actionBlocker(datasets = {}, snapshot = {}, skillId, action = {}) {
  const skillXp = snapshot?.skillXp && typeof snapshot.skillXp === 'object' ? snapshot.skillXp : {};
  const level = levelForXp(datasets.xp, skillXp[skillId]);
  const minLevel = requiredLevel(action);
  if (level < minLevel) return { reason: 'level', skillId, minLevel, currentLevel: level, actionName: action.name ?? action.id };
  const toolId = requiredTool(action);
  if (toolId && !hasToolUnlock(action, snapshot?.equipment)) {
    return { reason: 'tool', toolId, toolName: datasets.strings?.[`name.${toolId}`] ?? itemName(datasets.items, toolId), actionName: action.name ?? action.id };
  }
  if (action.patternReq && !(snapshot?.unlockedGlyphPatterns || []).includes(action.patternReq)) {
    return { reason: 'pattern', patternId: action.patternReq, actionName: action.name ?? action.id };
  }
  const minPrayerLevel = number(action.prayerReq, 0);
  if (minPrayerLevel && levelForXp(datasets.xp, skillXp.prayer) < minPrayerLevel) {
    return { reason: 'prayer', minPrayerLevel, actionName: action.name ?? action.id };
  }
  if (action.mapReq && !(snapshot?.chartedMaps || []).includes(action.mapReq)) {
    return { reason: 'map', mapId: action.mapReq, actionName: action.name ?? action.id };
  }
  if (action.recipeScroll && !(snapshot?.unlockedRecipes || []).includes(action.id)) {
    return { reason: 'recipe', recipeScrollId: action.recipeScroll, actionName: action.name ?? action.id };
  }
  for (const [itemId, required] of Object.entries(action.inputs || {})) {
    const available = quantity(snapshot?.inventory, itemId);
    if (available < number(required, 0)) return { reason: 'input', itemId, required: number(required, 0), available, actionName: action.name ?? action.id };
  }
  if (isBagFull(snapshot)) return { reason: 'bag-full', bagSize: Math.max(0, number(snapshot?.bagSize, 48)), actionName: action.name ?? action.id };
  return null;
}

/**
 * Resolve a requested item into post-order direct actions. produceQty is total
 * deterministic output for the step, not output per invocation.
 */
export function createPlan(datasets = {}, snapshot = {}, request = {}) {
  const entries = actionEntries(datasets.actions);
  const inventory = snapshot?.inventory && typeof snapshot.inventory === 'object' ? snapshot.inventory : {};
  const equipment = snapshot?.equipment && typeof snapshot.equipment === 'object' ? snapshot.equipment : {};
  const skillXp = snapshot?.skillXp && typeof snapshot.skillXp === 'object' ? snapshot.skillXp : {};
  const unlockedGlyphPatterns = new Set(Array.isArray(snapshot?.unlockedGlyphPatterns) ? snapshot.unlockedGlyphPatterns : []);
  const unlockedRecipes = new Set(Array.isArray(snapshot?.unlockedRecipes) ? snapshot.unlockedRecipes : []);
  const chartedMaps = new Set(Array.isArray(snapshot?.chartedMaps) ? snapshot.chartedMaps : []);
  const projected = Object.create(null);
  for (const [id, value] of Object.entries(inventory)) projected[id] = Math.max(0, number(value, 0));

  const deterministic = new Map();
  const rare = new Map();
  for (const source of entries) {
    for (const [id, value] of Object.entries(source.action.outputs ?? {})) {
      const outputQty = number(value, 0);
      if (outputQty > 0) (deterministic.get(id) ?? deterministic.set(id, []).get(id)).push({ ...source, outputQty });
    }
    for (const output of source.action.rareOutputs ?? []) {
      const id = output?.item;
      if (!id || number(output.qty, 0) <= 0) continue;
      (rare.get(id) ?? rare.set(id, []).get(id)).push({ ...source, rareOutput: output });
    }
  }
  for (const list of deterministic.values()) list.sort(sourceCompare);
  for (const list of rare.values()) list.sort(sourceCompare);

  const steps = [];
  const satisfied = [];
  const indexes = new Map();
  const stack = [];
  let failure;

  const addStep = (source, count, itemId) => {
    const action = source.action;
    const key = `${source.skillId}\u0000${String(action.id ?? '')}\u0000${itemId}`;
    const produceQty = source.outputQty * count;
    const existing = indexes.get(key);
    if (existing !== undefined) {
      steps[existing].count += count;
      steps[existing].produceQty += produceQty;
      return steps[existing];
    }
    const step = {
      skillId: source.skillId,
      actionId: String(action.id ?? ''),
      actionName: action.name ?? action.label ?? String(action.id ?? ''),
      count,
      produceItemId: itemId,
      produceQty,
      levelReq: requiredLevel(action),
      interval: number(action.interval, 0),
    };
    indexes.set(key, steps.length);
    steps.push(step);
    return step;
  };

  const fail = (itemId, reason, details = {}, source) => {
    const action = source?.action;
    const enriched = {
      ...details,
      ...(source ? {
        skillId: source.skillId,
        actionId: action?.id ?? '',
        actionName: action?.name ?? action?.label ?? action?.id ?? itemName(datasets.items, itemId),
        levelReq: requiredLevel(action),
        gateLevelReq: action?.gateLevelReq,
        interval: action?.interval,
      } : {}),
    };
    if (!failure) failure = { reason, itemId, ...enriched };
    steps.push(blockedStep(itemId, datasets.items, reason, enriched));
    return { ok: false };
  };

  const applyGates = (candidates) => {
    let eligible = candidates.filter(({ source }) => hasToolUnlock(source.action, equipment));
    if (!eligible.length) {
      const source = candidates.map(({ source: candidate }) => candidate).sort(sourceCompare)[0];
      const toolId = requiredTool(source.action);
      return { eligible: [], blocked: { reason: 'tool', details: {
        toolId,
        toolName: datasets.strings?.[`name.${toolId}`] ?? itemName(datasets.items, toolId),
      }, source } };
    }

    const patternCandidates = eligible;
    eligible = patternCandidates.filter(({ source }) => !source.action.patternReq || unlockedGlyphPatterns.has(source.action.patternReq));
    if (!eligible.length) {
      const source = patternCandidates.map(({ source: candidate }) => candidate).sort(sourceCompare)[0];
      return { eligible: [], blocked: { reason: 'pattern', details: { patternId: source.action.patternReq }, source } };
    }

    const prayerCandidates = eligible;
    eligible = prayerCandidates.filter(({ source }) => (
      !source.action.prayerReq || levelForXp(datasets.xp, skillXp.prayer) >= number(source.action.prayerReq, 0)
    ));
    if (!eligible.length) {
      const source = prayerCandidates.map(({ source: candidate }) => candidate).sort(sourceCompare)[0];
      return { eligible: [], blocked: { reason: 'prayer', details: { minPrayerLevel: number(source.action.prayerReq, 0) }, source } };
    }

    const mapCandidates = eligible;
    eligible = mapCandidates.filter(({ source }) => !source.action.mapReq || chartedMaps.has(source.action.mapReq));
    if (!eligible.length) {
      const source = mapCandidates.map(({ source: candidate }) => candidate).sort(sourceCompare)[0];
      return { eligible: [], blocked: { reason: 'map', details: { mapId: source.action.mapReq }, source } };
    }

    const recipeCandidates = eligible;
    eligible = recipeCandidates.filter(({ source }) => !source.action.recipeScroll || unlockedRecipes.has(source.action.id));
    if (!eligible.length) {
      const source = recipeCandidates.map(({ source: candidate }) => candidate).sort(sourceCompare)[0];
      return { eligible: [], blocked: { reason: 'recipe', details: { recipeScrollId: source.action.recipeScroll }, source } };
    }
    return { eligible, blocked: null };
  };

  const rareChances = (sources) => sources.map(({ skillId, action, rareOutput }) => ({
    skillId,
    actionId: action.id ?? '',
    actionName: action.name ?? action.id ?? itemName(datasets.items, rareOutput?.item),
    chance: number(rareOutput?.chance, 0),
    qty: number(rareOutput?.qty, 0),
  }));

  const recordSatisfied = (itemId, requiredQty, satisfiedQty) => {
    const covered = Math.min(Math.max(0, number(requiredQty, 0)), Math.max(0, number(satisfiedQty, 0)));
    if (!covered) return;
    satisfied.push({ itemId, requiredQty: Math.max(0, number(requiredQty, 0)), satisfiedQty: covered });
  };

  const ensure = (itemId, requested) => {
    const needRequested = Math.max(0, number(requested, 0));
    if (needRequested <= 0) return { ok: true };
    if (stack.includes(itemId)) return fail(itemId, 'cycle', { path: [...stack, itemId] });
    const available = quantity(projected, itemId);
    recordSatisfied(itemId, needRequested, available);
    const need = Math.max(0, needRequested - available);
    if (need <= 0) return { ok: true };

    const sources = deterministic.get(itemId) ?? [];
    const levels = sources.map((source) => ({ source, level: levelForXp(datasets.xp, skillXp[source.skillId]) }));
    const levelEligible = levels.filter(({ source, level }) => level >= requiredLevel(source.action));
    if (!levelEligible.length) {
      if (sources.length) {
        const source = [...sources].sort(sourceCompare)[0];
        return fail(itemId, 'level', {
          minLevel: requiredLevel(source.action),
          actionName: source.action.name ?? source.action.id ?? itemName(datasets.items, itemId),
          currentLevel: levelForXp(datasets.xp, skillXp[source.skillId]),
          skillId: source.skillId,
        }, source);
      }

      const rareSources = rare.get(itemId) ?? [];
      if (!rareSources.length) return fail(itemId, 'no-source');
      const rareLevels = rareSources.map((source) => ({ source, level: levelForXp(datasets.xp, skillXp[source.skillId]) }));
      const rareLevelEligible = rareLevels.filter(({ source, level }) => level >= requiredLevel(source.action));
      if (!rareLevelEligible.length) {
        const source = [...rareSources].sort(sourceCompare)[0];
        return fail(itemId, 'level', {
          minLevel: requiredLevel(source.action),
          actionName: source.action.name ?? source.action.id ?? itemName(datasets.items, itemId),
          currentLevel: levelForXp(datasets.xp, skillXp[source.skillId]),
          skillId: source.skillId,
        }, source);
      }
      const rareGates = applyGates(rareLevelEligible);
      if (!rareGates.eligible.length) {
        const { reason, details, source } = rareGates.blocked;
        return fail(itemId, reason, details, source);
      }
      const source = rareGates.eligible.map(({ source: candidate }) => candidate).sort(sourceCompare)[0];
      if (Object.keys(source.action.inputs ?? {}).length > 0) {
        return fail(itemId, 'rare-only', { chances: rareChances(rareSources) }, source);
      }
      const rareOutput = source.rareOutput;
      const chance = number(rareOutput?.chance, 0);
      const normalized = chance > 1 ? chance / 100 : chance;
      const perHit = Math.max(1, number(rareOutput?.qty, 0));
      if (normalized <= 0) return fail(itemId, 'rare-only', { chances: rareChances(rareSources) }, source);
      const expectedRuns = Math.ceil(need / (normalized * perHit));
      steps.push({
        skillId: source.skillId,
        actionId: String(source.action.id ?? ''),
        actionName: source.action.name ?? source.action.label ?? String(source.action.id ?? ''),
        count: expectedRuns,
        produceItemId: itemId,
        produceQty: need,
        rare: true,
        chance: normalized,
        progressItemId: Object.keys(source.action.outputs ?? {})[0] ?? null,
        levelReq: requiredLevel(source.action),
        interval: number(source.action.interval, 0),
      });
      projected[itemId] = quantity(projected, itemId) + need;
      return { ok: true };
    }

    const gates = applyGates(levelEligible);
    if (!gates.eligible.length) {
      const { reason, details, source } = gates.blocked;
      return fail(itemId, reason, details, source);
    }
    const source = gates.eligible.map(({ source: candidate }) => candidate).sort(sourceCompare)[0];
    const count = Math.ceil(need / source.outputQty);
    stack.push(itemId);
    for (const [inputId, inputPerRun] of Object.entries(source.action.inputs ?? {})) {
      const required = number(inputPerRun, 0) * count;
      if (required <= 0) continue;
      const result = ensure(inputId, required);
      if (!result.ok) {
        stack.pop();
        return result;
      }
      projected[inputId] = quantity(projected, inputId) - required;
    }
    stack.pop();
    for (const [outputItemId, outputValue] of Object.entries(source.action.outputs ?? {})) {
      const outputQty = number(outputValue, 0);
      if (outputQty > 0) projected[outputItemId] = quantity(projected, outputItemId) + outputQty * count;
    }
    addStep(source, count, itemId);
    return { ok: true };
  };

  const itemId = request?.itemId;
  const requested = number(request?.qty, 0);
  if (!itemId || requested <= 0) return { ok: true, steps: [], satisfied };
  if (quantity(inventory, itemId) < requested && isBagFull(snapshot)) {
    fail(itemId, 'bag-full', { bagSize: Math.max(0, number(snapshot?.bagSize, 48)) });
  } else if (ensure(itemId, requested).ok) return { ok: true, steps, satisfied };
  const message = failure?.reason === 'level'
    ? `Requires level ${failure.minLevel} (${failure.actionName})`
    : failure?.reason === 'tool' ? `Requires unlocked tool ${failure.toolName}`
      : failure?.reason === 'pattern' ? `Requires glyph pattern ${failure.patternId}`
        : failure?.reason === 'prayer' ? `Requires Prayer level ${failure.minPrayerLevel}`
          : failure?.reason === 'map' ? `Requires charted map ${failure.mapId}`
            : failure?.reason === 'recipe' ? `Requires learned recipe ${failure.actionName}`
              : failure?.reason === 'bag-full' ? 'Requires at least one free bag slot'
                : failure?.reason === 'rare-only' ? 'Only available as a rare drop'
                  : failure?.reason === 'cycle' ? 'Dependency cycle detected'
                    : `No deterministic source for ${itemName(datasets.items, itemId)}`;
  return { ok: false, steps, satisfied, blocked: failure, reason: failure?.reason, message };
}
