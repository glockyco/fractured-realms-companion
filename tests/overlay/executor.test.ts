import assert from 'node:assert/strict';
import test from 'node:test';
import { createDirectExecutor } from '../../overlay/executor.js';

function fakeGame() {
  let clock = 0;
  let nextTimer = 1;
  const timers = new Map();
  const listeners = new Set();
  const starts = [];
  const stops = [];
  const state = {
    inventory: {}, equipment: {}, skillXp: {},
    activeSkill: null, activeAction: null, actionQueue: [],
  };
  const snapshot = () => ({
    ...state,
    inventory: { ...state.inventory },
    equipment: { ...state.equipment },
    skillXp: { ...state.skillXp },
  });
  const emit = () => {
    for (const listener of [...listeners]) listener(snapshot());
  };
  const api = {
    state,
    starts,
    stops,
    startAction(skillId, actionId) {
      starts.push([skillId, actionId]);
      state.activeSkill = skillId;
      state.activeAction = actionId;
      emit();
    },
    stopAction() {
      stops.push(true);
      state.activeSkill = null;
      state.activeAction = null;
      emit();
    },
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const timersApi = {
    now: () => clock,
    setTimeout(fn, delay) {
      const id = nextTimer++;
      timers.set(id, { fn, at: clock + Math.max(0, delay) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      clock += ms;
      let again = true;
      while (again) {
        again = false;
        for (const [id, timer] of [...timers]) {
          if (timer.at <= clock) {
            timers.delete(id);
            timer.fn();
            again = true;
          }
        }
      }
    },
  };
  return {
    api,
    timers: timersApi,
    emit,
    set(values) {
      Object.assign(state, values);
      emit();
    },
    produce(itemId, amount = 1) {
      state.inventory[itemId] = (state.inventory[itemId] ?? 0) + amount;
      emit();
    },
  };
}

function action(id, stop, extra = {}) {
  return {
    id,
    kind: 'action',
    label: id,
    skillId: 'gathering',
    actionId: id,
    deps: [],
    stop,
    expected: { runs: 1, ms: 10, produces: { ore: 1 }, consumes: {} },
    ...extra,
  };
}

function options(game, blocker = () => null, fact = (_state, name) => Boolean(_state[name])) {
  return { ...game.timers, liveBlocker: blocker, factSatisfied: fact };
}

test('requires injectable liveBlocker and factSatisfied predicates', () => {
  const game = fakeGame();
  assert.throws(() => createDirectExecutor(game.api, game.timers), /liveBlocker and factSatisfied/);
});

test('manual step does not block an independent later action', async () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, options(game));
  const manual = {
    id: 'buy-tool', kind: 'manual', label: 'Buy tool', instruction: 'Buy the tool',
    deps: [], stop: { type: 'fact', fact: 'toolReady' },
    expected: { runs: 0, ms: null, produces: {}, consumes: {} }, purpose: 'unlock',
  };
  const runPromise = executor.run([manual, action('gather', { type: 'itemQty', itemId: 'ore', qty: 1 })]);
  assert.equal(executor.getStatus().phase, 'running');
  assert.equal(executor.getStatus().runningStepId, 'gather');
  assert.deepEqual(game.api.starts, [['gathering', 'gather']]);

  game.produce('ore');
  assert.equal(executor.getStatus().phase, 'waiting');
  game.set({ toolReady: true });
  await runPromise;
  assert.equal(executor.getStatus().phase, 'complete');
  assert.deepEqual(executor.getStatus().stepStatuses, { 'buy-tool': 'done', gather: 'done' });
});

test('preempts a lower-priority running action when a higher-priority step unblocks', () => {
  const game = fakeGame();
  const blocker = (state, step) => step.id === 'priority' && !state.tool ? 'missing tool' : null;
  const executor = createDirectExecutor(game.api, options(game, blocker));
  executor.run([
    action('priority', { type: 'itemQty', itemId: 'priorityOre', qty: 1 }, {
      actionId: 'priority', expected: { runs: 1, ms: 100, produces: { priorityOre: 1 }, consumes: {} },
    }),
    action('background', { type: 'itemQty', itemId: 'ore', qty: 1 }, {
      actionId: 'background', expected: { runs: 1, ms: 100, produces: { ore: 1 }, consumes: {} },
    }),
  ]);
  assert.equal(executor.getStatus().runningStepId, 'background');
  assert.deepEqual(game.api.starts, [['gathering', 'background']]);

  game.set({ tool: true });
  assert.equal(executor.getStatus().runningStepId, 'priority');
  assert.deepEqual(game.api.starts, [['gathering', 'background'], ['gathering', 'priority']]);
  assert.equal(game.api.stops.length, 2);
});

test('enters waiting only when no action is runnable and auto-resumes on update', () => {
  const game = fakeGame();
  const blocker = (state) => state.ready ? null : 'not ready';
  const executor = createDirectExecutor(game.api, options(game, blocker));
  const manual = {
    id: 'manual', kind: 'manual', label: 'Manual task', deps: [],
    stop: { type: 'fact', fact: 'manualDone' },
    expected: { runs: 0, ms: null, produces: {}, consumes: {} }, purpose: 'unlock',
  };
  const blocked = action('blocked', { type: 'itemQty', itemId: 'ore', qty: 1 }, { actionId: 'blocked' });
  executor.run([manual, blocked]);
  assert.equal(executor.getStatus().phase, 'waiting');
  assert.match(executor.getStatus().message, /Manual task/);
  assert.deepEqual(game.api.starts, []);

  game.set({ ready: true });
  assert.equal(executor.getStatus().phase, 'running');
  assert.equal(executor.getStatus().runningStepId, 'blocked');
  game.produce('ore');
  assert.equal(executor.getStatus().phase, 'waiting');
  game.set({ manualDone: true });
  assert.equal(executor.getStatus().phase, 'complete');
});

test('itemQty stops at the exact threshold and hand-satisfied later steps never run', async () => {
  const game = fakeGame();
  game.api.state.inventory.handSupplied = 1;
  game.api.state.handFact = true;
  const executor = createDirectExecutor(game.api, options(game));
  const handItem = action('hand-item', { type: 'itemQty', itemId: 'handSupplied', qty: 1 }, {
    actionId: 'hand-item', expected: { runs: 1, ms: 50, produces: { handSupplied: 1 }, consumes: {} },
  });
  const handFact = {
    id: 'hand-fact', kind: 'manual', label: 'Hand fact', deps: [],
    stop: { type: 'fact', fact: 'handFact' },
    expected: { runs: 0, ms: null, produces: {}, consumes: {} }, purpose: 'unlock',
  };
  const runPromise = executor.run([
    action('gather', { type: 'itemQty', itemId: 'ore', qty: 2 }, {
      actionId: 'gather', expected: { runs: 2, ms: 20, produces: { ore: 2 }, consumes: {} },
    }),
    handItem,
    handFact,
  ]);
  assert.equal(executor.getStatus().stepStatuses['hand-item'], 'done');
  assert.equal(executor.getStatus().stepStatuses['hand-fact'], 'done');
  assert.deepEqual(game.api.starts, [['gathering', 'gather']]);
  game.produce('ore');
  assert.equal(executor.getStatus().phase, 'running');
  game.produce('ore');
  await runPromise;
  assert.equal(executor.getStatus().phase, 'complete');
  assert.equal(executor.getStatus().stepStatuses.gather, 'done');
  assert.deepEqual(game.api.starts, [['gathering', 'gather']]);
});

test('reports a start refusal after the verification window', () => {
  const game = fakeGame();
  game.api.startAction = () => {};
  const executor = createDirectExecutor(game.api, options(game));
  executor.run([action('refused', { type: 'itemQty', itemId: 'ore', qty: 1 }, {
    actionId: 'refused', expected: { runs: 1, ms: 10, produces: { ore: 1 }, consumes: {} },
  })]);
  game.timers.tick(1499);
  assert.equal(executor.getStatus().phase, 'running');
  game.timers.tick(1);
  assert.equal(executor.getStatus().phase, 'error');
  assert.match(executor.getStatus().message, /Unable to start refused/);
  assert.deepEqual(game.api.state.actionQueue, []);
});

test('mismatch grace returns an externally changed action to the ready set without a paused phase', () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, options(game));
  executor.run([action('recover', { type: 'itemQty', itemId: 'ore', qty: 1 }, {
    actionId: 'recover', expected: { runs: 1, ms: 1000, produces: { ore: 1 }, consumes: {} },
  })]);
  game.set({ activeSkill: 'combat', activeAction: 'attack' });
  game.timers.tick(1199);
  assert.equal(executor.getStatus().phase, 'running');
  game.timers.tick(1);
  assert.equal(executor.getStatus().phase, 'running');
  assert.equal(executor.getStatus().runningStepId, 'recover');
  assert.deepEqual(game.api.starts, [['gathering', 'recover'], ['gathering', 'recover']]);
});

test('time stop uses accumulated running time and beats a same-tick stall deadline', async () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, options(game));
  const runPromise = executor.run([action('timed', { type: 'time', ms: 50 }, {
    actionId: 'timed', expected: { runs: 1, ms: 50, produces: {}, consumes: {} },
  })]);
  game.timers.tick(49);
  assert.equal(executor.getStatus().phase, 'running');
  game.timers.tick(1);
  await runPromise;
  assert.equal(executor.getStatus().phase, 'complete');
});

test('runs stops count deterministic output without waiting for rare EV output', async () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, options(game));
  const runPromise = executor.run([action('runs', { type: 'runs', runs: 2 }, {
    actionId: 'runs', expected: { runs: 2, ms: 20, produces: { ore: 2, jewel: 0.2 }, consumes: {} },
  })]);
  game.produce('ore', 2);
  await runPromise;
  assert.equal(executor.getStatus().phase, 'complete');
});

test('stalls the running action and runToken prevents stale work after stop and re-run', async () => {
  const game = fakeGame();
  const executor = createDirectExecutor(game.api, options(game));
  const first = executor.run([action('first', { type: 'itemQty', itemId: 'ore', qty: 1 }, {
    actionId: 'first', expected: { runs: 1, ms: 10, produces: { ore: 1 }, consumes: {} },
  })]);
  game.timers.tick(30);
  assert.equal(executor.getStatus().phase, 'error');
  assert.match(executor.getStatus().message, /stalled/);
  executor.stop();
  assert.equal(executor.getStatus().phase, 'idle');
  await first;

  const second = executor.run([action('second', { type: 'itemQty', itemId: 'bar', qty: 1 }, {
    actionId: 'second', expected: { runs: 1, ms: 100, produces: { bar: 1 }, consumes: {} },
  })]);
  game.timers.tick(30);
  assert.equal(executor.getStatus().phase, 'running');
  game.produce('bar');
  await second;
  assert.equal(executor.getStatus().phase, 'complete');
  assert.deepEqual(game.api.starts, [['gathering', 'first'], ['gathering', 'second']]);
});
