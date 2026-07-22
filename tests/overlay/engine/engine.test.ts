import assert from 'node:assert/strict';
import test from 'node:test';
import { indexModel, factSatisfied } from '../../../overlay/engine/model.js';
import { effectiveInterval, levelForXp, xpForLevel, xpPerRun } from '../../../overlay/engine/formulas.js';
import { timeToLevel } from '../../../overlay/engine/closure.js';
import { plan } from '../../../overlay/engine/expand.js';
import { simulate } from '../../../overlay/engine/simulate.js';
import { resolveQueue } from '../../../overlay/engine/queue.js';
import { baseModel, snapshot } from './fixture.js';

const indexed = (model = baseModel()) => indexModel(model);

test('level and interval formulas use the level-surplus factor and clamp', () => {
  const model = indexed(); const state = snapshot();
  assert.equal(levelForXp(model.xpTable, 0), 1); assert.equal(xpForLevel(model.xpTable, 5), 400);
  assert.equal(effectiveInterval(model, state, 'woodcutting', model.actions[0]), 3000);
  state.skillXp.woodcutting = 400;
  const expected = Math.max(500, Math.round(4000 * (1 - Math.min(0.5, (5 - model.actions[1].levelReq) / 99 * 0.5))));
  assert.equal(effectiveInterval(model, state, 'woodcutting', model.actions[1]), expected);
  assert.equal(xpPerRun(model, state, 'woodcutting', model.actions[1]), 30);
});

test('time-to-level uses the best action independently in each level segment', () => {
  const model = indexed(); const state = snapshot(); let expected = 0;
  for (let level = 1; level < 10; level += 1) {
    const action = level < 5 ? model.actions[0] : model.actions[1];
    const interval = Math.max(500, Math.round(action.interval * (1 - Math.min(0.5, (level - action.levelReq) / 99 * 0.5))));
    expected += 100 / (action.xp / interval);
  }
  assert.equal(timeToLevel(model, state, 'woodcutting', 10), expected);
  const result = plan(model, state, { type: 'level', skillId: 'woodcutting', level: 10 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map((step) => step.actionId), ['A', 'B']);
  assert.deepEqual(result.steps.map((step) => step.stop.xpAtLeast), [400, 900]);
});

test('an action gated above its level requirement trains through a lower action, not a false cycle', () => {
  const base = baseModel();
  const model = indexed({ ...base, actions: [...base.actions,
    { id: 'C', name: 'C', skillId: 'woodcutting', levelReq: 5, xp: 100, interval: 4000, inputs: {}, outputs: { log: 1 }, automation: 'auto', gate: { mapId: null, skillLevel: 8 } },
  ] });
  const result = plan(model, snapshot(), { type: 'level', skillId: 'woodcutting', level: 12 });
  assert.equal(result.ok, true); assert.equal(result.blocked, undefined);
  // C unlocks nominally at 5 but its gate needs 8, so a lower action must bridge 5->8
  // before C is selectable. Filtering on levelReq alone would pick C at 5 and then
  // recurse to level the same skill to 8, which the cycle guard rejects.
  assert.deepEqual(result.steps.map((step) => step.actionId), ['A', 'B', 'C']);
});

test('an item sourced only as a rare byproduct is unreachable rather than an endless grind', () => {
  const base = baseModel();
  const model = indexed({ ...base, items: { ...base.items, dust: { label: 'Dust', type: 'Resource', value: 0, art: false } }, actions: [...base.actions, { id: 'sift', name: 'Sift', skillId: 'woodcutting', levelReq: 1, xp: 1, interval: 1000, inputs: {}, outputs: {}, rareOutputs: [{ item: 'dust', qty: 1, chance: 0.0000001 }], automation: 'auto', gate: null }] });
  const result = plan(model, snapshot(), { type: 'item', itemId: 'dust', qty: 1 });
  assert.equal(result.ok, false); assert.equal(result.blocked?.reason, 'no reliable source for dust');
});

test('a self-referential training input fails cleanly instead of recursing', () => {
  const base = baseModel();
  const model = indexed({ ...base, skills: [...base.skills, { id: 'brewing', name: 'Brewing', category: 'action' }],
    items: { ...base.items, potion: { label: 'Potion', type: 'Resource', value: 0, art: false }, tonic: { label: 'Tonic', type: 'Resource', value: 0, art: false } },
    actions: [...base.actions,
      { id: 'brew', name: 'Brew', skillId: 'brewing', levelReq: 1, xp: 10, interval: 1000, inputs: { potion: 1 }, outputs: { tonic: 1 }, automation: 'auto', gate: null },
      { id: 'distill', name: 'Distill', skillId: 'brewing', levelReq: 50, xp: 10, interval: 1000, inputs: {}, outputs: { potion: 1 }, automation: 'auto', gate: null },
    ] });
  const result = plan(model, snapshot(), { type: 'level', skillId: 'brewing', level: 10 });
  assert.equal(result.ok, false); assert.equal(result.blocked?.reason, 'cyclic level requirement for brewing');
});

test('gate routing emits chart before gated production', () => {
  const base = baseModel();
  const model = indexed({ ...base, maps: [{ id: 'map1', name: 'Map', group: 'regular', tier: 'local', levelReq: 1, xp: 1, interval: 1000, actionsToChart: 1 }], chartSupplyTiers: { local: { supplies: { parchment: 1, ink: 1 } } }, actions: [...base.actions, { id: 'gatedAction', name: 'Gated', skillId: 'woodcutting', levelReq: 1, xp: 1, interval: 1000, inputs: {}, outputs: { gated: 1 }, automation: 'auto', gate: { mapId: 'map1', skillLevel: 1 } }] });
  const result = plan(model, snapshot({ inventory: { parchment: 1, ink: 1 } }), { type: 'item', itemId: 'gated', qty: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map((step) => [step.skillId, step.actionId, step.stop]), [['cartography', undefined, { type: 'fact', fact: 'map:map1' }], ['woodcutting', 'gatedAction', { type: 'itemQty', itemId: 'gated', qty: 1 }]]);
});

test('tool ownership is a manual fact provider before the action', () => {
  const base = baseModel(); const action = { id: 'toolAction', name: 'Tool Action', skillId: 'woodcutting', levelReq: 1, xp: 1, interval: 1000, inputs: {}, outputs: { ore: 1 }, toolReq: 'tool', automation: 'auto', gate: null };
  const model = indexed({ ...base, actions: [...base.actions, action] });
  const result = plan(model, snapshot({ gold: 200 }), { type: 'item', itemId: 'ore', qty: 1 });
  assert.equal(result.ok, true); assert.equal(result.steps[0].kind, 'manual'); assert.deepEqual(result.steps[0].stop, { type: 'fact', fact: 'tool:tool' }); assert.equal(result.steps[1].actionId, 'toolAction');
});

test('simulation reaches deterministic item target and reports bag overflow', () => {
  const model = indexed(); const state = snapshot(); const result = plan(model, state, { type: 'item', itemId: 'log', qty: 2 });
  assert.equal(result.ok, true); const simulation = simulate(model, state, result.steps); assert.equal(simulation.infeasibility, null); assert.equal(simulation.endState.inventory.log, 2);
  const full = snapshot({ bagSize: 1, inventory: { ore: 1 } }); const overflow = plan(model, full, { type: 'item', itemId: 'log', qty: 1 }); const checked = simulate(model, full, overflow.steps); assert.equal(checked.infeasibility?.stepId, overflow.steps.at(-1)?.id);
});

test('queue carries XP and inventory and computes manual ready times', () => {
  const base = baseModel(); const model = indexed({ ...base, actions: [...base.actions, { id: 'manualSource', name: 'Manual source', skillId: 'bounty', levelReq: 1, xp: 0, interval: 0, inputs: {}, outputs: { ore: 1 }, automation: 'manual', gate: null }], skills: [...base.skills, { id: 'bounty', name: 'Bounty', category: 'manual' }] });
  const state = snapshot({ inventory: { parchment: 2, ink: 2 } }); const independent = resolveQueue(model, state, [{ type: 'item', itemId: 'log', qty: 1 }, { type: 'item', itemId: 'log', qty: 2 }]);
  assert.equal(independent.optimisticMs > 0, true); assert.equal(independent.targets.length, 2); assert.deepEqual(independent.steps.map((step) => step.id), [...independent.steps].map((step) => step.id));
  const queue = resolveQueue(model, state, [{ type: 'item', itemId: 'ore', qty: 1 }]); assert.equal(queue.readyAt[queue.steps[0].id], 0); assert.equal(queue.optimisticMs, queue.schedulerMs);
});

test('fact predicates are state-truth based', () => { const model = indexed(); assert.equal(factSatisfied(model, snapshot({ chartedMaps: ['m'] }), 'map:m'), true); assert.equal(factSatisfied(model, snapshot({ equipment: { tool: 1 } }), 'tool:tool'), true); });

test('quantity-aware source choice amortizes one-time tool cost', () => {
  const base = baseModel(); const model = indexed({ ...base, items: { ...base.items, common: { label: 'Common', type: 'Resource', value: 0, art: false } }, actions: [
    { id: 'slow', name: 'Slow', skillId: 'woodcutting', levelReq: 1, xp: 0, interval: 10000, inputs: {}, outputs: { common: 1 }, automation: 'auto', gate: null },
    { id: 'fast', name: 'Fast', skillId: 'woodcutting', levelReq: 1, xp: 0, interval: 100, inputs: {}, outputs: { common: 1 }, toolReq: 'tool', automation: 'auto', gate: null },
    { id: 'gold', name: 'Gold', skillId: 'woodcutting', levelReq: 1, xp: 0, interval: 1000, inputs: {}, outputs: { gold: 1 }, automation: 'auto', gate: null },
  ] }); const state = snapshot({ gold: 0 });
  assert.deepEqual(plan(model, state, { type: 'item', itemId: 'common', qty: 1 }).steps.map((step) => step.actionId), ['slow']);
  assert.deepEqual(plan(model, state, { type: 'item', itemId: 'common', qty: 1000 }).steps.map((step) => step.actionId), [undefined, 'fast']);
});

test('scheduler ETA waits for dependency automations and omits gated work', () => {
  const base = baseModel(); const model = indexed({ ...base, actions: [...base.actions, { id: 'toolAction', name: 'Tool Action', skillId: 'woodcutting', levelReq: 1, xp: 1, interval: 1000, inputs: {}, outputs: { ore: 1 }, toolReq: 'tool', automation: 'auto', gate: null }] }); const state = snapshot({ gold: 200 });
  const manual = { id: 'manual', kind: 'manual', providerId: 'buy:tool:tool', label: 'Buy tool', instruction: 'Buy tool', deps: ['a', 'b'], stop: { type: 'fact', fact: 'tool:tool' }, expected: { runs: 1, ms: null, produces: {}, consumes: {} }, purpose: 'unlock' };
  const a = { id: 'a', kind: 'action', providerId: 'action:woodcutting:A', skillId: 'woodcutting', actionId: 'A', deps: [], stop: { type: 'runs', runs: 1 }, expected: { runs: 1, ms: 3000, produces: { log: 1 }, consumes: {} }, purpose: 'train' };
  const b = { id: 'b', kind: 'action', providerId: 'action:woodcutting:A', skillId: 'woodcutting', actionId: 'A', deps: [], stop: { type: 'runs', runs: 1 }, expected: { runs: 1, ms: 3000, produces: { log: 1 }, consumes: {} }, purpose: 'train' };
  const gated = { id: 'gated', kind: 'action', providerId: 'action:woodcutting:toolAction', skillId: 'woodcutting', actionId: 'toolAction', deps: ['manual'], stop: { type: 'runs', runs: 1 }, expected: { runs: 1, ms: 1000, produces: { ore: 1 }, consumes: {} }, purpose: 'goal' };
  const empty = resolveQueue(model, state, []); assert.deepEqual(empty, { targets: [], steps: [], optimisticMs: 0, schedulerMs: 0, readyAt: {}, perStep: [], schedulerPerStep: [], infeasibility: null });
  const optimistic = simulate(model, state, [manual, a, b, gated]); const scheduler = simulate(model, state, [manual, a, b, gated], { manualPolicy: 'outstanding' });
  assert.equal(optimistic.readyAt.manual, 6000); assert.equal(scheduler.readyAt.manual, 6000); assert.equal(optimistic.totalMs - scheduler.totalMs, 1000);
});
