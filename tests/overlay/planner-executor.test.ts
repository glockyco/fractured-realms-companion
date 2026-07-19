import assert from 'node:assert/strict';
import test from 'node:test';
import { actionBlocker, createPlan, levelForXp } from '../../overlay/planner.js';
import { createDirectExecutor } from '../../overlay/executor.js';

const xp = () => {
  const table = Array.from({ length: 100 }, () => 0);
  for (let level = 1; level < 100; level += 1) table[level] = level * 100;
  return table;
};
const action = (skillId, id, name, output, inputs = {}, extra = {}) => ({
  skillId, id, name, outputs: { [output]: 1 }, inputs, levelReq: 1, interval: 10, ...extra,
});
const data = (actions) => ({ items: {}, actions, xp: xp() });
const snapshot = (inventory = {}, skillXp = {}) => ({ inventory, equipment: {}, skillXp });

function fakeGame() {
  let clock = 0;
  let nextTimer = 1;
  const timers = new Map();
  const listeners = new Set();
  const state = { inventory: {}, equipment: {}, skillXp: {}, activeSkill: null, activeAction: null, actionQueue: [] };
  const emit = () => { for (const listener of [...listeners]) listener({ ...state, inventory: { ...state.inventory } }); };
  const api = {
    state,
    startAction(skillId, actionId) { state.activeSkill = skillId; state.activeAction = actionId; emit(); },
    stopAction() { state.activeSkill = null; state.activeAction = null; emit(); },
    getState() { return { ...state, inventory: { ...state.inventory } }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const timersApi = {
    now: () => clock,
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      clock += ms;
      let ran = true;
      while (ran) {
        ran = false;
        for (const [id, timer] of [...timers]) if (timer.at <= clock) {
          timers.delete(id); timer.fn(); ran = true;
        }
      }
    },
  };
  return { api, timers: timersApi, emit, produce(itemId, amount = 1) { state.inventory[itemId] = (state.inventory[itemId] ?? 0) + amount; emit(); } };
}

test('levelForXp walks level thresholds from 99 down to 1', () => {
  assert.equal(levelForXp(xp(), 0), 1);
  assert.equal(levelForXp(xp(), 850), 8);
  assert.equal(levelForXp(xp(), 9900), 99);
});

test('plans a partial-stock dependency chain post-order', () => {
  const actions = {
    gathering: [action('gathering', 'ore', 'Gather Ore', 'ore')],
    smithing: [action('smithing', 'bar', 'Smelt Bar', 'bar', { ore: 2 })],
    crafting: [action('crafting', 'tool', 'Craft Tool', 'tool', { bar: 1 })],
  };
  const plan = createPlan(data(actions), snapshot({ ore: 1 }), { itemId: 'tool', qty: 1 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((step) => step.actionId), ['ore', 'bar', 'tool']);
  assert.deepEqual(plan.steps.map((step) => step.count), [1, 1, 1]);
  assert.deepEqual(plan.satisfied, [{ itemId: 'ore', requiredQty: 2, satisfiedQty: 1 }]);
});

test('keeps fully satisfied dependencies visible without executable steps', () => {
  const actions = {
    smithing: [action('smithing', 'bar', 'Smelt Bar', 'bar', { ore: 2 })],
  };
  const plan = createPlan(data(actions), snapshot({ ore: 2 }), { itemId: 'bar', qty: 1 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((step) => step.actionId), ['bar']);
  assert.deepEqual(plan.satisfied, [{ itemId: 'ore', requiredQty: 2, satisfiedQty: 2 }]);
});

test('merges shared dependencies without overproduction', () => {
  const actions = {
    gather: [action('gather', 'herb', 'Gather Herb', 'herb')],
    make: [action('make', 'left', 'Make Left', 'left', { herb: 1 }), action('make', 'right', 'Make Right', 'right', { herb: 1 })],
    craft: [action('craft', 'goal', 'Make Goal', 'goal', { left: 1, right: 1 })],
  };
  const plan = createPlan(data(actions), snapshot(), { itemId: 'goal', qty: 1 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((step) => step.actionId), ['herb', 'left', 'right', 'goal']);
  assert.equal(plan.steps[0].count, 2);
  assert.equal(plan.steps[0].produceQty, 2);
});


test('uses projected co-products instead of redundant multi-output runs', () => {
  const actions = {
    gather: [{ skillId: 'gather', id: 'bundle', name: 'Gather Bundle', outputs: { a: 1, b: 100 }, inputs: {}, levelReq: 1, interval: 10 }],
    craft: [action('craft', 'goal', 'Make Goal', 'goal', { a: 1, b: 1 })],
  };
  const plan = createPlan(data(actions), snapshot(), { itemId: 'goal', qty: 1 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((step) => [step.actionId, step.produceItemId, step.produceQty]), [
    ['bundle', 'a', 1], ['goal', 'goal', 1],
  ]);
  assert.equal(plan.steps.some((step) => step.produceQty === 101), false);
  assert.equal(plan.steps.filter((step) => step.actionId === 'bundle').length, 1);
});

test('uses a separate valid target when later demand exceeds co-products', () => {
  const actions = {
    gather: [{ skillId: 'gather', id: 'bundle', name: 'Gather Bundle', outputs: { a: 1, b: 100 }, inputs: {}, levelReq: 1, interval: 10 }],
    craft: [action('craft', 'goal', 'Make Goal', 'goal', { a: 1, b: 101 })],
  };
  const plan = createPlan(data(actions), snapshot(), { itemId: 'goal', qty: 1 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((step) => [step.actionId, step.produceItemId, step.count, step.produceQty]), [
    ['bundle', 'a', 1, 1], ['bundle', 'b', 1, 100], ['goal', 'goal', 1, 1],
  ]);
  for (const step of plan.steps) {
    const source = actions[step.skillId].find((candidate) => candidate.id === step.actionId);
    assert.equal(step.produceQty, source.outputs[step.produceItemId] * step.count);
  }
});

test('does not treat equipped consumables as projected stock', () => {
  const actions = {
    gather: [action('gather', 'herb', 'Gather Herb', 'herb')],
    craft: [action('craft', 'potion', 'Make Potion', 'potion', { herb: 1 })],
  };
  const plan = createPlan(data(actions), { inventory: {}, equipment: { herb: 1 }, skillXp: {} }, { itemId: 'potion', qty: 1 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((step) => step.actionId), ['herb', 'potion']);
});

test('reports level and no-source blockers while planning rare drops', () => {
  const blocked = createPlan(data({ mine: [action('mine', 'gem', 'Mine Gem', 'gem', {}, { levelReq: 20 })] }), snapshot({}, { mine: 100 }), { itemId: 'gem', qty: 1 });
  assert.equal(blocked.ok, false); assert.equal(blocked.steps.at(-1).blocked.reason, 'level');
  assert.equal(blocked.steps.at(-1).blocked.minLevel, 20);
  const rare = createPlan(data({ fish: [action('fish', 'fish', 'Fish', 'fish', {}, { rareOutputs: [{ item: 'pearl', qty: 1, chance: 0.05 }] })] }), snapshot(), { itemId: 'pearl', qty: 1 });
  assert.equal(rare.ok, true);
  assert.deepEqual(
    { rare: rare.steps[0].rare, count: rare.steps[0].count, produceQty: rare.steps[0].produceQty, progressItemId: rare.steps[0].progressItemId },
    { rare: true, count: 20, produceQty: 1, progressItemId: 'fish' },
  );
  const inputRare = createPlan(data({ fish: [action('fish', 'fish', 'Fish', 'fish', { bait: 1 }, { rareOutputs: [{ item: 'pearl', qty: 1, chance: 0.05 }] })] }), snapshot(), { itemId: 'pearl', qty: 1 });
  assert.equal(inputRare.ok, false); assert.equal(inputRare.steps.at(-1).blocked.reason, 'rare-only');
  assert.equal(inputRare.steps.at(-1).blocked.chances[0].chance, 0.05);
  const none = createPlan(data({}), snapshot(), { itemId: 'unknown', qty: 1 });
  assert.equal(none.ok, false); assert.equal(none.steps.at(-1).blocked.reason, 'no-source');
});

test('reports dependency cycles explicitly', () => {
  const actions = { craft: [action('craft', 'a', 'Make A', 'a', { b: 1 }), action('craft', 'b', 'Make B', 'b', { a: 1 })] };
  const plan = createPlan(data(actions), snapshot(), { itemId: 'a', qty: 1 });
  assert.equal(plan.ok, false); assert.equal(plan.steps.at(-1).blocked.reason, 'cycle');
});

test('treats Shop tools as permanent unlocks, not inventory items', () => {
  const onlyToolSource = {
    mining: [action('mining', 'mine-ore', 'Mine Ore', 'ore', {}, { toolReq: 'bronze_pick' })],
  };
  const toolData = {
    ...data(onlyToolSource),
    strings: { 'name.bronze_pick': 'Bronze Pickaxe' },
  };
  const locked = createPlan(toolData, snapshot({ bronze_pick: 1 }), { itemId: 'ore', qty: 1 });
  assert.equal(locked.ok, false);
  assert.equal(locked.blocked.reason, 'tool');
  assert.equal(locked.blocked.toolId, 'bronze_pick');
  assert.equal(locked.blocked.actionName, 'Mine Ore');
  assert.match(locked.message, /unlocked tool Bronze Pickaxe/);

  const unlocked = createPlan(
    toolData,
    { inventory: {}, equipment: { bronze_pick: 1 }, skillXp: {} },
    { itemId: 'ore', qty: 1 },
  );
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.steps[0].actionId, 'mine-ore');
});

test('falls back to an unlocked source before reporting a tool blocker', () => {
  const actions = {
    zskill: [action('zskill', 'z-action', 'Z', 'ore')],
    askill: [action('askill', 'a-action', 'A', 'ore', {}, { toolReq: 'pickaxe' })],
  };
  const locked = createPlan(data(actions), snapshot(), { itemId: 'ore', qty: 1 });
  assert.equal(locked.ok, true);
  assert.equal(locked.steps[0].skillId, 'zskill');

  const unlocked = createPlan(
    data(actions),
    { inventory: {}, equipment: { pickaxe: 1 }, skillXp: {} },
    { itemId: 'ore', qty: 1 },
  );
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.steps[0].skillId, 'askill');
});

test('preflights runtime level, pattern, Prayer, and map gates', () => {
  const gated = {
    glyphweaving: [action('glyphweaving', 'seal', 'Ancient Seal', 'seal', {}, {
      gateLevelReq: 20,
      patternReq: 'ancient_script',
      prayerReq: 10,
      mapReq: 'ancient_heartlands',
    })],
  };
  const baseState = { inventory: {}, equipment: {}, skillXp: { glyphweaving: 2500, prayer: 2500 } };

  const levelBlocked = createPlan(data(gated), { ...baseState, skillXp: { glyphweaving: 1500, prayer: 2500 } }, { itemId: 'seal', qty: 1 });
  assert.equal(levelBlocked.reason, 'level');
  assert.equal(levelBlocked.blocked.minLevel, 20);

  const patternBlocked = createPlan(data(gated), baseState, { itemId: 'seal', qty: 1 });
  assert.equal(patternBlocked.reason, 'pattern');

  const prayerBlocked = createPlan(data(gated), { ...baseState, unlockedGlyphPatterns: ['ancient_script'], skillXp: { glyphweaving: 2500, prayer: 500 } }, { itemId: 'seal', qty: 1 });
  assert.equal(prayerBlocked.reason, 'prayer');
  assert.equal(prayerBlocked.blocked.minPrayerLevel, 10);

  const mapBlocked = createPlan(data(gated), { ...baseState, unlockedGlyphPatterns: ['ancient_script'] }, { itemId: 'seal', qty: 1 });
  assert.equal(mapBlocked.reason, 'map');

  const ready = createPlan(data(gated), { ...baseState, unlockedGlyphPatterns: ['ancient_script'], chartedMaps: ['ancient_heartlands'] }, { itemId: 'seal', qty: 1 });
  assert.equal(ready.ok, true);
});

test('requires learned recipe state instead of bypassing the cooking UI', () => {
  const cooking = {
    cooking: [action('cooking', 'meal_hunters_stew', "Hunter's Stew", 'hunters_stew', {}, { recipeScroll: 'recipe_hunters_stew' })],
  };
  const locked = createPlan(data(cooking), snapshot(), { itemId: 'hunters_stew', qty: 1 });
  assert.equal(locked.reason, 'recipe');
  assert.equal(locked.blocked.recipeScrollId, 'recipe_hunters_stew');

  const learned = createPlan(data(cooking), { ...snapshot(), unlockedRecipes: ['meal_hunters_stew'] }, { itemId: 'hunters_stew', qty: 1 });
  assert.equal(learned.ok, true);
});

test('blocks a new plan when the game bag has no free slot', () => {
  const actions = { gather: [action('gather', 'herb', 'Gather Herb', 'herb')] };
  const full = createPlan(data(actions), { inventory: { ore: 2 }, equipment: {}, skillXp: {}, bagSize: 1 }, { itemId: 'herb', qty: 1 });
  assert.equal(full.reason, 'bag-full');

  const equippedCopyDoesNotOccupySlot = createPlan(data(actions), {
    inventory: { sword: 1 },
    equipment: {},
    skillXp: {},
    bagSize: 1,
    combatWeapon: 'sword',
  }, { itemId: 'herb', qty: 1 });
  assert.equal(equippedCopyDoesNotOccupySlot.ok, true);
});
test('preflights exact actions for direct skill starts', () => {
  const exact = action('crafting', 'plank', 'Make Plank', 'plank', { log: 2 }, { toolReq: 'saw' });
  const datasets = { ...data({ crafting: [exact] }), strings: { 'name.saw': 'Workshop Saw' } };
  const levelBlocked = actionBlocker(datasets, snapshot({}, { crafting: 0 }), 'crafting', exact);
  assert.equal(levelBlocked.reason, 'tool');

  const inputBlocked = actionBlocker(datasets, { inventory: { log: 1 }, equipment: { saw: 1 }, skillXp: { crafting: 100 } }, 'crafting', exact);
  assert.deepEqual(
    { reason: inputBlocked.reason, itemId: inputBlocked.itemId, required: inputBlocked.required, available: inputBlocked.available },
    { reason: 'input', itemId: 'log', required: 2, available: 1 },
  );

  const ready = actionBlocker(datasets, { inventory: { log: 2 }, equipment: { saw: 1 }, skillXp: { crafting: 100 } }, 'crafting', exact);
  assert.equal(ready, null);
});

test('executor reports a start refusal after the verification window', () => {
  const game = fakeGame();
  game.api.startAction = () => {}; // game refuses without changing active state
  const updates = [];
  const executor = createDirectExecutor(game.api, { ...game.timers, onUpdate: (status) => updates.push(status) });
  executor.run([{ skillId: 'mine', actionId: 'ore', actionName: 'Gather Ore', count: 1, produceItemId: 'ore', produceQty: 1, levelReq: 1, interval: 10 }]);
  game.timers.tick(1500);
  assert.equal(executor.getStatus().phase, 'error');
  assert.match(updates.at(-1).message, /Unable to start/);
  assert.deepEqual(game.api.state.actionQueue, []);
});

test('executor advances one step at a time and completes', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  const steps = [
    { skillId: 'mine', actionId: 'ore', actionName: 'Ore', count: 1, produceItemId: 'ore', produceQty: 1, interval: 10 },
    { skillId: 'smith', actionId: 'bar', actionName: 'Bar', count: 1, produceItemId: 'bar', produceQty: 1, interval: 10 },
  ];
  executor.run(steps);
  assert.equal(game.api.state.activeAction, 'ore');
  assert.deepEqual(
    { produced: executor.getStatus().stepProduced, target: executor.getStatus().stepTarget, stepRemaining: executor.getStatus().stepRemainingMs, remaining: executor.getStatus().remainingMs },
    { produced: 0, target: 1, stepRemaining: 10, remaining: 20 },
  );
  game.produce('ore');
  assert.equal(game.api.state.activeAction, 'bar');
  assert.deepEqual(
    { step: executor.getStatus().currentStep, produced: executor.getStatus().stepProduced, target: executor.getStatus().stepTarget, stepRemaining: executor.getStatus().stepRemainingMs, remaining: executor.getStatus().remainingMs },
    { step: 1, produced: 0, target: 1, stepRemaining: 10, remaining: 10 },
  );
  game.produce('bar');
  assert.equal(executor.getStatus().phase, 'complete');
  assert.equal(executor.getStatus().completedSteps, 2);
  assert.equal(executor.getStatus().remainingMs, 0);
  assert.deepEqual(game.api.state.actionQueue, []);
});

test('executor keeps rare actions alive on deterministic co-output and targets the drop', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  executor.run([{
    skillId: 'fish', actionId: 'fish', actionName: 'Fish', count: 20,
    produceItemId: 'pearl', produceQty: 1, rare: true, chance: 0.05,
    progressItemId: 'fish', interval: 10,
  }]);
  game.timers.tick(25);
  game.produce('fish');
  game.timers.tick(25);
  assert.equal(executor.getStatus().phase, 'running');
  game.produce('pearl');
  assert.equal(executor.getStatus().phase, 'complete');
});

test('executor stalls a rare action with no co-output progress', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  executor.run([{
    skillId: 'fish', actionId: 'fish', actionName: 'Fish', count: 20,
    produceItemId: 'pearl', produceQty: 1, rare: true, chance: 0.05,
    progressItemId: 'fish', interval: 10,
  }]);
  game.timers.tick(30);
  assert.equal(executor.getStatus().phase, 'error');
  assert.match(executor.getStatus().message, /stalled/);
});

test('executor splices appended steps while running and updates totals', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  executor.run([{ skillId: 'mine', actionId: 'ore', actionName: 'Ore', count: 1, produceItemId: 'ore', produceQty: 1, interval: 10 }]);
  assert.equal(executor.splice(1, [{ skillId: 'smith', actionId: 'bar', actionName: 'Bar', count: 1, produceItemId: 'bar', produceQty: 1, interval: 10 }]), true);
  assert.equal(executor.getStatus().totalSteps, 2);
  game.produce('ore');
  game.produce('bar');
  assert.equal(executor.getStatus().phase, 'complete');
  assert.equal(executor.getStatus().totalSteps, 2);
});

test('executor refuses a splice at the current step', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  executor.run([{ skillId: 'mine', actionId: 'ore', actionName: 'Ore', count: 1, produceItemId: 'ore', produceQty: 1, interval: 10 }]);
  assert.equal(executor.splice(executor.getStatus().currentStep, []), false);
  assert.equal(executor.getStatus().totalSteps, 1);
});

test('executor splicing removes all pending steps after the current step', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  executor.run([
    { skillId: 'mine', actionId: 'ore', actionName: 'Ore', count: 1, produceItemId: 'ore', produceQty: 1, interval: 10 },
    { skillId: 'smith', actionId: 'bar', actionName: 'Bar', count: 1, produceItemId: 'bar', produceQty: 1, interval: 10 },
  ]);
  assert.equal(executor.splice(1, []), true);
  game.produce('ore');
  assert.equal(executor.getStatus().phase, 'complete');
  assert.equal(executor.getStatus().totalSteps, 1);
});
test('executor pauses on external action and resumes from remaining quantity', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  executor.run([{ skillId: 'mine', actionId: 'ore', actionName: 'Ore', count: 2, produceItemId: 'ore', produceQty: 2, interval: 10 }]);
  game.produce('ore');
  game.api.state.activeSkill = 'combat'; game.api.state.activeAction = 'attack'; game.emit();
  assert.equal(executor.getStatus().phase, 'paused');
  executor.resume();
  assert.equal(game.api.state.activeAction, 'ore');
  game.produce('ore');
  assert.equal(executor.getStatus().phase, 'complete');
});

test('executor aborts a stalled action, and stop clears execution', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, { ...game.timers });
  executor.run([{ skillId: 'mine', actionId: 'ore', actionName: 'Ore', count: 1, produceItemId: 'ore', produceQty: 1, interval: 10 }]);
  game.timers.tick(30);
  assert.equal(executor.getStatus().phase, 'error');
  assert.match(executor.getStatus().message, /stalled/);
  executor.stop();
  assert.equal(executor.getStatus().phase, 'idle');
  assert.deepEqual(game.api.state.actionQueue, []);
});
