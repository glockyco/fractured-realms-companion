// @ts-nocheck
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DATA_FILES,
  bootOverlay,
  buildIndexes,
  clampFloatingPosition,
  createOverlayShell,
  estimatePlanDuration,
  fitWithinViewport,
  formatDuration,
  formatFinishTime,
  isExecutionLocked,
  projectPlanState,
  projectSteps,
  resolvePlanQueue,
  searchPlanTargets,
} from '../../overlay/overlay.js';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.className = '';
    this._innerHTML = '';
    this.textContent = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.synthetic = new Map();
    for (const match of this._innerHTML.matchAll(/<([a-z][\w-]*)[^>]*\sid="([^"]+)"[^>]*>/gi)) {
      const child = new FakeElement(match[1], this.ownerDocument);
      child.setAttribute('id', match[2]);
      if (/\sdisabled(?:\s|>|=)/i.test(match[0])) child.disabled = true;
      if (/\shidden(?:\s|>|=)/i.test(match[0])) child.hidden = true;
      const valueMatch = match[0].match(/\svalue="([^"]*)"/i);
      if (valueMatch) child.value = valueMatch[1];
      this.synthetic.set(`#${match[2]}`, child);
    }
  }

  get innerHTML() { return this._innerHTML; }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === 'id') {
      this.id = normalized;
      this.ownerDocument.byId.set(normalized, this);
    }
    if (name === 'class') this.className = normalized;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = normalized;
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  attachShadow() { this.shadowRoot = new FakeElement('shadow-root', this.ownerDocument); return this.shadowRoot; }
  addEventListener(type, listener) { (this.listeners.get(type) || this.listeners.set(type, []).get(type)).push(listener); }
  querySelector(selector) {
    const synthetic = this.synthetic?.get(selector);
    if (synthetic) return synthetic;
    if (!String(selector).startsWith('#')) return null;
    const id = String(selector).slice(1);
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.id === id) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this);
  }
  matches() { return false; }
  contains(element) { return element === this || this.children.includes(element) || [...(this.synthetic?.values() || [])].includes(element); }
  getBoundingClientRect() { return { left: 10, right: 310, top: 10, bottom: 46, width: 300, height: 36 }; }
  scrollIntoView() {}
  focus() { this.ownerDocument.activeElement = this; }

  dispatch(type, init = {}) {
    const event = {
      target: this,
      currentTarget: this,
      preventDefault() { this.defaultPrevented = true; },
      ...init,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class FakeDocument {
  constructor() {
    this.byId = new Map();
    const values = new Map();
    this.defaultView = {
      localStorage: {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
      },
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener() {},
    };
    this.body = new FakeElement('body', this);
    this.activeElement = this.body;
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  getElementById(id) { return this.byId.get(id) || null; }
}

function datasets() {
  return {
    items: {
      log: { label: 'Harbor Log', type: 'material', desc: 'A sturdy log.', value: 2, art: true },
      plank: { label: 'Harbor Plank', type: 'material', healAmount: 1, art: false },
    },
    actions: {
      woodcutting: [{
        id: 'chop_log', name: 'Chop Harbor Tree', levelReq: 1, interval: 1000,
        spot: 'harbor', outputs: { log: 1 }, rareOutputs: [{ item: 'plank', qty: 1, chance: 0.05 }],
      }],
      crafting: [{
        id: 'make_plank', name: 'Make Harbor Plank', levelReq: 1, interval: 800,
        inputs: { log: 2 }, outputs: { plank: 1 },
      }],
    },
    skills: [{ id: 'woodcutting', name: 'Woodcutting' }, { id: 'crafting', name: 'Crafting' }],
    xp: Array.from({ length: 100 }, (_, level) => level * 10),
    buildings: [{ id: 'dock', name: 'Dock', upgrades: [{ level: 2, label: 'Reinforce Dock', cost: { log: 4 } }] }],
    digsites: [],
    strings: { 'name.harbor': 'North Harbor' },
  };
}

function api() {
  return {
    getState: () => ({ inventory: {}, equipment: {}, skillXp: { woodcutting: 100, crafting: 100 } }),
    startAction() {},
    stopAction() {},
    subscribe() { return () => {}; },
  };
}

function fetchFor(data) {
  const byFile = Object.fromEntries(DATA_FILES.map(([key, file]) => [file, data[key]]));
  return async (url) => {
    const file = String(url).split('/').pop();
    return { ok: true, status: 200, json: async () => byFile[file] };
  };
}

function oklchLuminance(value) {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  assert.ok(match, `expected an opaque OKLCH color, got ${value}`);
  const [, lightness, chroma, hue] = match.map(Number);
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (channel) => Math.min(1, Math.max(0, channel));
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(oklchLuminance(foreground), oklchLuminance(background));
  const darker = Math.min(oklchLuminance(foreground), oklchLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('boot success creates one launcher and panel in a Shadow DOM host', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });

  assert.ok(result.app);
  assert.equal(document.getElementById('fractured-realms-companion'), result.shell.host);
  assert.equal(result.shell.host.shadowRoot, result.shell.shadow);
  assert.equal(result.shell.launcher.getAttribute('aria-controls'), 'fr-panel');
  assert.equal(result.shell.panel.id, 'fr-panel');
  assert.equal(result.shell.tabButtons.length, 3);
  assert.equal(result.shell.loading.hidden, true);

  const duplicate = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  assert.equal(duplicate.existing, result.shell.host);
});

test('data indexes include deterministic and rare sources plus action and building uses', () => {
  const indexes = buildIndexes(datasets());

  assert.deepEqual(indexes.sourcesOf.log.map((source) => [source.actionId, source.rare]), [['chop_log', false]]);
  assert.deepEqual(indexes.sourcesOf.plank.map((source) => [source.actionId, source.rare]), [['make_plank', false], ['chop_log', true]]);
  assert.deepEqual(indexes.usesOf.log.map((use) => [use.kind, use.actionId || use.buildingId]), [
    ['action', 'make_plank'],
    ['building', 'dock'],
  ]);
});

test('planner target search ranks relevant and contextual items', () => {
  const entries = [
    ['log', { label: 'Harbor Log' }],
    ['plank', { label: 'Harbor Plank' }],
    ['ancient_spore', { label: 'Ancient Spore' }],
  ];
  assert.deepEqual(searchPlanTargets(entries, 'har', ['plank']).map((entry) => entry.id), ['plank', 'log']);
  assert.deepEqual(searchPlanTargets(entries, 'spore').map((entry) => entry.id), ['ancient_spore']);
  assert.deepEqual(searchPlanTargets(entries, '', ['ancient_spore'], 2).map((entry) => entry.id), ['ancient_spore', 'log']);
  assert.deepEqual(searchPlanTargets(entries, 'missing'), []);
});

test('planner target combobox supports keyboard selection and submission', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  const panel = result.shell.panels.plan;
  const input = panel.querySelector('#fr-plan-item');
  const form = panel.querySelector('#fr-plan-form');

  input.dispatch('focus');
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  input.value = 'plank';
  input.dispatch('input');
  assert.equal(result.app.state.planItemId, '');

  const down = input.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(down.defaultPrevented, true);
  assert.equal(input.getAttribute('aria-activedescendant'), 'fr-plan-option-0');
  input.dispatch('keydown', { key: 'Enter' });
  assert.equal(result.app.state.planItemId, 'plank');
  assert.equal(input.value, 'Harbor Plank');
  assert.equal(input.getAttribute('aria-expanded'), 'false');

  form.dispatch('submit');
  assert.equal(result.app.state.currentPlan.ok, true);
  assert.deepEqual(result.app.state.currentPlan.steps.map((step) => step.actionId), ['chop_log', 'make_plank']);
  assert.deepEqual(result.app.state.recentPlanItemIds, ['plank']);
});
test('restores and persists queued goals and formats finish times', async () => {
  const document = new FakeDocument();
  document.defaultView.localStorage.setItem('fractured-realms-companion.queue.v1', JSON.stringify({
    goals: [
      { id: 'plan-4', itemId: 'log', qty: 2 },
      { id: 'plan-5', itemId: 'plank', qty: 1 },
    ],
    nextPlanId: 5,
  }));
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  assert.equal(result.app.state.planQueue.length, 2);
  assert.equal(result.app.state.executorStatus.message, 'Restored 2 queued plan(s).');

  const panel = result.shell.panels.plan;
  result.app.state.planItemId = 'log';
  panel.querySelector('#fr-plan-qty').value = '1';
  panel.querySelector('#fr-plan-form').dispatch('submit');
  const stored = JSON.parse(document.defaultView.localStorage.getItem('fractured-realms-companion.queue.v1'));
  assert.equal(stored.goals.at(-1).itemId, 'log');
  assert.match(formatFinishTime(60_000, 0), /\d{1,2}:\d{2}/u);
});

test('compact mode toggles and persists its panel preference', () => {
  const document = new FakeDocument();
  const shell = createOverlayShell(document);
  const toggle = shell.compactToggle || shell.panel.querySelector('#fr-compact-toggle');
  assert.equal(shell.panel.dataset.compact, 'false');
  // Simulate a manual resize: inline width/height would otherwise override the compact rule.
  shell.panel.style.width = '900px';
  shell.panel.style.height = '600px';
  toggle.dispatch('click');
  assert.equal(shell.panel.dataset.compact, 'true');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(shell.panel.style.width, '');
  assert.equal(shell.panel.style.height, '');
  assert.equal(JSON.parse(document.defaultView.localStorage.getItem('fractured-realms-companion.positions.v1')).compactMode, true);
  toggle.dispatch('click');
  assert.equal(shell.panel.dataset.compact, 'false');
  assert.equal(shell.panel.style.width, '900px');
  assert.equal(shell.panel.style.height, '600px');
});

test('compact strip exposes a resume control hidden unless paused', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  const resume = result.shell.compactStrip.querySelector('#fr-compact-resume');
  assert.ok(resume);
  assert.equal(resume.hidden, true);
  result.app.state.executorStatus = { phase: 'paused', currentStep: 0, message: 'paused' };
  result.app.renderPlan();
  assert.equal(resume.hidden, false);
});

test('compact strip swaps between start and stop by run state', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  const start = result.shell.compactStrip.querySelector('#fr-compact-start');
  const stop = result.shell.compactStrip.querySelector('#fr-compact-stop');
  assert.ok(start);
  result.app.state.executorStatus = { phase: 'idle', currentStep: null };
  result.app.renderPlan();
  assert.equal(start.hidden, false);
  assert.equal(stop.hidden, true);
  result.app.state.executorStatus = { phase: 'running', currentStep: 0 };
  result.app.renderPlan();
  assert.equal(start.hidden, true);
  assert.equal(stop.hidden, false);
});


test('queued plans project earlier deterministic outputs and estimate duration', () => {
  const goals = [
    { id: 'plan-1', itemId: 'log', qty: 2 },
    { id: 'plan-2', itemId: 'plank', qty: 1 },
  ];
  const queue = resolvePlanQueue(datasets(), api().getState(), goals);

  assert.equal(queue.length, 2);
  assert.deepEqual(queue[0].plan.steps.map((step) => [step.actionId, step.count]), [['chop_log', 2]]);
  assert.deepEqual(queue[1].plan.steps.map((step) => [step.actionId, step.count]), [['make_plank', 1]]);
  assert.equal(queue[0].estimateMs, 2000);
  assert.equal(estimatePlanDuration(queue[1].plan), 800);
  assert.equal(formatDuration(62_000), '1m 2s');

  const projected = projectPlanState(datasets(), api().getState(), queue.map((entry) => entry.plan));
  assert.deepEqual(projected.inventory, { log: 0, plank: 1 });
});

test('projects deterministic and rare raw execution steps', () => {
  const projected = projectSteps(datasets(), api().getState(), [
    { skillId: 'woodcutting', actionId: 'chop_log', count: 2 },
    { skillId: 'woodcutting', actionId: 'chop_log', count: 20, rare: true, produceItemId: 'plank', produceQty: 1 },
  ]);
  assert.equal(projected.inventory.log, 22);
  assert.equal(projected.inventory.plank, 1);
});
test('renders rare plan rows with expected quantity and chance badge', async () => {
  const rareData = datasets();
  rareData.items = { ...rareData.items, pearl: { label: 'River Pearl', type: 'material' } };
  rareData.actions = {
    fishing: [{
      id: 'fish_pearl', name: 'Fish River', levelReq: 1, interval: 1000,
      outputs: { fish: 1 }, rareOutputs: [{ item: 'pearl', qty: 1, chance: 0.05 }],
    }],
  };
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(rareData) });
  const panel = result.shell.panels.plan;
  const form = panel.querySelector('#fr-plan-form');
  const quantity = panel.querySelector('#fr-plan-qty');
  result.app.state.planItemId = 'pearl';
  quantity.value = '1';
  form.dispatch('submit');
  const html = panel.querySelector('#fr-plan-result').innerHTML;
  assert.match(html, /~×20/);
  assert.match(html, /badge warning[^>]*>5%/);
  assert.match(html, /\(avg\)/);
});


test('rendered tool blockers name the blocking action', async () => {
  const blockedData = datasets();
  blockedData.actions = {
    ...blockedData.actions,
    crafting: [{ ...blockedData.actions.crafting[0], toolReq: 'workshop_saw' }],
  };
  blockedData.strings = { ...blockedData.strings, 'name.workshop_saw': 'Workshop Saw' };
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(blockedData) });
  const panel = result.shell.panels.plan;
  const form = panel.querySelector('#fr-plan-form');
  const quantity = panel.querySelector('#fr-plan-qty');
  result.app.state.planItemId = 'plank';
  quantity.value = '1';
  form.dispatch('submit');
  const notice = panel.querySelector('#fr-plan-result').innerHTML;
  assert.doesNotMatch(notice, /undefined/);
  assert.match(notice, /Make Harbor Plank/);
});

test('queued planner appends multiple goals against prior output', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  const panel = result.shell.panels.plan;
  const form = panel.querySelector('#fr-plan-form');
  const qty = panel.querySelector('#fr-plan-qty');

  result.app.state.planItemId = 'log';
  qty.value = '2';
  form.dispatch('submit');
  result.app.state.planItemId = 'plank';
  qty.value = '1';
  form.dispatch('submit');

  assert.equal(result.app.state.planQueue.length, 2);
  assert.deepEqual(result.app.state.planQueue.map((entry) => entry.itemId), ['log', 'plank']);
  assert.deepEqual(result.app.state.executionSteps.map((step) => step.actionId), ['chop_log', 'make_plank']);
  assert.match(panel.querySelector('#fr-plan-result').innerHTML, /Prerequisite satisfied/);
  assert.match(panel.querySelector('#fr-plan-result').innerHTML, /Harbor Log/);
  assert.ok(result.shell.queueControls.querySelector('#fr-run'));
  assert.equal(result.shell.queueControls.querySelector('#fr-run').disabled, false);

  const planResult = panel.querySelector('#fr-plan-result');
  planResult.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { queueAction: 'up', planId: 'plan-2' } }) } });
  assert.deepEqual(result.app.state.planQueue.map((entry) => entry.itemId), ['plank', 'log']);
  planResult.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { queueAction: 'remove', planId: 'plan-2' } }) } });
  assert.deepEqual(result.app.state.planQueue.map((entry) => entry.itemId), ['log']);
});

test('edits pending queue goals while execution is running', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  const { app, shell } = result;
  const panel = shell.panels.plan;
  const form = panel.querySelector('#fr-plan-form');
  const qty = panel.querySelector('#fr-plan-qty');
  const run = shell.queueControls.querySelector('#fr-run');

  app.state.planItemId = 'log';
  qty.value = '2';
  form.dispatch('submit');
  app.state.planItemId = 'plank';
  qty.value = '1';
  form.dispatch('submit');
  run.dispatch('click');
  app.state.executorStatus = { phase: 'running', currentStep: 0, stepTarget: 2, stepProduced: 1 };
  const firstPlan = app.state.planQueue[0];
  app.renderPlan();

  const item = panel.querySelector('#fr-plan-item');
  assert.equal(item.disabled, false);
  app.state.planItemId = 'log';
  qty.value = '1';
  form.dispatch('submit');

  assert.equal(app.state.planQueue.length, 3);
  assert.equal(app.state.planQueue[0].id, firstPlan.id);
  assert.equal(app.state.planQueue[0].qty, firstPlan.qty);
  const html = panel.querySelector('#fr-plan-result').innerHTML;
  assert.match(html, /data-queue-action="remove" data-plan-id="plan-1"[^>]* disabled/);
  assert.doesNotMatch(html, /data-queue-action="remove" data-plan-id="plan-2"[^>]* disabled/);
  const planResult = panel.querySelector('#fr-plan-result');
  planResult.dispatch('click', { target: { closest: () => ({ disabled: true, dataset: { queueAction: 'remove', planId: 'plan-1' } }) } });
  assert.equal(app.state.planQueue.length, 3);
  planResult.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { queueAction: 'remove', planId: 'plan-2' } }) } });
  assert.equal(app.state.planQueue.length, 2);
  app.executor.stop();
});

test('promotes a pending plan over the running one', async () => {
  const document = new FakeDocument();
  const calls = [];
  const liveApi = {
    getState: () => ({ inventory: {}, equipment: {}, skillXp: { woodcutting: 100, crafting: 100 } }),
    startAction(skillId, actionId) { calls.push(['start', skillId, actionId]); },
    stopAction() { calls.push(['stop']); },
    subscribe() { return () => {}; },
  };
  const result = await bootOverlay({ document, window: { __frCompanion: liveApi }, fetch: fetchFor(datasets()) });
  const { app, shell } = result;
  const panel = shell.panels.plan;
  const form = panel.querySelector('#fr-plan-form');
  const qty = panel.querySelector('#fr-plan-qty');
  const run = shell.queueControls.querySelector('#fr-run');
  const planResult = panel.querySelector('#fr-plan-result');

  app.state.planItemId = 'plank';
  qty.value = '1';
  form.dispatch('submit');
  app.state.planItemId = 'log';
  qty.value = '1';
  form.dispatch('submit');
  assert.deepEqual(app.state.planQueue.map((entry) => entry.itemId), ['plank', 'log']);

  run.dispatch('click');
  calls.length = 0;

  planResult.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { queueAction: 'up', planId: 'plan-2' } }) } });

  assert.equal(app.state.planQueue[0].itemId, 'log');
  assert.equal(app.state.queueGoals[0].id, 'plan-2');
  assert.equal(app.state.queueGoals[1].id, 'plan-1');
  assert.ok(calls.some(([kind]) => kind === 'stop'));
  assert.ok(calls.some(([kind, , actionId]) => kind === 'start' && actionId === 'chop_log'));
  assert.match(planResult.innerHTML, /Run now/);
  app.executor.stop();
});

test('preemption reverts when the executor is no longer running', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: api() }, fetch: fetchFor(datasets()) });
  const { app, shell } = result;
  const panel = shell.panels.plan;
  const form = panel.querySelector('#fr-plan-form');
  const qty = panel.querySelector('#fr-plan-qty');
  const planResult = panel.querySelector('#fr-plan-result');

  app.state.planItemId = 'plank';
  qty.value = '1';
  form.dispatch('submit');
  app.state.planItemId = 'log';
  qty.value = '1';
  form.dispatch('submit');

  // The app believes a plan is running, but the real executor was never started.
  app.state.executorStatus = { phase: 'running', currentStep: 0, stepTarget: 2, stepProduced: 0 };
  app.renderPlan();
  const originalGoals = app.state.queueGoals.map((goal) => goal.id);

  planResult.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { queueAction: 'up', planId: 'plan-2' } }) } });

  assert.deepEqual(app.state.queueGoals.map((goal) => goal.id), originalGoals);
  assert.match(planResult.innerHTML, /advanced while editing/);
});

async function runningQueueWithCompletedPlan() {
  const document = new FakeDocument();
  const calls = [];
  const liveApi = {
    getState: () => ({ inventory: {}, equipment: {}, skillXp: { woodcutting: 100, crafting: 100 } }),
    startAction(skillId, actionId) { calls.push(['start', skillId, actionId]); },
    stopAction() { calls.push(['stop']); },
    subscribe() { return () => {}; },
  };
  const result = await bootOverlay({ document, window: { __frCompanion: liveApi }, fetch: fetchFor(datasets()) });
  const { app, shell } = result;
  const form = shell.panels.plan.querySelector('#fr-plan-form');
  const qty = shell.panels.plan.querySelector('#fr-plan-qty');
  const run = shell.queueControls.querySelector('#fr-run');
  const planResult = shell.panels.plan.querySelector('#fr-plan-result');
  app.state.planItemId = 'log';
  qty.value = '3';
  form.dispatch('submit');
  app.state.planItemId = 'plank';
  qty.value = '1';
  form.dispatch('submit');
  run.dispatch('click');
  // Report the executor as deep into plan 2 so plan 1 counts as completed.
  const lastStep = app.state.executionSteps.length - 1;
  app.state.executorStatus = { phase: 'running', currentStep: lastStep, stepTarget: 1, stepProduced: 0 };
  app.renderPlan();
  calls.length = 0;
  return { app, planResult, calls };
}

test('deletes a completed plan mid-run and re-resolves from live inventory', async () => {
  const { app, planResult, calls } = await runningQueueWithCompletedPlan();
  assert.equal(app.state.planQueue.length, 2);

  planResult.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { queueAction: 'remove', planId: 'plan-1' } }) } });

  assert.equal(app.state.queueGoals.length, 1);
  assert.equal(app.state.queueGoals[0].id, 'plan-2');
  assert.equal(app.state.planQueue.length, 1);
  assert.ok(calls.some(([kind]) => kind === 'stop'));
  assert.ok(calls.some(([kind]) => kind === 'start'));
  app.executor.stop();
});

test('moves a completed plan back into the pending section', async () => {
  const { app, planResult, calls } = await runningQueueWithCompletedPlan();

  planResult.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { queueAction: 'down', planId: 'plan-1' } }) } });

  assert.deepEqual(app.state.queueGoals.map((goal) => goal.id), ['plan-2', 'plan-1']);
  assert.ok(calls.some(([kind]) => kind === 'stop'));
  app.executor.stop();
});

test('floating controls clamp to the viewport and suppress click after dragging', () => {
  // Partial off-screen is allowed: a negative left is kept (window tucked past the left edge)
  // while the top edge stays reachable and a minimum sliver remains on screen.
  assert.deepEqual(
    clampFloatingPosition({ left: -20, top: 900 }, { width: 100, height: 80 }, { width: 500, height: 400 }),
    { left: -20, top: 344 },
  );
  // A window cannot be pushed so far it disappears: at least ~56px stays visible on each axis.
  assert.deepEqual(
    clampFloatingPosition({ left: -9999, top: 9999 }, { width: 100, height: 80 }, { width: 500, height: 400 }),
    { left: 56 - 100, top: 400 - 56 },
  );
  const fitted = fitWithinViewport(
    { left: 500, top: 700 },
    { width: 768, height: 672 },
    { width: 900, height: 800 },
  );
  assert.equal(fitted.left, 500);
  assert.equal(fitted.top, 700);
  assert.equal(fitted.maxHeight, 800 - 2 * 8);
  assert.equal(fitted.maxWidth, 900 - 2 * 8);

  const document = new FakeDocument();
  const shell = createOverlayShell(document);
  shell.launcher.dispatch('pointerdown', { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
  shell.launcher.dispatch('pointermove', { pointerId: 1, clientX: 110, clientY: 90 });
  shell.launcher.dispatch('pointerup', { pointerId: 1, clientX: 110, clientY: 90 });
  shell.launcher.dispatch('click');

  assert.equal(shell.launcher.style.left, '110px');
  assert.equal(shell.launcher.style.top, '90px');
  assert.equal(shell.panel.hidden, true);
  shell.launcher.dispatch('click');
  assert.equal(shell.panel.hidden, false);
});

test('tab keyboard navigation updates selection and focus', () => {
  const document = new FakeDocument();
  const shell = createOverlayShell(document);

  const event = shell.tabButtons[0].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(shell.tabButtons[0].getAttribute('aria-selected'), 'false');
  assert.equal(shell.tabButtons[1].getAttribute('aria-selected'), 'true');
  assert.equal(shell.panels.items.hidden, true);
  assert.equal(shell.panels.skills.hidden, false);
  assert.equal(document.activeElement, shell.tabButtons[1]);

  shell.tabButtons[1].dispatch('keydown', { key: 'End' });
  assert.equal(shell.tabButtons[2].getAttribute('aria-selected'), 'true');
});

test('skills table starts an available action through game controls', async () => {
  const document = new FakeDocument();
  const calls = [];
  const gameApi = {
    ...api(),
    stopAction() { calls.push(['stop']); },
    startAction(skillId, actionId) { calls.push(['start', skillId, actionId]); },
  };
  const result = await bootOverlay({ document, window: { __frCompanion: gameApi }, fetch: fetchFor(datasets()) });
  const skills = result.shell.panels.skills;
  const table = skills.querySelector('#fr-skill-table');
  const control = { disabled: false, dataset: { skillId: 'woodcutting', actionId: 'chop_log' } };
  table.dispatch('click', { target: { closest: () => control } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [['stop'], ['start', 'woodcutting', 'chop_log']]);
  assert.match(skills.querySelector('#fr-skill-action-status').textContent, /started/i);
});

test('API timeout is visible in the launcher and nonmodal panel', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({
    document,
    window: {},
    fetch: fetchFor(datasets()),
    poll: { pollMs: 1, timeoutMs: 1, delay: async () => {} },
  });

  assert.equal(result.app, null);
  assert.equal(result.shell.panel.hidden, false);
  assert.equal(result.shell.error.hidden, false);
  assert.equal(result.shell.error.getAttribute('role'), 'alert');
  assert.equal(result.shell.launcher.dataset.state, 'error');
  assert.match(result.shell.launcher.innerHTML, /Companion unavailable/);
  assert.match(result.shell.error.innerHTML, /connection timed out/i);
});

test('primary action token stays consistent and clears WCAG AA contrast', () => {
  const overlaySource = readFileSync(fileURLToPath(new URL('../../overlay/overlay.js', import.meta.url)), 'utf8');
  const designSource = readFileSync(fileURLToPath(new URL('../../DESIGN.md', import.meta.url)), 'utf8');
  const sidecar = JSON.parse(readFileSync(fileURLToPath(new URL('../../.impeccable/design.json', import.meta.url)), 'utf8'));
  const foreground = 'oklch(0.94 0 0)';
  const background = 'oklch(0.50 0.13 230)';

  assert.match(overlaySource, /--fr-harbor-600:\s*oklch\(0\.50 0\.13 230\)/);
  assert.match(designSource, /`--fr-harbor-600` \| `oklch\(0\.50 0\.13 230\)`/);
  assert.equal(sidecar.tokens.color.harbor['600'], background);
  assert.equal(sidecar.tokens.color.neutral['100'], foreground);
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= 4.5, `expected at least 4.5:1, got ${ratio.toFixed(2)}:1`);
  assert.equal(sidecar.tokens.contrast.primaryAction.ratio, Number(ratio.toFixed(2)));
});

test('active execution phases preserve the plan, executor status, and Run state', async () => {
  const document = new FakeDocument();
  let starts = 0;
  const result = await bootOverlay({
    document,
    window: { __frCompanion: { ...api(), startAction() { starts += 1; } } },
    fetch: fetchFor(datasets()),
  });
  const { app, shell } = result;
  const panel = shell.panels.plan;
  const form = panel.querySelector('#fr-plan-form');
  const item = panel.querySelector('#fr-plan-item');
  const qty = panel.querySelector('#fr-plan-qty');
  const resolve = panel.querySelector('#fr-resolve-plan');
  const run = shell.queueControls.querySelector('#fr-run');
  app.state.selectedItemId = 'log';
  app.renderItemDetail();
  const detailPlan = shell.panels.items.querySelector('#fr-item-detail').querySelector('#fr-detail-plan');
  const originalPlan = { ok: true, steps: [{ skillId: 'woodcutting', actionId: 'chop_log', actionName: 'Chop Harbor Tree', produceItemId: 'log', produceQty: 1 }] };

  for (const phase of ['starting', 'running', 'paused']) {
    const originalStatus = { phase, currentStep: 0, message: `${phase} unchanged` };
    app.state.currentPlan = originalPlan;
    app.state.executorStatus = originalStatus;
    app.renderPlan();

    assert.equal(isExecutionLocked(phase), true);
    assert.equal(item.disabled, false);
    assert.equal(qty.disabled, false);
    assert.equal(resolve.disabled, false);
    assert.equal(detailPlan.disabled, false);
    assert.equal(run.disabled, true);

    item.value = 'plank';
    qty.value = '7';
    form.dispatch('submit');
    shell.panels.items.querySelector('#fr-item-detail').dispatch('click', { target: { closest: () => detailPlan } });
    run.dispatch('click');
    assert.equal(app.state.currentPlan, originalPlan);
    assert.equal(app.state.executorStatus, originalStatus);
    assert.equal(item.value, 'plank');
    assert.equal(starts, 0);
  }

  for (const phase of ['idle', 'complete', 'error']) assert.equal(isExecutionLocked(phase), false);
});

test('overlay never references the game native action queue', () => {
  const source = readFileSync(fileURLToPath(new URL('../../overlay/overlay.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /actionQueue/);
});
