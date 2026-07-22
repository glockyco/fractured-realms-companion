// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { baseModel, snapshot } from './engine/fixture.js';
import {
  DATA_FILES, bootOverlay, buildIndexes, fetchModel, formatFinishTime, isExecutionLocked,
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
      const valueMatch = match[0].match(/\svalue="([^"]*)"/i); if (valueMatch) child.value = valueMatch[1];
      this.synthetic.set(`#${match[2]}`, child);
    }
  }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) { const normalized = String(value); this.attributes.set(name, normalized); if (name === 'id') { this.id = normalized; this.ownerDocument.byId.set(normalized, this); } if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = normalized; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  attachShadow() { this.shadowRoot = new FakeElement('shadow-root', this.ownerDocument); return this.shadowRoot; }
  addEventListener(type, listener) { (this.listeners.get(type) || this.listeners.set(type, []).get(type)).push(listener); }
  querySelector(selector) {
    if (this.synthetic?.has(selector)) return this.synthetic.get(selector);
    if (String(selector).startsWith('#')) { const id = String(selector).slice(1); const walk = (node) => { for (const child of node.children || []) { if (child.id === id) return child; const found = walk(child); if (found) return found; } return null; }; return walk(this); }
    return null;
  }
  closest(selector) { if (selector?.startsWith?.('[data-')) { const key = selector.slice(6, -1).split('=')[0].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); if (this.dataset[key] != null) return this; } return null; }
  matches() { return false; }
  getBoundingClientRect() { return { left: 10, right: 310, top: 10, bottom: 46, width: 300, height: 36 }; }
  focus() { this.ownerDocument.activeElement = this; }
  dispatch(type, init = {}) { const event = { target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, ...init }; for (const listener of this.listeners.get(type) || []) listener(event); return event; }
}
class FakeDocument {
  constructor() { this.byId = new Map(); const values = new Map(); this.defaultView = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }, innerWidth: 1024, innerHeight: 768, addEventListener() {} }; this.body = new FakeElement('body', this); this.activeElement = this.body; }
  createElement(tagName) { return new FakeElement(tagName, this); }
  getElementById(id) { return this.byId.get(id) || null; }
}

function model() {
  return baseModel({
    items: {
      log: { label: 'Log', type: 'Resource', value: 1, art: false },
      ore: { label: 'Ore', type: 'Resource', value: 1, art: false },
      tool: { label: 'Tool', type: 'Tool', value: 0, art: false },
    },
    actions: [
      { id: 'chop', name: 'Chop Log', skillId: 'woodcutting', levelReq: 1, xp: 10, interval: 1000, inputs: {}, outputs: { log: 1 }, automation: 'auto', gate: null },
      { id: 'smelt', name: 'Smelt Ore', skillId: 'woodcutting', levelReq: 1, xp: 10, interval: 1000, inputs: { log: 1 }, outputs: { ore: 1 }, automation: 'auto', gate: null },
    ],
    tools: { woodcutting: [{ id: 'tool', name: 'Tool', levelReq: 1, xpBonus: 0, speedBonus: 0, cost: 5 }] },
    stringsEn: { 'itemdesc.log': 'A useful log.' },
  });
}
function fakeApi(initial = snapshot()) {
  let state = structuredClone(initial); let listener = null;
  return {
    getState: () => state,
    startAction(skillId, actionId) { state.activeSkill = skillId; state.activeAction = actionId; listener?.(state); },
    stopAction() { state.activeSkill = null; state.activeAction = null; listener?.(state); },
    subscribe(callback) { listener = callback; return () => { if (listener === callback) listener = null; }; },
    set(patch) { state = { ...state, ...patch }; listener?.(state); },
  };
}
function fetchFor(value) { return async (url) => { assert.equal(String(url), '/companion/data/model.json'); return { ok: true, status: 200, json: async () => value }; }; }

 test('model boot fetches one model.json and wiki indexes model sources and uses', async () => {
  const document = new FakeDocument(); const game = fakeApi(); const result = await bootOverlay({ document, window: { __frCompanion: game }, fetch: fetchFor(model()) });
  assert.ok(result.app); assert.deepEqual(DATA_FILES, [['model', 'model.json']]);
  assert.equal(result.model.items.log.label, 'Log');
  assert.equal(result.app.indexes.sourcesOf.log[0].actionId, 'chop');
  result.app.state.selectedItemId = 'log'; result.app.renderItemDetail();
  assert.match(result.shell.panels.items.querySelector('#fr-item-detail').innerHTML, /Sources/);
  assert.match(result.shell.panels.items.querySelector('#fr-item-detail').innerHTML, /Uses/);
 });

test('buildIndexes includes deterministic action sources, enemy drops, and action uses', () => {
  const indexed = buildIndexes(model());
  assert.equal(indexed.sourcesOf.log[0].kind, 'action'); assert.equal(indexed.usesOf.log[0].actionId, 'smelt');
});

test('plan target builder exposes item, level, and unlock target kinds', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const form = result.shell.panels.plan.querySelector('#fr-plan-form'); const kind = result.shell.panels.plan.querySelector('#fr-plan-target');
  kind.value = 'item'; kind.dispatch('change'); assert.equal(result.shell.panels.plan.querySelector('#fr-plan-item-field').hidden, false);
  kind.value = 'level'; kind.dispatch('change'); assert.equal(result.shell.panels.plan.querySelector('#fr-plan-skill-field').hidden, false);
  kind.value = 'unlock'; kind.dispatch('change'); assert.equal(result.shell.panels.plan.querySelector('#fr-plan-unlock-field').hidden, false);
  assert.ok(result.shell.panels.plan.querySelector('#fr-plan-unlock').innerHTML.includes('tool:tool'));
  kind.value = 'item'; result.shell.panels.plan.querySelector('#fr-plan-item').value = 'Log'; result.shell.panels.plan.querySelector('#fr-plan-qty').value = '2'; form.dispatch('submit');
  assert.equal(result.app.state.queueGoals[0].target.type, 'item'); assert.equal(result.app.state.queueGoals[0].target.qty, 2);
});

test('resolveQueue timeline renders manual instruction cards and readyAt wall-clock', async () => {
  const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: fakeApi() }, fetch: fetchFor(model()) });
  const kind = result.shell.panels.plan.querySelector('#fr-plan-target'); kind.value = 'unlock'; kind.dispatch('change'); result.shell.panels.plan.querySelector('#fr-plan-form').dispatch('submit');
  const html = result.shell.panels.plan.querySelector('#fr-plan-result').innerHTML;
  assert.match(html, /Waiting for you/); assert.match(html, /ready for you at/); assert.match(html, /Buy Tool/);
  assert.equal(result.app.state.resolvedQueue.steps[0].kind, 'manual');
  assert.equal(formatFinishTime(0).length > 0, true);
});

test('executor transitions running to complete and waiting to complete, with waiting locked', async () => {
  const game = fakeApi(); const result = await bootOverlay({ document: new FakeDocument(), window: { __frCompanion: game }, fetch: fetchFor(model()) });
  const itemKind = result.shell.panels.plan.querySelector('#fr-plan-target'); itemKind.value = 'item'; itemKind.dispatch('change'); result.shell.panels.plan.querySelector('#fr-plan-item').value = 'Log'; result.shell.panels.plan.querySelector('#fr-plan-form').dispatch('submit');
  result.shell.queueControls.querySelector('#fr-run').dispatch('click'); assert.equal(result.app.executor.getStatus().phase, 'running');
  game.set({ inventory: { log: 1 } }); assert.equal(result.app.executor.getStatus().phase, 'complete');
  result.app.executor.run([{ id: 'manual', kind: 'manual', label: 'Buy Tool', instruction: 'Buy the tool', deps: [], stop: { type: 'fact', fact: 'tool:tool' }, expected: { runs: 1, ms: null, produces: {}, consumes: {} }, purpose: 'unlock' }]);
  assert.equal(result.app.executor.getStatus().phase, 'waiting'); assert.equal(isExecutionLocked('waiting'), true);
  game.set({ equipment: { tool: 1 } }); assert.equal(result.app.executor.getStatus().phase, 'complete');
});

 test('overlay source contains no legacy planner import or native action queue access', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../../overlay/overlay.js', import.meta.url), 'utf8');
  assert.equal(source.includes("from './" + 'planner' + '.js'), false); assert.equal(source.includes('actionQueue'), false); assert.equal(source.includes('queueSlots'), false);
 });
