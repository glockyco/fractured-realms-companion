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

function sourceCompare(left, right) {
  const level = number(left.action.levelReq, 0) - number(right.action.levelReq, 0);
  if (level) return level;
  const interval = number(left.action.interval, Number.POSITIVE_INFINITY)
    - number(right.action.interval, Number.POSITIVE_INFINITY);
  if (interval) return interval;
  const skill = String(left.skillId).localeCompare(String(right.skillId));
  return skill || String(left.action.id ?? '').localeCompare(String(right.action.id ?? ''));
}

function warningFor(action, inventory, equipment) {
  const required = action?.toolReq;
  if (required == null || required === '') return undefined;
  const tools = Array.isArray(required) ? required : [required];
  for (const value of tools) {
    const tool = typeof value === 'string' ? value : value?.item ?? value?.id;
    if (tool && quantity(inventory, tool) + quantity(equipment, tool) <= 0) return { tool };
  }
  return undefined;
}

function blockedStep(itemId, items, reason, details = {}) {
  return {
    skillId: details.skillId ?? '',
    actionId: details.actionId ?? '',
    actionName: details.actionName ?? itemName(items, itemId),
    count: 0,
    produceItemId: itemId,
    produceQty: 0,
    levelReq: number(details.levelReq, 0),
    interval: number(details.interval, 0),
    blocked: { reason, ...details },
  };
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
      levelReq: number(action.levelReq, 0),
      interval: number(action.interval, 0),
    };
    const warning = warningFor(action, inventory, equipment);
    if (warning) step.warning = warning;
    indexes.set(key, steps.length);
    steps.push(step);
    return step;
  };

  const fail = (itemId, reason, details = {}, source) => {
    if (!failure) failure = { reason, itemId, ...details };
    const action = source?.action;
    steps.push(blockedStep(itemId, datasets.items, reason, {
      ...details,
      ...(source ? {
        skillId: source.skillId,
        actionId: action?.id ?? '',
        actionName: action?.name ?? action?.label ?? action?.id ?? itemName(datasets.items, itemId),
        levelReq: action?.levelReq,
        interval: action?.interval,
      } : {}),
    }));
    return { ok: false };
  };

  const ensure = (itemId, requested) => {
    const needRequested = Math.max(0, number(requested, 0));
    if (needRequested <= 0) return { ok: true };
    if (stack.includes(itemId)) return fail(itemId, 'cycle', { path: [...stack, itemId] });
    const need = Math.max(0, needRequested - quantity(projected, itemId));
    if (need <= 0) return { ok: true };

    const sources = deterministic.get(itemId) ?? [];
    const levels = sources.map((source) => ({ source, level: levelForXp(datasets.xp, skillXp[source.skillId]) }));
    const eligible = levels.filter(({ source, level }) => level >= number(source.action.levelReq, 0));
    if (!eligible.length) {
      if (sources.length) {
        const source = [...sources].sort(sourceCompare)[0];
        return fail(itemId, 'level', {
          minLevel: number(source.action.levelReq, 0),
          actionName: source.action.name ?? source.action.id ?? itemName(datasets.items, itemId),
          currentLevel: levelForXp(datasets.xp, skillXp[source.skillId]),
          skillId: source.skillId,
        }, source);
      }
      const rareSources = rare.get(itemId) ?? [];
      if (rareSources.length) {
        const chances = rareSources.map(({ skillId, action, rareOutput }) => ({
          skillId,
          actionId: action.id ?? '',
          actionName: action.name ?? action.id ?? itemName(datasets.items, itemId),
          chance: number(rareOutput.chance, 0),
          qty: number(rareOutput.qty, 0),
        }));
        return fail(itemId, 'rare-only', { chances }, rareSources[0]);
      }
      return fail(itemId, 'no-source');
    }

    const source = eligible.map(({ source }) => source).sort(sourceCompare)[0];
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
  if (!itemId || requested <= 0) return { ok: true, steps: [] };
  if (ensure(itemId, requested).ok) return { ok: true, steps };
  const message = failure?.reason === 'level'
    ? `Requires level ${failure.minLevel} (${failure.actionName})`
    : failure?.reason === 'rare-only' ? 'Only available as a rare drop'
      : failure?.reason === 'cycle' ? 'Dependency cycle detected'
        : `No deterministic source for ${itemName(datasets.items, itemId)}`;
  return { ok: false, steps, blocked: failure, reason: failure?.reason, message };
}
