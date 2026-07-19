import { createPlan } from './planner.js';
import { createDirectExecutor } from './executor.js';

export const DATA_FILES = Object.freeze([
  ['items', 'items.json'],
  ['actions', 'actions.json'],
  ['skills', 'skills.json'],
  ['xp', 'xp.json'],
  ['buildings', 'buildings.json'],
  ['digsites', 'digsites.json'],
  ['strings', 'strings-en.json'],
]);

const HOST_ID = 'fractured-realms-companion';
const TAB_IDS = Object.freeze(['items', 'skills', 'plan']);
const LIST_LIMIT = 120;
const SEARCH_LIMIT = 240;

const ICONS = Object.freeze({
  helm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V9.8a8 8 0 0 1 16 0v7.7M7 18v-7a5 5 0 0 1 10 0v7M3 18h18M9 18v3m6-3v3"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 5 10 7-10 7Z"/><path d="M4 5v14"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4ZM12 9v5m0 3v.1"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
});

const CSS = `
:host {
  --fr-neutral-1000: oklch(0.14 0 0);
  --fr-neutral-950: oklch(0.19 0 0);
  --fr-neutral-900: oklch(0.24 0 0);
  --fr-neutral-800: oklch(0.32 0 0);
  --fr-neutral-700: oklch(0.42 0 0);
  --fr-neutral-300: oklch(0.78 0 0);
  --fr-neutral-100: oklch(0.94 0 0);
  --fr-harbor-950: oklch(0.20 0.04 230);
  --fr-harbor-800: oklch(0.36 0.10 230);
  --fr-harbor-600: oklch(0.50 0.13 230);
  --fr-harbor-400: oklch(0.76 0.11 230);
  --fr-brass-950: oklch(0.24 0.04 85);
  --fr-brass-700: oklch(0.45 0.09 85);
  --fr-brass-400: oklch(0.82 0.10 85);
  --fr-danger-950: oklch(0.24 0.05 25);
  --fr-danger-400: oklch(0.76 0.12 25);
  --fr-success-950: oklch(0.24 0.04 150);
  --fr-success-400: oklch(0.75 0.12 150);
  --fr-s1: 0.25rem;
  --fr-s2: 0.5rem;
  --fr-s3: 0.75rem;
  --fr-s4: 1rem;
  --fr-s5: 1.25rem;
  --fr-s6: 1.5rem;
  --fr-s8: 2rem;
  --fr-radius-sm: 0.25rem;
  --fr-radius-md: 0.5rem;
  --fr-radius-lg: 0.75rem;
  --fr-control: 2.25rem;
  --fr-launcher: 2.75rem;
  --fr-panel-gap: 0.5rem;
  --fr-launcher-offset: 4.25rem;
  --fr-panel-width: 48rem;
  --fr-panel-height: 42rem;
  --fr-panel-min: 19rem;
  --fr-row-min: 2.75rem;
  --fr-icon: 1rem;
  --fr-icon-lg: 1.25rem;
  --fr-z-overlay: 2147483000;
  --fr-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  color: var(--fr-neutral-100);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 0.875rem;
  line-height: 1.45;
  text-rendering: optimizeLegibility;
}
*, *::before, *::after { box-sizing: border-box; }
button, input, select { color: inherit; font: inherit; }
button { border: 0; }
svg {
  width: var(--fr-icon);
  height: var(--fr-icon);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.75;
  flex: 0 0 auto;
}
[hidden] { display: none !important; }
.launcher {
  position: fixed;
  z-index: var(--fr-z-overlay);
  right: var(--fr-panel-gap);
  bottom: var(--fr-panel-gap);
  min-height: var(--fr-launcher);
  display: inline-flex;
  align-items: center;
  gap: var(--fr-s2);
  padding: 0 var(--fr-s3);
  border: 1px solid var(--fr-neutral-700);
  border-radius: var(--fr-radius-md);
  background: var(--fr-neutral-950);
  color: var(--fr-neutral-100);
  box-shadow: 0 var(--fr-s2) var(--fr-s8) oklch(0 0 0 / 0.42);
  cursor: pointer;
  transition: background-color 180ms var(--fr-ease-out), border-color 180ms var(--fr-ease-out), transform 180ms var(--fr-ease-out);
}
.launcher:hover { background: var(--fr-neutral-900); border-color: var(--fr-harbor-400); }
.launcher:active { transform: translateY(1px); }
.launcher[data-state="error"] { border-color: var(--fr-danger-400); color: var(--fr-danger-400); }
.launcher[data-state="ready"] svg { color: var(--fr-harbor-400); }
.panel {
  position: fixed;
  z-index: var(--fr-z-overlay);
  inset: auto var(--fr-panel-gap) var(--fr-launcher-offset) auto;
  width: min(var(--fr-panel-width), calc(100vw - (2 * var(--fr-panel-gap))));
  height: min(var(--fr-panel-height), calc(100dvh - 5rem));
  min-width: min(var(--fr-panel-min), calc(100vw - (2 * var(--fr-panel-gap))));
  min-height: 20rem;
  max-width: calc(100vw - (2 * var(--fr-panel-gap)));
  max-height: calc(100dvh - 5rem);
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  overflow: hidden;
  resize: both;
  border: 1px solid var(--fr-neutral-700);
  border-radius: var(--fr-radius-lg);
  background: var(--fr-neutral-1000);
  color: var(--fr-neutral-100);
  box-shadow: 0 var(--fr-s4) var(--fr-s8) oklch(0 0 0 / 0.56);
  transform-origin: bottom right;
  transition: opacity 180ms var(--fr-ease-out), transform 180ms var(--fr-ease-out);
}
.panel[hidden] { opacity: 0; transform: translateY(var(--fr-s2)) scale(0.99); }
.panel-header {
  min-height: 3rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fr-s3);
  padding: var(--fr-s2) var(--fr-s3) var(--fr-s2) var(--fr-s4);
  border-bottom: 1px solid var(--fr-neutral-800);
  background: var(--fr-neutral-950);
}
.identity { min-width: 0; display: flex; align-items: center; gap: var(--fr-s2); }
.identity svg { color: var(--fr-harbor-400); width: var(--fr-icon-lg); height: var(--fr-icon-lg); }
.identity strong { font-size: 0.9375rem; font-weight: 650; letter-spacing: -0.01em; }
.icon-button {
  width: var(--fr-control);
  height: var(--fr-control);
  display: inline-grid;
  place-items: center;
  border-radius: var(--fr-radius-sm);
  background: transparent;
  color: var(--fr-neutral-300);
  cursor: pointer;
  transition: color 180ms var(--fr-ease-out), background-color 180ms var(--fr-ease-out);
}
.icon-button:hover { background: var(--fr-neutral-900); color: var(--fr-neutral-100); }
.banner {
  display: flex;
  align-items: flex-start;
  gap: var(--fr-s2);
  padding: var(--fr-s3) var(--fr-s4);
  border-bottom: 1px solid var(--fr-danger-400);
  background: var(--fr-danger-950);
  color: var(--fr-danger-400);
}
.banner svg { margin-top: 0.1rem; }
.banner strong { display: block; color: var(--fr-neutral-100); }
.banner p { max-width: 68ch; margin: var(--fr-s1) 0 0; }
.tabs {
  display: flex;
  gap: var(--fr-s1);
  padding: var(--fr-s1) var(--fr-s3) 0;
  border-bottom: 1px solid var(--fr-neutral-800);
  background: var(--fr-neutral-950);
}
.tab {
  min-height: var(--fr-control);
  padding: 0 var(--fr-s3);
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--fr-neutral-300);
  cursor: pointer;
  transition: color 180ms var(--fr-ease-out), border-color 180ms var(--fr-ease-out), background-color 180ms var(--fr-ease-out);
}
.tab:hover { background: var(--fr-neutral-900); color: var(--fr-neutral-100); }
.tab[aria-selected="true"] { border-color: var(--fr-harbor-400); color: var(--fr-neutral-100); }
.tabpanels, .tabpanel { min-height: 0; height: 100%; }
.tabpanel { overflow: auto; }
.items-layout { min-height: 100%; display: grid; grid-template-columns: minmax(13rem, 0.8fr) minmax(0, 1.35fr); }
.item-browser { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); border-right: 1px solid var(--fr-neutral-800); }
.toolbar { display: flex; align-items: end; gap: var(--fr-s2); padding: var(--fr-s3); }
.field { min-width: 0; display: grid; gap: var(--fr-s1); }
.field.grow { flex: 1 1 auto; }
.field label, .field-label { color: var(--fr-neutral-300); font-size: 0.75rem; font-weight: 600; }
.control, .search-control {
  min-height: var(--fr-control);
  width: 100%;
  border: 1px solid var(--fr-neutral-700);
  border-radius: var(--fr-radius-sm);
  background: var(--fr-neutral-950);
  color: var(--fr-neutral-100);
  transition: border-color 180ms var(--fr-ease-out), background-color 180ms var(--fr-ease-out);
}
.control { padding: 0 var(--fr-s2); }
.search-control { position: relative; display: flex; align-items: center; }
.search-control svg { position: absolute; left: var(--fr-s2); color: var(--fr-neutral-300); pointer-events: none; }
.search-control input { width: 100%; min-height: calc(var(--fr-control) - 2px); padding: 0 var(--fr-s2) 0 var(--fr-s8); border: 0; outline: 0; background: transparent; }
::placeholder { color: var(--fr-neutral-300); opacity: 1; }
.result-count { margin: 0; padding: 0 var(--fr-s3) var(--fr-s2); color: var(--fr-neutral-300); font-size: 0.75rem; }
.item-list { margin: 0; padding: 0; overflow: auto; list-style: none; }
.item-row {
  width: 100%;
  min-height: var(--fr-row-min);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fr-s2);
  padding: var(--fr-s2) var(--fr-s3);
  border-top: 1px solid var(--fr-neutral-800);
  background: transparent;
  color: var(--fr-neutral-100);
  text-align: left;
  cursor: pointer;
  transition: background-color 180ms var(--fr-ease-out), color 180ms var(--fr-ease-out);
}
.item-row:hover { background: var(--fr-neutral-950); }
.item-row[aria-current="true"] { background: var(--fr-harbor-950); color: var(--fr-harbor-400); }
.item-row span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-row code { color: var(--fr-neutral-300); font-size: 0.6875rem; }
.detail { min-width: 0; overflow: auto; padding: var(--fr-s4); }
.detail-empty, .empty { max-width: 48ch; margin: var(--fr-s8) auto; color: var(--fr-neutral-300); text-align: center; }
.item-heading { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--fr-s3); }
.item-art { width: 3rem; height: 3rem; object-fit: contain; image-rendering: auto; }
h2, h3, p { text-wrap: pretty; }
h2 { margin: 0; font-size: 1.125rem; line-height: 1.25; letter-spacing: -0.015em; }
h3 { margin: var(--fr-s5) 0 var(--fr-s2); font-size: 0.875rem; }
.meta { margin: var(--fr-s1) 0 0; color: var(--fr-neutral-300); font-size: 0.75rem; }
.prose { max-width: 68ch; margin: var(--fr-s4) 0; color: var(--fr-neutral-300); }
.facts { display: flex; flex-wrap: wrap; gap: var(--fr-s2) var(--fr-s4); margin: 0; }
.facts div { display: flex; align-items: baseline; gap: var(--fr-s2); }
.facts dt { color: var(--fr-neutral-300); font-size: 0.75rem; }
.facts dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; }
.record-list, .plan-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--fr-neutral-800); }
.record-row, .plan-step { padding: var(--fr-s3) 0; border-bottom: 1px solid var(--fr-neutral-800); }
.record-top, .step-top { display: flex; align-items: center; justify-content: space-between; gap: var(--fr-s2); }
.record-row p, .plan-step p { margin: var(--fr-s1) 0 0; color: var(--fr-neutral-300); }
.badges { display: flex; flex-wrap: wrap; gap: var(--fr-s1); }
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--fr-s1);
  min-height: 1.375rem;
  padding: 0 var(--fr-s2);
  border: 1px solid var(--fr-neutral-700);
  border-radius: 999px;
  color: var(--fr-neutral-300);
  font-size: 0.6875rem;
  font-weight: 650;
  white-space: nowrap;
}
.badge.signal { border-color: var(--fr-harbor-800); background: var(--fr-harbor-950); color: var(--fr-harbor-400); }
.badge.warning { border-color: var(--fr-brass-700); background: var(--fr-brass-950); color: var(--fr-brass-400); }
.badge.danger { border-color: var(--fr-danger-400); background: var(--fr-danger-950); color: var(--fr-danger-400); }
.mono, code, .data { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; }
.button {
  min-height: var(--fr-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--fr-s2);
  padding: 0 var(--fr-s3);
  border: 1px solid var(--fr-neutral-700);
  border-radius: var(--fr-radius-sm);
  background: var(--fr-neutral-900);
  color: var(--fr-neutral-100);
  font-weight: 650;
  cursor: pointer;
  transition: background-color 180ms var(--fr-ease-out), border-color 180ms var(--fr-ease-out), transform 180ms var(--fr-ease-out);
}
.button:hover { border-color: var(--fr-neutral-300); background: var(--fr-neutral-800); }
.button:active { transform: translateY(1px); }
.button.primary { border-color: var(--fr-harbor-600); background: var(--fr-harbor-600); color: var(--fr-neutral-100); }
.button.primary:hover { border-color: var(--fr-harbor-400); background: var(--fr-harbor-800); }
.button.danger { border-color: var(--fr-danger-400); background: var(--fr-danger-950); color: var(--fr-danger-400); }
.button:disabled, .control:disabled { cursor: not-allowed; opacity: 0.48; }
.button:focus-visible, .icon-button:focus-visible, .launcher:focus-visible, .tab:focus-visible, .control:focus-visible, .search-control:focus-within, .item-row:focus-visible {
  outline: 2px solid var(--fr-harbor-400);
  outline-offset: 2px;
}
.skills-view, .plan-view { padding: var(--fr-s4); }
.skills-toolbar { max-width: 24rem; margin-bottom: var(--fr-s4); }
.table-wrap { overflow: auto; border: 1px solid var(--fr-neutral-800); border-radius: var(--fr-radius-sm); }
table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
caption { padding: var(--fr-s3); color: var(--fr-neutral-300); text-align: left; }
th, td { padding: var(--fr-s2) var(--fr-s3); border-bottom: 1px solid var(--fr-neutral-800); text-align: left; vertical-align: top; }
th { position: sticky; top: 0; background: var(--fr-neutral-950); color: var(--fr-neutral-300); font-size: 0.75rem; font-weight: 650; }
tbody tr:last-child td { border-bottom: 0; }
.cell-title { display: block; color: var(--fr-neutral-100); font-weight: 600; }
.cell-id { display: block; margin-top: var(--fr-s1); color: var(--fr-neutral-300); font-size: 0.6875rem; }
.plan-form { display: grid; grid-template-columns: minmax(0, 1fr) 6rem auto; align-items: end; gap: var(--fr-s2); padding-bottom: var(--fr-s4); border-bottom: 1px solid var(--fr-neutral-800); }
.plan-summary { margin: var(--fr-s4) 0 var(--fr-s2); }
.step-index { width: 1.625rem; height: 1.625rem; display: inline-grid; place-items: center; border-radius: 999px; background: var(--fr-neutral-900); color: var(--fr-neutral-300); font-size: 0.6875rem; }
.step-name { flex: 1 1 auto; font-weight: 650; }
.step-qty { color: var(--fr-harbor-400); }
.step-note { display: flex; align-items: flex-start; gap: var(--fr-s2); color: var(--fr-brass-400) !important; }
.step-note svg { margin-top: 0.1rem; }
.executor {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--fr-s3);
  margin: var(--fr-s4) calc(-1 * var(--fr-s4)) calc(-1 * var(--fr-s4));
  padding: var(--fr-s3) var(--fr-s4);
  border-top: 1px solid var(--fr-neutral-700);
  background: var(--fr-neutral-950);
}
.executor-status { min-width: 0; }
.executor-status strong { display: block; }
.executor-status p { margin: var(--fr-s1) 0 0; overflow: hidden; color: var(--fr-neutral-300); font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
.executor-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--fr-s2); }
.loading-line { height: 0.25rem; overflow: hidden; background: var(--fr-neutral-900); }
.loading-line::after { content: ""; display: block; width: 35%; height: 100%; background: var(--fr-harbor-400); animation: loading 1.2s linear infinite; }
@keyframes loading { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
@media (max-width: 40rem) {
  .panel { width: calc(100vw - (2 * var(--fr-panel-gap))); height: min(78dvh, calc(100dvh - 5rem)); resize: vertical; }
  .items-layout { display: block; }
  .item-browser { height: 48%; border-right: 0; border-bottom: 1px solid var(--fr-neutral-800); }
  .detail { height: 52%; }
  .plan-form { grid-template-columns: minmax(0, 1fr) 5rem; }
  .plan-form .button { grid-column: 1 / -1; }
  .executor { grid-template-columns: 1fr; }
  .executor-actions { justify-content: stretch; }
  .executor-actions .button { flex: 1 1 auto; }
  .skills-view, .plan-view, .detail { padding: var(--fr-s3); }
}
@media (max-width: 22rem) {
  .panel { border-radius: var(--fr-radius-md); }
  .tab { flex: 1 1 0; padding-inline: var(--fr-s2); }
  .toolbar { padding: var(--fr-s2); }
  .launcher-label { max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
`;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function humanizeId(id) {
  return String(id ?? '')
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || 'Unknown';
}

function labelFor(items, id) {
  return items[id]?.label || humanizeId(id);
}

function formatInterval(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}s` : `${value}ms`;
}

function formatChance(chance) {
  const value = Number(chance);
  if (!Number.isFinite(value)) return 'Unknown chance';
  const percentage = value <= 1 ? value * 100 : value;
  return `${percentage.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function quantityEntries(value, items) {
  return Object.entries(value || {})
    .sort(([left], [right]) => labelFor(items, left).localeCompare(labelFor(items, right)))
    .map(([id, qty]) => `${escapeHtml(labelFor(items, id))} <span class="data">×${escapeHtml(qty)}</span>`)
    .join('<br>') || '—';
}

export function buildIndexes(datasets) {
  const sourcesOf = Object.create(null);
  const usesOf = Object.create(null);
  const add = (index, itemId, entry) => {
    (index[itemId] ||= []).push(entry);
  };

  for (const [skillId, actions] of Object.entries(datasets.actions || {})) {
    for (const action of actions || []) {
      for (const [itemId, qty] of Object.entries(action.outputs || {})) {
        add(sourcesOf, itemId, {
          kind: 'action', rare: false, skillId, actionId: action.id,
          actionName: action.name || action.id, levelReq: action.levelReq,
          interval: action.interval, spot: action.spot, qty,
        });
      }
      for (const rare of action.rareOutputs || []) {
        if (!rare?.item) continue;
        add(sourcesOf, rare.item, {
          kind: 'action', rare: true, skillId, actionId: action.id,
          actionName: action.name || action.id, levelReq: action.levelReq,
          interval: action.interval, spot: action.spot, qty: rare.qty,
          chance: rare.chance,
        });
      }
      for (const [itemId, qty] of Object.entries(action.inputs || {})) {
        add(usesOf, itemId, {
          kind: 'action', skillId, actionId: action.id,
          actionName: action.name || action.id, qty,
        });
      }
    }
  }

  for (const building of datasets.buildings || []) {
    for (const upgrade of building.upgrades || []) {
      for (const [itemId, qty] of Object.entries(upgrade.cost || {})) {
        add(usesOf, itemId, {
          kind: 'building', buildingId: building.id,
          buildingName: building.name || building.label || building.id,
          upgradeLevel: upgrade.level, upgradeLabel: upgrade.label, qty,
        });
      }
    }
  }

  const sourceSort = (left, right) =>
    Number(left.rare) - Number(right.rare)
    || String(left.skillId).localeCompare(String(right.skillId))
    || Number(left.levelReq || 0) - Number(right.levelReq || 0)
    || Number(left.interval || 0) - Number(right.interval || 0)
    || String(left.actionName).localeCompare(String(right.actionName));
  const useSort = (left, right) =>
    String(left.kind).localeCompare(String(right.kind))
    || String(left.actionName || left.buildingName).localeCompare(String(right.actionName || right.buildingName));
  for (const values of Object.values(sourcesOf)) values.sort(sourceSort);
  for (const values of Object.values(usesOf)) values.sort(useSort);
  return { sourcesOf, usesOf };
}

export function nextTabIndex(currentIndex, key, count = TAB_IDS.length) {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + count) % count;
  return currentIndex;
}

export async function waitForCompanion(windowRef, options = {}) {
  const pollMs = options.pollMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const delay = options.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += pollMs) {
    if (windowRef.__frCompanion) return windowRef.__frCompanion;
    await delay(pollMs);
  }
  if (windowRef.__frCompanion) return windowRef.__frCompanion;
  throw new Error('The game companion API did not become available within 30 seconds.');
}

export function isExecutionLocked(phase) {
  return phase !== 'idle' && phase !== 'complete' && phase !== 'error';
}

function makeElement(documentRef, tag, attributes = {}) {
  const element = documentRef.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') element.className = value;
    else if (name === 'text') element.textContent = value;
    else if (name === 'html') element.innerHTML = value;
    else element.setAttribute(name, value);
  }
  return element;
}

export function createOverlayShell(documentRef) {
  if (documentRef.getElementById?.(HOST_ID)) return null;
  const host = makeElement(documentRef, 'div', { id: HOST_ID });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = makeElement(documentRef, 'style', { text: CSS });
  const launcher = makeElement(documentRef, 'button', {
    class: 'launcher', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'fr-panel',
    'aria-label': 'Open Fractured Realms Companion', html: `${ICONS.helm}<span class="launcher-label">Companion</span>`,
  });
  launcher.dataset.state = 'loading';

  const panel = makeElement(documentRef, 'section', {
    class: 'panel', id: 'fr-panel', 'aria-label': 'Fractured Realms Companion', tabindex: '-1',
  });
  panel.hidden = true;
  const header = makeElement(documentRef, 'header', { class: 'panel-header' });
  const identity = makeElement(documentRef, 'div', {
    class: 'identity', html: `${ICONS.helm}<strong>Fractured Realms Companion</strong>`,
  });
  const close = makeElement(documentRef, 'button', {
    class: 'icon-button', type: 'button', title: 'Close companion', 'aria-label': 'Close companion', html: ICONS.close,
  });
  header.append(identity, close);

  const loading = makeElement(documentRef, 'div', { class: 'loading-line', 'aria-label': 'Loading companion data' });
  const error = makeElement(documentRef, 'div', { class: 'banner', role: 'alert' });
  error.hidden = true;
  const tabs = makeElement(documentRef, 'div', { class: 'tabs', role: 'tablist', 'aria-label': 'Companion sections' });
  const tabButtons = TAB_IDS.map((tabId, index) => {
    const button = makeElement(documentRef, 'button', {
      class: 'tab', type: 'button', role: 'tab', id: `fr-tab-${tabId}`,
      'aria-controls': `fr-panel-${tabId}`, 'aria-selected': index === 0 ? 'true' : 'false',
      tabindex: index === 0 ? '0' : '-1', text: tabId[0].toUpperCase() + tabId.slice(1),
    });
    tabs.append(button);
    return button;
  });

  const tabpanels = makeElement(documentRef, 'div', { class: 'tabpanels' });
  const panels = Object.fromEntries(TAB_IDS.map((tabId, index) => {
    const region = makeElement(documentRef, 'div', {
      class: 'tabpanel', role: 'tabpanel', id: `fr-panel-${tabId}`,
      'aria-labelledby': `fr-tab-${tabId}`, tabindex: '0',
    });
    region.hidden = index !== 0;
    tabpanels.append(region);
    return [tabId, region];
  }));
  panel.append(header, loading, error, tabs, tabpanels);
  shadow.append(style, launcher, panel);
  documentRef.body.append(host);

  const setOpen = (open, restoreFocus = false) => {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Close Fractured Realms Companion' : 'Open Fractured Realms Companion');
    if (open) tabButtons.find((button) => button.getAttribute('aria-selected') === 'true')?.focus();
    else if (restoreFocus) launcher.focus();
  };
  const selectTab = (index, focus = false) => {
    tabButtons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === index;
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('tabindex', selected ? '0' : '-1');
      panels[TAB_IDS[buttonIndex]].hidden = !selected;
    });
    if (focus) tabButtons[index].focus();
  };
  const showError = (title, message) => {
    loading.hidden = true;
    launcher.dataset.state = 'error';
    launcher.innerHTML = `${ICONS.error}<span class="launcher-label">Companion unavailable</span>`;
    error.innerHTML = `${ICONS.error}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
    error.hidden = false;
    setOpen(true, false);
  };

  launcher.addEventListener('click', () => setOpen(panel.hidden, panel.hidden === false));
  close.addEventListener('click', () => setOpen(false, true));
  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => selectTab(index));
    button.addEventListener('keydown', (event) => {
      const next = nextTabIndex(index, event.key, tabButtons.length);
      if (next === index && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      selectTab(next, true);
    });
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, true);
    }
  });

  return { host, shadow, launcher, panel, loading, error, tabs, tabButtons, panels, setOpen, selectTab, showError };
}

function blockedText(blocked) {
  if (!blocked) return '';
  if (typeof blocked === 'string') return blocked;
  const reason = blocked.reason || blocked.type;
  if (reason === 'level') return `Requires ${blocked.skillName || blocked.skillId || 'skill'} level ${blocked.minLevel ?? blocked.levelReq ?? blocked.level ?? '—'}${blocked.actionName ? ` for ${blocked.actionName}` : ''}.`;
  if (reason === 'tool') return `Unlock ${blocked.toolName || humanizeId(blocked.toolId)} in the Shop before running ${blocked.actionName}.`;
  if (reason === 'pattern') return `Unlock the ${humanizeId(blocked.patternId)} glyph pattern before running ${blocked.actionName}.`;
  if (reason === 'prayer') return `Reach Prayer level ${blocked.minPrayerLevel} before running ${blocked.actionName}.`;
  if (reason === 'map') return `Chart ${humanizeId(blocked.mapId)} before running ${blocked.actionName}.`;
  if (reason === 'recipe') return `Learn the ${blocked.actionName} recipe before running this step.`;
  if (reason === 'bag-full') return 'Free at least one bag slot before running a plan.';
  if (reason === 'rare-only') return `Only available as a rare output${blocked.chances ? ` (${blocked.chances})` : ''}; rare drops are not automated.`;
  if (reason === 'no-source') return 'No deterministic source exists in this game build.';
  if (reason === 'cycle') return `A dependency cycle prevents a safe plan${blocked.itemId ? ` at ${blocked.itemId}` : ''}.`;
  return blocked.message || String(reason || 'This step is blocked.');
}

function createApplication(shell, datasets, api) {
  const indexes = buildIndexes(datasets);
  const items = datasets.items || {};
  const sortedItems = Object.entries(items).sort(([, left], [, right]) =>
    String(left.label || '').localeCompare(String(right.label || '')),
  );
  const skillNames = Object.fromEntries((datasets.skills || []).map((skill) => [skill.id, skill.name || skill.label || skill.id]));
  const state = {
    selectedItemId: null,
    query: '',
    currentPlan: null,
    executorStatus: { phase: 'idle', currentStep: null, message: 'Choose an item and build a plan.' },
  };

  shell.loading.hidden = true;
  shell.launcher.dataset.state = 'ready';
  const executor = createDirectExecutor(api, {
    onUpdate(status) {
      state.executorStatus = status;
      renderExecutor();
    },
  });

  const itemsPanel = shell.panels.items;
  itemsPanel.innerHTML = `
    <div class="items-layout">
      <section class="item-browser" aria-label="Item browser">
        <div class="toolbar"><div class="field grow"><label for="fr-item-search">Search items</label><div class="search-control">${ICONS.search}<input id="fr-item-search" type="search" autocomplete="off" placeholder="Item name"></div></div></div>
        <p class="result-count" id="fr-result-count" aria-live="polite"></p>
        <ul class="item-list" id="fr-item-list"></ul>
      </section>
      <article class="detail" id="fr-item-detail" aria-live="polite"></article>
    </div>`;
  const search = itemsPanel.querySelector('#fr-item-search');
  const resultCount = itemsPanel.querySelector('#fr-result-count');
  const itemList = itemsPanel.querySelector('#fr-item-list');
  const detail = itemsPanel.querySelector('#fr-item-detail');

  function filteredItems() {
    const needle = state.query.trim().toLocaleLowerCase();
    if (!needle) return sortedItems;
    return sortedItems.filter(([id, item]) => `${item.label || ''}\n${id}`.toLocaleLowerCase().includes(needle));
  }

  function renderItemList() {
    const matches = filteredItems();
    const limit = state.query ? SEARCH_LIMIT : LIST_LIMIT;
    const visible = matches.slice(0, limit);
    resultCount.textContent = matches.length > limit
      ? `${matches.length.toLocaleString()} results · showing first ${limit}`
      : `${matches.length.toLocaleString()} ${matches.length === 1 ? 'result' : 'results'}`;
    itemList.innerHTML = visible.length ? visible.map(([id, item]) => `
      <li><button class="item-row" type="button" data-item-id="${escapeHtml(id)}" aria-current="${id === state.selectedItemId}">
        <span>${escapeHtml(item.label || humanizeId(id))}</span>
      </button></li>`).join('') : '<li class="empty">No items match. Try a shorter name.</li>';
  }

  function renderItemDetail() {
    const id = state.selectedItemId;
    const item = id ? items[id] : null;
    if (!item) {
      detail.innerHTML = '<div class="detail-empty">Select an item to inspect its sources, uses, and game data.</div>';
      return;
    }
    const itemSources = indexes.sourcesOf[id] || [];
    const itemUses = indexes.usesOf[id] || [];
    const description = item.desc || datasets.strings?.[`itemdesc.${id}`] || 'No description is available in this build.';
    const sourceRows = itemSources.map((source) => {
      const skill = skillNames[source.skillId] || source.skillId;
      const spot = source.spot ? (datasets.strings?.[`name.${source.spot}`] || source.spot) : null;
      const badge = source.rare
        ? `<span class="badge warning">Rare ${escapeHtml(formatChance(source.chance))}</span>`
        : '<span class="badge signal">Guaranteed</span>';
      return `<li class="record-row"><div class="record-top"><strong>${escapeHtml(source.actionName)}</strong><div class="badges">${badge}<span class="badge">×${escapeHtml(source.qty ?? 1)}</span></div></div><p>${escapeHtml(skill)} level <span class="data">${escapeHtml(source.levelReq ?? 1)}</span> · <span class="data">${escapeHtml(formatInterval(source.interval))}</span>${spot ? ` · ${escapeHtml(spot)}` : ''}</p></li>`;
    }).join('') || '<li class="record-row"><p>No action source is recorded for this item.</p></li>';
    const useRows = itemUses.map((use) => use.kind === 'building'
      ? `<li class="record-row"><div class="record-top"><strong>${escapeHtml(use.buildingName)}</strong><span class="badge">Cost ×${escapeHtml(use.qty)}</span></div><p>${escapeHtml(use.upgradeLabel || `Upgrade level ${use.upgradeLevel ?? '—'}`)}</p></li>`
      : `<li class="record-row"><div class="record-top"><strong>${escapeHtml(use.actionName)}</strong><span class="badge">Input ×${escapeHtml(use.qty)}</span></div><p>${escapeHtml(skillNames[use.skillId] || use.skillId)}</p></li>`).join('') || '<li class="record-row"><p>No action or building upgrade consumes this item.</p></li>';
    detail.innerHTML = `
      <div class="item-heading">
        ${item.art ? `<img class="item-art" src="/art/icons/items/${encodeURIComponent(id)}.png" alt="">` : ''}
        <div><h2>${escapeHtml(item.label || humanizeId(id))}</h2><p class="meta">${escapeHtml(item.type || 'Unknown type')}${item.subtype ? ` / ${escapeHtml(item.subtype)}` : ''}</p></div>
        <button class="button" id="fr-detail-plan" type="button" data-plan-item="${escapeHtml(id)}"${isExecutionLocked(state.executorStatus?.phase) ? ' disabled' : ''}>Plan this item</button>
      </div>
      <p class="prose">${escapeHtml(description)}</p>
      <dl class="facts">
        ${item.value != null ? `<div><dt>Value</dt><dd>${escapeHtml(item.value)}</dd></div>` : ''}
        ${item.healAmount != null ? `<div><dt>Healing</dt><dd>${escapeHtml(item.healAmount)}</dd></div>` : ''}
      </dl>
      <h3>Sources</h3><ul class="record-list">${sourceRows}</ul>
      <h3>Uses</h3><ul class="record-list">${useRows}</ul>`;
  }

  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value;
      renderItemList();
    }, 140);
  });
  itemList.addEventListener('click', (event) => {
    const row = event.target.closest?.('[data-item-id]');
    if (!row) return;
    state.selectedItemId = row.dataset.itemId;
    renderItemList();
    renderItemDetail();
  });
  detail.addEventListener('error', (event) => {
    if (event.target.matches?.('.item-art')) event.target.hidden = true;
  }, true);

  const skillsPanel = shell.panels.skills;
  skillsPanel.innerHTML = `<div class="skills-view"><div class="skills-toolbar field"><label for="fr-skill-select">Skill</label><select class="control" id="fr-skill-select"></select></div><div id="fr-skill-table"></div></div>`;
  const skillSelect = skillsPanel.querySelector('#fr-skill-select');
  const skillTable = skillsPanel.querySelector('#fr-skill-table');
  const actionSkillIds = Object.keys(datasets.actions || {});
  skillSelect.innerHTML = actionSkillIds.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(skillNames[id] || id)}</option>`).join('');

  function renderSkillTable() {
    const skillId = skillSelect.value || actionSkillIds[0];
    const actions = datasets.actions?.[skillId] || [];
    if (!actions.length) {
      skillTable.innerHTML = '<div class="empty">This build has no recorded actions for the selected skill.</div>';
      return;
    }
    skillTable.innerHTML = `<div class="table-wrap"><table><caption>${escapeHtml(skillNames[skillId] || skillId)} actions · ${actions.length.toLocaleString()} total</caption><thead><tr><th scope="col">Action</th><th scope="col">Level</th><th scope="col">Interval</th><th scope="col">Inputs</th><th scope="col">Outputs</th><th scope="col">Tool</th></tr></thead><tbody>${actions.map((action) => {
      const rare = (action.rareOutputs || []).map((entry) => `${escapeHtml(labelFor(items, entry.item))} <span class="data">×${escapeHtml(entry.qty ?? 1)}</span> <span class="badge warning">${escapeHtml(formatChance(entry.chance))}</span>`).join('<br>');
      return `<tr><td><span class="cell-title">${escapeHtml(action.name || humanizeId(action.id))}</span>${action.spot ? `<span class="cell-id">${escapeHtml(datasets.strings?.[`name.${action.spot}`] || humanizeId(action.spot))}</span>` : ''}</td><td class="data">${escapeHtml(action.levelReq)}</td><td class="data">${escapeHtml(formatInterval(action.interval))}</td><td>${quantityEntries(action.inputs, items)}</td><td>${quantityEntries(action.outputs, items)}${rare ? `<br>${rare}` : ''}</td><td>${action.toolReq ? escapeHtml(datasets.strings?.[`name.${action.toolReq}`] || labelFor(items, action.toolReq)) : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  skillSelect.addEventListener('change', renderSkillTable);

  const planPanel = shell.panels.plan;
  planPanel.innerHTML = `
    <div class="plan-view">
      <form class="plan-form" id="fr-plan-form">
        <div class="field"><label for="fr-plan-item">Desired item</label><select class="control" id="fr-plan-item" required></select></div>
        <div class="field"><label for="fr-plan-qty">Quantity</label><input class="control data" id="fr-plan-qty" type="number" min="1" step="1" value="1" inputmode="numeric"></div>
        <button class="button" id="fr-resolve-plan" type="submit">Build plan</button>
      </form>
      <div id="fr-plan-result"><div class="empty">Choose an item and quantity. The planner checks your inventory and skill levels, then lists each required action.</div></div>
      <div class="executor" aria-label="Direct action controls">
        <div class="executor-status" role="status" aria-live="polite" aria-atomic="true"><strong id="fr-executor-phase">Ready</strong><p id="fr-executor-message">Choose an item and build a plan.</p></div>
        <div class="executor-actions"><button class="button primary" id="fr-run" type="button" disabled>${ICONS.play}Run</button><button class="button" id="fr-resume" type="button" hidden>${ICONS.resume}Resume</button><button class="button danger" id="fr-stop" type="button" disabled>${ICONS.stop}Stop</button></div>
      </div>
    </div>`;
  const planForm = planPanel.querySelector('#fr-plan-form');
  const planItem = planPanel.querySelector('#fr-plan-item');
  const planQty = planPanel.querySelector('#fr-plan-qty');
  const planResult = planPanel.querySelector('#fr-plan-result');
  const resolveButton = planPanel.querySelector('#fr-resolve-plan');
  const executorPhase = planPanel.querySelector('#fr-executor-phase');
  const executorMessage = planPanel.querySelector('#fr-executor-message');
  const runButton = planPanel.querySelector('#fr-run');
  const resumeButton = planPanel.querySelector('#fr-resume');
  const stopButton = planPanel.querySelector('#fr-stop');
  planItem.innerHTML = `<option value="">Choose an item</option>${sortedItems.map(([id, item]) => `<option value="${escapeHtml(id)}">${escapeHtml(item.label || humanizeId(id))}</option>`).join('')}`;

  function renderExecutor() {
    const status = state.executorStatus || { phase: 'idle', message: '' };
    const phaseLabels = { idle: 'Ready', starting: 'Starting action', running: 'Running plan', paused: 'Plan paused', complete: 'Plan complete', error: 'Plan stopped' };
    const total = state.currentPlan?.steps?.length || 0;
    const step = Number.isInteger(status.currentStep) ? Number(status.currentStep) + 1 : null;
    const phaseLabel = status.phase === 'idle' && state.currentPlan && !state.currentPlan.ok
      ? 'Blocked'
      : phaseLabels[status.phase] || status.phase;
    executorPhase.textContent = `${phaseLabel}${step && total ? ` · step ${step} of ${total}` : ''}`;
    executorMessage.textContent = status.message || 'Direct actions are idle.';
    const locked = isExecutionLocked(status.phase);
    planItem.disabled = locked;
    planQty.disabled = locked;
    resolveButton.disabled = locked;
    const detailPlanButton = detail.querySelector('#fr-detail-plan');
    if (detailPlanButton) detailPlanButton.disabled = locked;
    runButton.disabled = locked || !state.currentPlan?.ok || !state.currentPlan?.steps?.length;
    resumeButton.hidden = status.phase !== 'paused';
    stopButton.disabled = !locked;
  }

  function renderPlan() {
    const plan = state.currentPlan;
    if (!plan) {
      planResult.innerHTML = '<div class="empty">Choose an item and quantity. The planner checks your inventory and skill levels, then lists each required action.</div>';
      renderExecutor();
      return;
    }
    const steps = plan.steps || [];
    const topBlock = blockedText(plan.blocked || plan.reason);
    const rows = steps.map((step, index) => {
      const block = blockedText(step.blocked);
      const count = Number(step.count);
      const produced = Number(step.produceQty);
      const quantity = count > 0 ? `×${escapeHtml(count)}` : 'Locked';
      const production = produced > 0
        ? `produces ${escapeHtml(labelFor(items, step.produceItemId))} <span class="data">×${escapeHtml(produced)}</span>`
        : `would produce ${escapeHtml(labelFor(items, step.produceItemId))}`;
      return `<li class="plan-step"><div class="step-top"><span class="step-index data">${index + 1}</span><span class="step-name">${escapeHtml(step.actionName || humanizeId(step.actionId))}</span><span class="step-qty data">${quantity}</span></div><p>${escapeHtml(skillNames[step.skillId] || humanizeId(step.skillId))} · ${production}</p>${block ? `<p class="step-note">${ICONS.error}<span>${escapeHtml(block)}</span></p>` : ''}</li>`;
    }).join('');
    planResult.innerHTML = `<div class="plan-summary"><strong>${plan.ok ? `${steps.length} ${steps.length === 1 ? 'action' : 'actions'} resolved` : 'Plan blocked'}</strong>${topBlock && !rows ? `<p class="step-note">${ICONS.error}<span>${escapeHtml(topBlock)}</span></p>` : ''}</div>${rows ? `<ol class="plan-list">${rows}</ol>` : '<div class="empty">No executable steps were produced. Current inventory may already satisfy the request.</div>'}`;
    renderExecutor();
  }

  planForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isExecutionLocked(state.executorStatus?.phase)) return;
    const qty = Math.max(1, Math.trunc(Number(planQty.value) || 1));
    planQty.value = String(qty);
    try {
      state.currentPlan = createPlan(datasets, api.getState(), { itemId: planItem.value, qty });
      state.executorStatus = { phase: 'idle', currentStep: null, message: state.currentPlan.ok ? 'Plan ready. Review the dependency order, then run.' : 'Resolve the blockers before running.' };
    } catch (error) {
      state.currentPlan = { ok: false, steps: [], reason: error instanceof Error ? error.message : String(error) };
      state.executorStatus = { phase: 'error', currentStep: null, message: 'The plan could not be resolved.' };
    }
    renderPlan();
  });
  runButton.addEventListener('click', () => {
    if (isExecutionLocked(state.executorStatus?.phase)) return;
    if (state.currentPlan?.ok) executor.run(state.currentPlan.steps);
  });
  resumeButton.addEventListener('click', () => executor.resume());
  stopButton.addEventListener('click', () => {
    executor.stop();
    state.currentPlan = null;
    renderPlan();
  });
  detail.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-plan-item]');
    if (!target || isExecutionLocked(state.executorStatus?.phase)) return;
    planItem.value = target.dataset.planItem;
    shell.selectTab(2, true);
  });

  renderItemList();
  renderItemDetail();
  renderSkillTable();
  renderExecutor();
  return { datasets, indexes, state, executor, renderItemList, renderItemDetail, renderSkillTable, renderPlan };
}

export async function fetchDatasets(fetchRef) {
  const entries = await Promise.all(DATA_FILES.map(async ([key, filename]) => {
    const response = await fetchRef(`/companion/data/${filename}`);
    if (!response?.ok) throw new Error(`${filename} returned HTTP ${response?.status ?? 'unknown'}`);
    try {
      return [key, await response.json()];
    } catch (error) {
      throw new Error(`${filename} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  return Object.fromEntries(entries);
}

export async function bootOverlay(options = {}) {
  const documentRef = options.document || globalThis.document;
  const windowRef = options.window || globalThis.window;
  const fetchRef = options.fetch || globalThis.fetch;
  if (!documentRef?.body || !windowRef || !fetchRef) return { shell: null, app: null };
  const existing = documentRef.getElementById?.(HOST_ID);
  if (existing) return { shell: null, app: null, existing };
  const shell = createOverlayShell(documentRef);
  try {
    const api = await waitForCompanion(windowRef, options.poll);
    const datasets = await fetchDatasets(fetchRef);
    const app = createApplication(shell, datasets, api);
    return { shell, app, api, datasets };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = message.includes('did not become available');
    shell.showError(timeout ? 'Companion connection timed out' : 'Companion data could not load', message);
    return { shell, app: null, api: null, error };
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  queueMicrotask(() => { void bootOverlay(); });
}
