// @ts-nocheck
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { baseModel, snapshot } from './engine/fixture.js';
import {
  DATA_FILES, bootOverlay, buildIndexes, formatFinishTime, isExecutionLocked,
} from '../../overlay/overlay.js';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase(); this.ownerDocument = ownerDocument; this.attributes = new Map();
    this.children = []; this.listeners = new Map(); this.dataset = {}; this.style = {}; this.hidden = false;
    this.disabled = false; this.value = ''; this.className = ''; this._innerHTML = ''; this.textContent = '';
  }
  set innerHTML(value) {
    this._innerHTML = String(value); this.synthetic = new Map();
    for (const match of this._innerHTML.matchAll(/<([a-z][\w-]*)[^>]*\sid="([^"]+)"[^>]*>/gi)) {
      const child = new FakeElement(match[1], this.ownerDocument); child.setAttribute('id', match[2]);
      if (/\sdisabled(?:\s|>|=)/i.test(match[0])) child.disabled = true;
      if (/\shidden(?:\s|>|=)/i.test(match[0])) child.hidden = true;
      const valueMatch = match[0].match(/\svalue="([^"]*)"/i); if (valueMatch) child.value = valueMatch[1];
      this.synthetic.set(`#${match[2]}`, child);
    }
  }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) { const normalized = String(value); this.attributes.set(name, normalized); if (name === 'id') { this.id = normalized; this.ownerDocument.byId.set(normalized, this); } if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = normalized; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  attachShadow() { this.shadowRoot = new FakeElement('shadow-root', this.ownerDocument); return this.shadowRoot; }
  addEventListener(type, listener) { (this.listeners.get(type) || this.listeners.set(type, []).get(type)).push(listener); }
  querySelector(selector) {
    if (this.synthetic?.has(selector)) return this.synthetic.get(selector);
    if (String(selector).startsWith('#')) { const id = String(selector).slice(1); const walk = (node) => { for (const child of node.children || []) { if (child.id === id) return child; const found = walk(child); if (found) return found; } return null; }; return walk(this); }
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-start-action]') return [...this._innerHTML.matchAll(/<button[^>]*data-start-action[^>]*>/gi)].map((match) => {
      const child = new FakeElement('button', this.ownerDocument); for (const attr of ['skill-id', 'action-id']) { const found = match[0].match(new RegExp(`data-${attr}="([^"]*)"`, 'i')); if (found) child.dataset[attr.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = found[1]; } return child;
    });
    return [];
  }
  closest(selector) { if (selector?.startsWith?.('[data-')) { const key = selector.slice(6, -1).split('=')[0].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); if (this.dataset[key] != null) return this; } return null; }
  matches() { return false; }
  getBoundingClientRect() { return { left: 10, right: 310, top: 10, bottom: 46, width: 300, height: 36 }; }
  focus() { this.ownerDocument.activeElement = this; }
  dispatch(type, init = {}) { const event = { target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, ...init }; for (const listener of this.listeners.get(type) || []) listener(event); return event; }
}
class FakeDocument {
  constructor(initialStorage = {}) { this.byId = new Map(); const values = new Map(Object.entries(initialStorage)); this.defaultView = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }, innerWidth: 1024, innerHeight: 768, addEventListener() {} }; this.body = new FakeElement('body', this); this.activeElement = this.body; }
  createElement(tagName) { return new FakeElement(tagName, this); }
  getElementById(id) { return this.byId.get(id) || null; }
}

function model(overrides = {}) {
  return baseModel({
    items: {
      log: { label: 'Log', type: 'Resource', value: 1, art: false },
      ore: { label: 'Ore', type: 'Resource', value: 1, art: false },
      tool: { label: 'Tool', type: 'Tool', value: 0, art: false },
    },
    actions: [
      { id: 'chop', name: 'Chop Log', skillId: 'woodcutting', levelReq: 1, xp: 10, interval: 1000, inputs: {}, outputs: { log: 1 }, automation: 'auto', gate: null },
      { id: 'smelt', name: 'Smelt Ore', skillId: 'woodcutting', levelReq: 1, xp: 10, interval: 1000, inputs: { log: 1 }, outputs: { ore: 1 }, toolReq: 'tool', automation: 'auto', gate: null },
    ],
    tools: { woodcutting: [{ id: 'tool', name: 'Tool', levelReq: 1, xpBonus: 0, speedBonus: 0, cost: 5 }] },
    stringsEn: { 'itemdesc.log': 'A useful log.' },
    ...overrides,
  });
}
function fakeApi(initial = snapshot()) {
  let state = structuredClone(initial); let listener = null; let starts = 0; let stops = 0;
  return {
    getState: () => state,
    startAction(skillId, actionId) { starts += 1; state.activeSkill = skillId; state.activeAction = actionId; listener?.(state); },
    stopAction() { stops += 1; state.activeSkill = null; state.activeAction = null; listener?.(state); },
    subscribe(callback) { listener = callback; return () => { if (listener === callback) listener = null; }; },
    set(patch) { state = { ...state, ...patch }; listener?.(state); },
    get starts() { return starts; }, get stops() { return stops; },
  };
}
function fetchFor(value) { return async (url) => { assert.equal(String(url), '/companion/data/model.json'); return { ok: true, status: 200, json: async () => value }; }; }

class FakeWorker {
  constructor(url, opts) { this.url = url; this.opts = opts; this.posted = []; FakeWorker.last = this; }
  postMessage(message) { this.posted.push(message); }
  reply(message) { this.onmessage?.({ data: message }); }
  fail() { this.onerror?.({}); }
}
function installWorker(document) {
  document.defaultView.Worker = FakeWorker;
  document.defaultView.Blob = class { constructor(parts, options) { this.parts = parts; this.options = options; } };
  document.defaultView.URL = { createObjectURL: () => 'blob:plan-worker' };
  return document;
}
function fabricatedPlan(target) {
  const step = { id: 'q0:x', kind: 'action', label: 'X', deps: [], skillId: 'woodcutting', actionId: 'chop', expected: { runs: 1, ms: 1000, produces: {}, consumes: {} }, purpose: 'goal' };
  return { steps: [step], targets: [{ target, ok: true, steps: [step] }], perStep: [{ id: 'q0:x', startMs: 0, endMs: 1000 }], readyAt: {}, optimisticMs: 1000, schedulerMs: 1000 };
}

test('model boot fetches one model.json and wiki indexes model sources and uses', async () => {
  const document = new FakeDocument(); const game = fakeApi(); const result = await bootOverlay({ document, window: { __frCompanion: game }, fetch: fetchFor(model()) });
  assert.ok(result.app); assert.deepEqual(DATA_FILES, [['model', 'model.json']]);
  assert.equal(result.model.items.log.label, 'Log'); assert.equal(result.app.indexes.sourcesOf.log[0].actionId, 'chop');
  result.app.state.selectedItemId = 'log'; result.app.renderItemDetail();
  assert.match(result.shell.panels.items.querySelector('#fr-item-detail').innerHTML, /Sources/); assert.match(result.shell.panels.items.querySelector('#fr-item-detail').innerHTML, /Uses/);
});

test('buildIndexes includes deterministic action sources, enemy drops, and action uses', () => {
  const indexed = buildIndexes(model()); assert.equal(indexed.sourcesOf.log[0].kind, 'action'); assert.equal(indexed.usesOf.log[0].actionId, 'smelt');
});

test('plan target builder exposes item, level, and action target kinds', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const form = result.shell.panels.plan.querySelector('#fr-plan-form'); const kind = result.shell.panels.plan.querySelector('#fr-plan-target');
  kind.value = 'item'; kind.dispatch('change'); assert.equal(result.shell.panels.plan.querySelector('#fr-plan-item-field').hidden, false);
  kind.value = 'level'; kind.dispatch('change'); assert.equal(result.shell.panels.plan.querySelector('#fr-plan-skill-field').hidden, false);
  kind.value = 'action'; kind.dispatch('change'); assert.equal(result.shell.panels.plan.querySelector('#fr-plan-action-field').hidden, false);
  kind.value = 'item'; result.shell.panels.plan.querySelector('#fr-plan-item').value = 'Log'; result.shell.panels.plan.querySelector('#fr-plan-qty').value = '2'; form.dispatch('submit');
  assert.equal(result.app.state.queueGoals[0].target.type, 'item'); assert.equal(result.app.state.queueGoals[0].target.qty, 2);
});

test('resolveQueue timeline renders manual instruction cards and readyAt wall-clock', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Ore'; plan.querySelector('#fr-plan-form').dispatch('submit');
  const html = plan.querySelector('#fr-plan-result').innerHTML;
  assert.match(html, /instruction-card/); assert.match(html, /Needs you/); assert.match(html, /Buy Tool/); assert.ok(result.app.state.resolvedQueue.steps.some((step) => step.kind === 'manual')); assert.equal(formatFinishTime(0).length > 0, true);
});

test('clear queue is enabled for stored targets and removes them', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const plan = result.shell.panels.plan; const form = plan.querySelector('#fr-plan-form'); const item = plan.querySelector('#fr-plan-item'); item.value = 'Log'; form.dispatch('submit');
  const clear = result.shell.panels.plan.querySelector('#fr-clear'); assert.equal(clear.disabled, false); clear.dispatch('click'); const confirmation = plan.querySelector('#fr-plan-toolbar').querySelector('#fr-clear-confirmation'); assert.ok(confirmation); confirmation.querySelector('#fr-clear-cancel').dispatch('click'); assert.equal(result.app.state.queueGoals.length, 1); clear.dispatch('click'); confirmation.querySelector('#fr-clear-confirm').dispatch('click'); assert.equal(result.app.state.queueGoals.length, 0); assert.equal(result.app.state.resolvedQueue.steps.length, 0); assert.equal(clear.disabled, true);
});

test('queue targets can be reordered to the top', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const plan = result.shell.panels.plan;
  plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-form').dispatch('submit');
  plan.querySelector('#fr-plan-item').value = 'Ore'; plan.querySelector('#fr-plan-form').dispatch('submit');
  assert.equal(result.app.state.queueGoals.length, 2);
  const last = result.app.state.queueGoals[1].id;
  const button = new FakeElement('button', document); button.dataset.queueMove = 'top'; button.dataset.queueGoal = last;
  plan.dispatch('click', { target: button });
  assert.equal(result.app.state.queueGoals[0].id, last);
});

test('compact strip mirrors queue controls and progress', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-form').dispatch('submit');
  const compact = result.shell.compactStrip; const start = compact.querySelector('#fr-compact-start'); const progress = compact.querySelector('#fr-compact-progress'); assert.equal(start.hidden, false); assert.equal(progress.max, 1);
  result.app.executor.run([{ id: 'manual', kind: 'manual', label: 'Buy Tool', deps: [], stop: { type: 'fact', fact: 'tool:tool' }, expected: { runs: 1, ms: null, produces: {}, consumes: {} }, purpose: 'unlock' }]);
  assert.equal(compact.querySelector('#fr-compact-resume').hidden, false); assert.equal(compact.querySelector('#fr-compact-stop').hidden, false); result.app.executor.stop(); assert.equal(compact.querySelector('#fr-compact-start').hidden, false);
});

test('executor transitions running to complete and waiting to complete, with waiting locked', async () => {
  const game = fakeApi(); const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: game }, fetch: fetchFor(model()) });
  const itemKind = result.shell.panels.plan.querySelector('#fr-plan-target'); itemKind.value = 'item'; itemKind.dispatch('change'); result.shell.panels.plan.querySelector('#fr-plan-item').value = 'Log'; result.shell.panels.plan.querySelector('#fr-plan-form').dispatch('submit');
  result.shell.queueControls.querySelector('#fr-run').dispatch('click'); assert.equal(result.app.executor.getStatus().phase, 'running'); game.set({ inventory: { log: 1 } }); assert.equal(result.app.executor.getStatus().phase, 'complete');
  result.app.executor.run([{ id: 'manual', kind: 'manual', label: 'Buy Tool', instruction: 'Buy the tool', deps: [], stop: { type: 'fact', fact: 'tool:tool' }, expected: { runs: 1, ms: null, produces: {}, consumes: {} }, purpose: 'unlock' }]);
  assert.equal(result.app.executor.getStatus().phase, 'waiting'); assert.equal(isExecutionLocked('waiting'), true); game.set({ equipment: { tool: 1 } }); assert.equal(result.app.executor.getStatus().phase, 'complete');
});

test('skills start controls respect running and waiting execution locks', async () => {
  const game = fakeApi(); const document = new FakeDocument(); const result = await bootOverlay({ document, window: { __frCompanion: game }, fetch: fetchFor(model()) });
  const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-form').dispatch('submit'); result.shell.queueControls.querySelector('#fr-run').dispatch('click');
  const skillButton = new FakeElement('button', document); skillButton.dataset.startAction = ''; skillButton.dataset.skillId = 'woodcutting'; skillButton.dataset.actionId = 'chop'; const skillTable = result.shell.panels.skills.querySelector('#fr-skill-table'); const starts = game.starts;
  skillTable.dispatch('click', { target: skillButton }); assert.equal(game.starts, starts); assert.equal(isExecutionLocked(result.app.executor.getStatus().phase), true);
  result.app.executor.run([{ id: 'manual', kind: 'manual', label: 'Buy Tool', deps: [], stop: { type: 'fact', fact: 'tool:tool' }, expected: { runs: 1, ms: null, produces: {}, consumes: {} }, purpose: 'unlock' }]); assert.equal(result.app.executor.getStatus().phase, 'waiting'); skillTable.dispatch('click', { target: skillButton }); assert.equal(game.starts, starts); result.app.executor.stop();
});

test('restore drops malformed persisted targets against the model schema', async () => {
  const stored = { goals: [
    { id: 'valid', target: { type: 'item', itemId: 'log', qty: 1 } }, { id: 'legacy', target: { type: 'gain', itemId: 'log', gain: 1 } },
    { id: 'missing-item', target: { type: 'item', itemId: 'missing', qty: 1 } }, { id: 'bad-action', target: { type: 'action', skillId: 'woodcutting', actionId: 'missing', runs: 1 } },
    { id: 'bad-unlock', target: { type: 'unlock', fact: 'tool:missing' } }, { id: 'bad-qty', target: { type: 'gold', amount: 0 } },
  ], nextPlanId: 9 };
  const result = await bootOverlay({ document: new FakeDocument({ 'fractured-realms-companion.queue.v1': JSON.stringify(stored) }), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  assert.deepEqual(result.app.state.queueGoals.map((entry) => entry.id), ['valid']); assert.equal(result.app.state.nextPlanId, 9);
});

test('targets queued behind a blocked target remain visible', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  result.app.state.queueGoals = [{ id: 'blocked', target: { type: 'item', itemId: 'missing', qty: 1 } }, { id: 'later', target: { type: 'item', itemId: 'log', qty: 1 } }]; result.app.refreshQueue(); result.app.renderPlan();
  const html = result.shell.panels.plan.querySelector('#fr-plan-result').innerHTML; assert.match(html, /Missing/); assert.match(html, /Waiting for the blocked target above/); assert.doesNotMatch(html, /blocked\.reason/);
});

test('plan result surfaces operational overview and presence summary', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-form').dispatch('submit');
  const html = plan.querySelector('#fr-plan-result').innerHTML; assert.match(html, /id="fr-queue-total"/); assert.match(html, /Estimate/); assert.match(html, /Manual stops/); assert.match(html, /Runs fully unattended|Runs ~/);
});

test('planner validation uses a form error without changing executor phase', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); result.shell.panels.plan.querySelector('#fr-plan-form').dispatch('submit');
  const formError = result.shell.panels.plan.querySelector('#fr-plan-form-error'); assert.equal(result.app.executor.getStatus().phase, 'idle'); assert.equal(formError.hidden, false); assert.match(formError.textContent, /Choose an item/);
});

test('planner item combobox selects with ArrowDown and Enter', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); const item = result.shell.panels.plan.querySelector('#fr-plan-item'); item.value = 'Lo'; item.dispatch('input'); item.dispatch('keydown', { key: 'ArrowDown' }); item.dispatch('keydown', { key: 'Enter' });
  assert.equal(result.app.state.selectedPlanItemId, 'log'); assert.equal(item.value, 'Log'); assert.equal(item.getAttribute('aria-expanded'), 'false');
});

test('wiki detail shows recipe healing and skills table tool column', async () => {
  const base = model(); const fixture = model({ items: { ...base.items, log: { ...base.items.log, type: 'Consumable', healAmount: 25 } }, recipeMeals: [{ id: 'meal_recipe', output: 'log', healAmount: 25, levelReq: 1 }], actions: [{ id: 'chop', name: 'Chop Log', skillId: 'woodcutting', levelReq: 1, xp: 10, interval: 1000, inputs: {}, outputs: { log: 1 }, toolReq: 'tool', automation: 'auto', gate: null }, { id: 'smelt', name: 'Smelt Ore', skillId: 'woodcutting', levelReq: 1, xp: 10, interval: 1000, inputs: { log: 1 }, outputs: { ore: 1 }, automation: 'auto', gate: null }] });
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(fixture) }); result.app.state.selectedItemId = 'log'; result.app.renderItemDetail();
  assert.match(result.shell.panels.items.querySelector('#fr-item-detail').innerHTML, /Healing/); assert.match(result.shell.panels.skills.querySelector('#fr-skill-table').innerHTML, />Tool</);
});

test('composer retains fields and exposes exact kind help copy', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); const plan = result.shell.panels.plan; const kind = plan.querySelector('#fr-plan-target'); const qty = plan.querySelector('#fr-plan-qty'); const help = plan.querySelector('#fr-plan-kind-help'); const cases = [['item', 'Reach an inventory total.', 'Total quantity'], ['item-gain', 'Gain this many from your current inventory.', 'Quantity to gain'], ['level', 'Reach a total skill level.', 'Target level'], ['xp', 'Reach a total skill XP value.', 'Target XP'], ['action', 'Run one action for a count or duration.', 'Amount'], ['use-stock', 'Craft as much as your current inputs allow.', 'Amount']];
  for (const [value, copy, label] of cases) { kind.value = value; kind.dispatch('change'); assert.equal(help.textContent, copy); assert.equal(plan.querySelector('#fr-plan-qty-label').textContent, label); }
  kind.value = 'item'; kind.dispatch('change'); plan.querySelector('#fr-plan-item').value = 'Log'; qty.value = '3'; plan.querySelector('#fr-plan-form').dispatch('submit'); assert.equal(plan.querySelector('#fr-plan-composer').hidden, true); assert.equal(plan.querySelector('#fr-plan-compose-toggle').hidden, false); assert.equal(qty.value, '3'); plan.querySelector('#fr-plan-compose-toggle').dispatch('click'); assert.equal(plan.querySelector('#fr-plan-composer').hidden, false); assert.equal(qty.value, '3');
});

test('planner rejects non-finite and fractional quantities with associated ARIA error', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Log'; const qty = plan.querySelector('#fr-plan-qty'); qty.value = '1.5'; plan.querySelector('#fr-plan-form').dispatch('submit'); const error = plan.querySelector('#fr-plan-form-error'); assert.equal(result.app.state.queueGoals.length, 0); assert.equal(qty.getAttribute('aria-invalid'), 'true'); assert.equal(qty.getAttribute('aria-describedby'), 'fr-plan-form-error'); assert.match(error.textContent, /whole number/);
});

test('targets render Planned then Done from live truth with proximity values', async () => {
  const game = fakeApi(); const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: game }, fetch: fetchFor(model()) }); const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-qty').value = '2'; plan.querySelector('#fr-plan-form').dispatch('submit'); let html = plan.querySelector('#fr-plan-result').innerHTML; assert.match(html, /data-state="planned"/); assert.match(html, /<span class="data">0<\/span> \/ <span class="data">2<\/span> Log/); game.set({ inventory: { log: 2 } }); result.app.renderPlan(); html = plan.querySelector('#fr-plan-result').innerHTML; assert.match(html, /data-state="done"/); assert.match(html, /Done/);
});

test('locked target edits remain visible and disabled with lock hint', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-form').dispatch('submit'); result.shell.queueControls.querySelector('#fr-run').dispatch('click'); const html = plan.querySelector('#fr-plan-result').innerHTML; assert.match(html, /data-queue-move/); assert.match(html, /data-queue-remove/); assert.match(html, /aria-describedby="fr-plan-edit-lock-hint"/); assert.match(html, /disabled/);
});

test('level and XP target proximity uses live formulas', async () => {
  const game = fakeApi({ ...snapshot(), skillXp: { woodcutting: 10 } }); const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: game }, fetch: fetchFor(model()) }); result.app.state.queueGoals = [{ id: 'level', target: { type: 'level', skillId: 'woodcutting', level: 2 } }, { id: 'xp', target: { type: 'xp', skillId: 'woodcutting', xp: 25 } }]; result.app.refreshQueue(); result.app.renderPlan(); const html = result.shell.panels.plan.querySelector('#fr-plan-result').innerHTML; assert.match(html, /Level <span class="data">1<\/span> \/ <span class="data">2<\/span>/); assert.match(html, /<span class="data">10<\/span> \/ <span class="data">25<\/span> XP/);
});

test('timeline states dependencies and fractional executor progress without timer announcements', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) }); const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Ore'; plan.querySelector('#fr-plan-form').dispatch('submit'); const step = result.app.state.resolvedQueue.steps.find((entry) => entry.kind !== 'manual'); result.app.state.executorStatus = { phase: 'running', message: '', totalSteps: result.app.state.resolvedQueue.steps.length, completedSteps: 0, runningStepId: step.id, stepStatuses: { [step.id]: 'running' }, stepProgress: 1, stepProgressMax: 2, stepRemainingMs: 1000 }; result.app.renderPlan(); const progress = plan.querySelector('#fr-executor-progress'); assert.equal(progress.value, 0.5); const announcement = plan.querySelector('#fr-plan-announcer').textContent; result.app.state.executorStatus.stepRemainingMs = 500; result.app.renderPlan(); assert.equal(plan.querySelector('#fr-plan-announcer').textContent, announcement); assert.match(plan.querySelector('#fr-plan-result').innerHTML, /data-state="later"|data-state="running"/);
});

test('timeline steps nest under each target card', async () => {
  const document = new FakeDocument();
  const result = await bootOverlay({ document, window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const plan = result.shell.panels.plan;
  plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-form').dispatch('submit');
  plan.querySelector('#fr-plan-item').value = 'Ore'; plan.querySelector('#fr-plan-form').dispatch('submit');
  const container = plan.querySelector('#fr-plan-result');
  const html = container.innerHTML;
  assert.equal((html.match(/class="queue-plan"/g) || []).length, 2);
  assert.match(html, /class="queue-steps"/); assert.match(html, /class="[^"]*plan-step/);
});

test('start control is hidden while a plan runs, leaving stop visible', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const plan = result.shell.panels.plan; plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-form').dispatch('submit');
  const run = result.shell.queueControls.querySelector('#fr-run'); const stop = result.shell.queueControls.querySelector('#fr-stop');
  assert.equal(run.hidden, false); run.dispatch('click');
  assert.equal(result.app.executor.getStatus().phase, 'running'); assert.equal(run.hidden, true); assert.equal(stop.hidden, false); result.app.executor.stop();
});

test('a step blocked only by an unfinished dependency reads "waiting for" that dependency', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const A = { id: 'q0:a', kind: 'action', label: 'Alpha', deps: [], skillId: 'woodcutting', actionId: 'chop', expected: { runs: 1, ms: 1000, produces: {}, consumes: {} }, purpose: 'gather' };
  const B = { id: 'q0:b', kind: 'action', label: 'Beta', deps: ['q0:a'], skillId: 'woodcutting', actionId: 'chop', expected: { runs: 1, ms: 1000, produces: {}, consumes: {} }, purpose: 'goal' };
  result.app.state.queueGoals = [{ id: 't', target: { type: 'item', itemId: 'log', qty: 1 } }];
  result.app.state.resolvedQueue = { steps: [A, B], targets: [{ target: result.app.state.queueGoals[0].target, ok: true, steps: [A, B] }], perStep: [{ id: 'q0:a', startMs: 0, endMs: 1000 }, { id: 'q0:b', startMs: 1000, endMs: 2000 }], readyAt: {}, optimisticMs: 2000, schedulerMs: 2000 };
  result.app.state.executorStatus = { phase: 'idle', stepStatuses: {} };
  result.app.renderPlan();
  assert.match(result.shell.panels.plan.querySelector('#fr-plan-result').innerHTML, /waiting for Alpha/);
});

test('a slow plan shows a busy spinner in the tab bar until the worker replies', async () => {
  const document = installWorker(new FakeDocument());
  const result = await bootOverlay({ document, window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const worker = FakeWorker.last;
  const plan = result.shell.panels.plan;
  const spinner = result.shell.queueControls.querySelector('#fr-queue-spinner');
  assert.equal(spinner.hidden, true, 'spinner hidden at rest');
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-qty').value = '1'; plan.querySelector('#fr-plan-form').dispatch('submit');
    const settled = result.app.planSettled();
    assert.equal(spinner.hidden, true, 'spinner stays hidden before the delay elapses');
    mock.timers.tick(250);
    assert.equal(spinner.hidden, false, 'spinner appears once the plan outlasts the delay');
    const planMsg = worker.posted.find((message) => message.type === 'plan');
    worker.reply({ type: 'result', id: planMsg.id, result: fabricatedPlan(result.app.state.queueGoals[0].target) });
    await settled;
    assert.equal(spinner.hidden, true, 'spinner clears when the plan resolves');
  } finally { mock.timers.reset(); }
});

test('overlay source contains no legacy planner import or native action queue access', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../../overlay/overlay.js', import.meta.url), 'utf8');
  assert.equal(source.includes("from './" + 'planner' + '.js'), false); assert.equal(source.includes('actionQueue'), false); assert.equal(source.includes('queueSlots'), false);
});

test('planning runs in a worker when one is available and adopts its result off-thread', async () => {
  const document = installWorker(new FakeDocument());
  const result = await bootOverlay({ document, window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const worker = FakeWorker.last;
  assert.ok(worker, 'plan worker constructed');
  assert.equal(worker.posted[0]?.type, 'model');
  const plan = result.shell.panels.plan;
  plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-qty').value = '1';
  plan.querySelector('#fr-plan-form').dispatch('submit');
  const settled = result.app.planSettled();
  const planMsg = worker.posted.find((message) => message.type === 'plan');
  assert.ok(planMsg, 'plan request posted to the worker');
  assert.equal(result.app.state.queueGoals.length, 1);
  worker.reply({ type: 'result', id: planMsg.id, result: fabricatedPlan(result.app.state.queueGoals[0].target) });
  await settled;
  assert.equal(result.app.state.resolvedQueue.steps[0].id, 'q0:x');
  assert.equal(result.shell.host.dataset.planWorker, 'active');
  assert.match(plan.querySelector('#fr-plan-result').innerHTML, /queue-steps/);
});

test('every queue edit re-plans off-thread: removing a target never resolves synchronously', async () => {
  const document = installWorker(new FakeDocument());
  const result = await bootOverlay({ document, window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const worker = FakeWorker.last;
  const plan = result.shell.panels.plan;
  // Seed one target and settle its off-thread plan.
  plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-qty').value = '1'; plan.querySelector('#fr-plan-form').dispatch('submit');
  const addMsg = worker.posted.filter((message) => message.type === 'plan').at(-1);
  worker.reply({ type: 'result', id: addMsg.id, result: fabricatedPlan(result.app.state.queueGoals[0].target) });
  await result.app.planSettled();
  const before = worker.posted.filter((message) => message.type === 'plan').length;
  const staleSteps = result.app.state.resolvedQueue.steps.length;
  // Remove it. Goals mutate synchronously, but the re-plan is deferred to the worker;
  // the resolved queue must NOT change until the worker replies (no main-thread freeze).
  const goalId = result.app.state.queueGoals[0].id;
  const button = new FakeElement('button', document); button.dataset.queueRemove = goalId;
  plan.dispatch('click', { target: button });
  assert.equal(result.app.state.queueGoals.length, 0, 'goal removed synchronously');
  const removeMsgs = worker.posted.filter((message) => message.type === 'plan');
  assert.equal(removeMsgs.length, before + 1, 'remove posts a fresh off-thread plan request');
  assert.equal(result.app.state.resolvedQueue.steps.length, staleSteps, 'resolved queue unchanged before the worker replies');
  const settled = result.app.planSettled();
  worker.reply({ type: 'result', id: removeMsgs.at(-1).id, result: { steps: [], targets: [] } });
  await settled;
  assert.equal(result.app.state.resolvedQueue.steps.length, 0, 'worker reply adopted after removal');
});

test('a superseded worker plan reply is dropped (latest wins)', async () => {
  const document = installWorker(new FakeDocument());
  const result = await bootOverlay({ document, window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const worker = FakeWorker.last;
  const plan = result.shell.panels.plan;
  plan.querySelector('#fr-plan-item').value = 'Log'; plan.querySelector('#fr-plan-qty').value = '1'; plan.querySelector('#fr-plan-form').dispatch('submit'); const settledA = result.app.planSettled();
  plan.querySelector('#fr-plan-item').value = 'Ore'; plan.querySelector('#fr-plan-qty').value = '2'; plan.querySelector('#fr-plan-form').dispatch('submit'); const settledB = result.app.planSettled();
  const planMsgs = worker.posted.filter((message) => message.type === 'plan');
  assert.equal(planMsgs.length, 2);
  worker.reply({ type: 'result', id: planMsgs[1].id, result: { ...fabricatedPlan(result.app.state.queueGoals[1].target), optimisticMs: 222 } });
  await settledB;
  assert.equal(result.app.state.resolvedQueue.optimisticMs, 222, 'latest reply adopted');
  worker.reply({ type: 'result', id: planMsgs[0].id, result: { ...fabricatedPlan(result.app.state.queueGoals[0].target), optimisticMs: 111 } });
  await settledA;
  assert.equal(result.app.state.resolvedQueue.optimisticMs, 222, 'stale reply dropped');
});

test('a worker plan error falls back to synchronous planning', async () => {
  const document = installWorker(new FakeDocument());
  const result = await bootOverlay({ document, window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const worker = FakeWorker.last;
  const plan = result.shell.panels.plan;
  plan.querySelector('#fr-plan-item').value = 'Ore'; plan.querySelector('#fr-plan-qty').value = '1'; plan.querySelector('#fr-plan-form').dispatch('submit');
  const planMsg = worker.posted.find((message) => message.type === 'plan');
  const settled = result.app.planSettled();
  worker.reply({ type: 'result', id: planMsg.id, error: 'boom' });
  await settled;
  assert.ok(Array.isArray(result.app.state.resolvedQueue.steps), 'synchronous fallback produced a plan');
  assert.notEqual(result.shell.host.dataset.planWorker, 'active', 'error reply does not mark the worker active');
});
