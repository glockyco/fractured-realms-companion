import { actionBlocker, createPlan } from './planner.js';
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
const POSITION_STORAGE_KEY = 'fractured-realms-companion.positions.v1';
const QUEUE_STORAGE_KEY = 'fractured-realms-companion.queue.v1';
const TAB_IDS = Object.freeze(['items', 'skills', 'plan']);
const LIST_LIMIT = 120;
const SEARCH_LIMIT = 240;

const ICONS = Object.freeze({
  helm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V9.8a8 8 0 0 1 16 0v7.7M7 18v-7a5 5 0 0 1 10 0v7M3 18h18M9 18v3m6-3v3"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4m11 11v-5h5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 5 10 7-10 7Z"/><path d="M4 5v14"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4ZM12 9v5m0 3v.1"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m13.5 6.5 3 3"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="m6 7 1 13h10l1-13"/></svg>',
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
  --fr-z-dropdown: 2147483001;
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
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
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
.launcher[data-dragging="true"] { cursor: grabbing; transform: none; transition: none; }
.launcher[data-state="error"] { border-color: var(--fr-danger-400); color: var(--fr-danger-400); }
.launcher[data-state="ready"] svg { color: var(--fr-harbor-400); }
.panel {
  position: fixed;
  z-index: var(--fr-z-overlay);
  inset: auto var(--fr-panel-gap) var(--fr-launcher-offset) auto;
  width: min(var(--fr-panel-width), calc(100vw - (2 * var(--fr-panel-gap))));
  height: min(var(--fr-panel-height), calc(100dvh - 5rem));
  min-width: min(var(--fr-panel-min), calc(100vw - (2 * var(--fr-panel-gap))));
  min-height: min(20rem, calc(100dvh - 1rem));
  max-width: calc(100vw - (2 * var(--fr-panel-gap)));
  max-height: calc(100dvh - 1rem);
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
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
.panel-drag-handle { flex: 1 1 auto; cursor: grab; touch-action: none; user-select: none; }
.panel[data-dragging="true"] { transition: none; }
.panel[data-dragging="true"] .panel-drag-handle { cursor: grabbing; }
.identity svg { color: var(--fr-harbor-400); width: var(--fr-icon-lg); height: var(--fr-icon-lg); }
.identity strong { min-width: 0; overflow: hidden; font-size: 0.9375rem; font-weight: 650; letter-spacing: -0.01em; text-overflow: ellipsis; white-space: nowrap; }
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
.tab-actions { display: flex; gap: var(--fr-s1); align-items: center; margin-left: auto; padding-bottom: 2px; }
.icon-button.accent:not(:disabled) { color: var(--fr-harbor-400); }
.icon-button.danger:not(:disabled) { color: var(--fr-danger-400); }
.icon-button.attention { color: var(--fr-harbor-400); animation: attention 1.6s ease-in-out infinite; }
@keyframes attention { 50% { transform: scale(1.15); } }
.banner {
  display: flex;
  align-items: flex-start;
  gap: var(--fr-s2);
  padding: var(--fr-s3) var(--fr-s4);
  border-bottom: 1px solid var(--fr-danger-400);
  background: var(--fr-danger-950);
  color: var(--fr-danger-400);
}
.banner.success { border-color: var(--fr-success-400); background: var(--fr-success-950); color: var(--fr-success-400); }
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
#fr-panel-items { overflow: hidden; }
.items-layout { height: 100%; min-height: 0; display: grid; grid-template-columns: minmax(13rem, 0.8fr) minmax(0, 1.35fr); }
.items-layout > * { min-height: 0; }
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
.plan-combobox { min-width: 0; }
.combobox-popover {
  position: fixed;
  z-index: var(--fr-z-dropdown);
  margin: 0;
  padding: var(--fr-s1);
  overflow: auto;
  border: 1px solid var(--fr-neutral-700);
  border-radius: var(--fr-radius-md);
  background: var(--fr-neutral-950);
  box-shadow: 0 var(--fr-s3) var(--fr-s8) oklch(0 0 0 / 0.5);
}
.combobox-option {
  width: 100%;
  min-height: var(--fr-row-min);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fr-s3);
  padding: var(--fr-s2);
  border-radius: var(--fr-radius-sm);
  background: transparent;
  color: var(--fr-neutral-100);
  text-align: left;
  cursor: pointer;
}
.combobox-option:hover, .combobox-option[aria-selected="true"] { background: var(--fr-harbor-950); }
.combobox-option strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.combobox-option small { flex: 0 0 auto; color: var(--fr-neutral-300); font-size: 0.6875rem; }
.combobox-empty { padding: var(--fr-s3); color: var(--fr-neutral-300); text-align: center; }
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
.item-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--fr-s3); }
.item-heading.has-art { grid-template-columns: auto minmax(0, 1fr) auto; }
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
.button.compact { min-height: 1.875rem; padding-inline: var(--fr-s2); font-size: 0.75rem; }
.button.primary { border-color: var(--fr-harbor-600); background: var(--fr-harbor-600); color: var(--fr-neutral-100); }
.button.primary:hover { border-color: var(--fr-harbor-400); background: var(--fr-harbor-800); }
.button.danger { border-color: var(--fr-danger-400); background: var(--fr-danger-950); color: var(--fr-danger-400); }
.button:disabled, .icon-button:disabled, .control:disabled { cursor: not-allowed; opacity: 0.48; }
.button:focus-visible, .icon-button:focus-visible, .launcher:focus-visible, .tab:focus-visible, .control:focus-visible, .search-control:focus-within, .item-row:focus-visible {
  outline: 2px solid var(--fr-harbor-400);
  outline-offset: 2px;
}
.skills-view, .plan-view { padding: var(--fr-s4); }
.skills-toolbar { max-width: 24rem; margin-bottom: var(--fr-s2); }
.skill-action-status { min-height: 1.25rem; margin: 0 0 var(--fr-s3); color: var(--fr-neutral-300); font-size: 0.75rem; }
.skill-action-status[data-state="error"] { color: var(--fr-brass-400); }
.table-wrap { overflow: auto; border: 1px solid var(--fr-neutral-800); border-radius: var(--fr-radius-sm); }
.table-wrap table { min-width: 44rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
caption { padding: var(--fr-s3); color: var(--fr-neutral-300); text-align: left; }
th, td { padding: var(--fr-s2) var(--fr-s3); border-bottom: 1px solid var(--fr-neutral-800); text-align: left; vertical-align: top; }
th { position: sticky; top: 0; background: var(--fr-neutral-950); color: var(--fr-neutral-300); font-size: 0.75rem; font-weight: 650; }
tbody tr:last-child td { border-bottom: 0; }
.cell-title { display: block; color: var(--fr-neutral-100); font-weight: 600; }
.cell-id { display: block; margin-top: var(--fr-s1); color: var(--fr-neutral-300); font-size: 0.6875rem; }
.plan-form { display: grid; grid-template-columns: minmax(0, 1fr) 6rem auto; align-items: end; gap: var(--fr-s2); padding-bottom: var(--fr-s4); border-bottom: 1px solid var(--fr-neutral-800); }
.plan-summary { display: flex; align-items: center; justify-content: space-between; gap: var(--fr-s3); margin: var(--fr-s4) 0 var(--fr-s2); }
.plan-summary p { margin: var(--fr-s1) 0 0; color: var(--fr-neutral-300); }
.step-index { width: 1.625rem; height: 1.625rem; display: inline-grid; place-items: center; border-radius: 999px; background: var(--fr-neutral-900); color: var(--fr-neutral-300); font-size: 0.6875rem; }
.step-name { flex: 1 1 auto; font-weight: 650; }
.step-qty { color: var(--fr-harbor-400); }
.step-note { display: flex; align-items: flex-start; gap: var(--fr-s2); color: var(--fr-brass-400) !important; }
.step-note svg { margin-top: 0.1rem; }
.queue-header { display: flex; align-items: center; justify-content: space-between; gap: var(--fr-s3); margin-top: var(--fr-s5); }
.queue-header h3 { margin: 0; }
.queue-total { color: var(--fr-neutral-300); font-size: 0.75rem; white-space: normal; text-align: right; }
.queue-list { margin: var(--fr-s2) 0 0; padding: 0; list-style: none; border-top: 1px solid var(--fr-neutral-700); }
.queue-plan { padding: var(--fr-s3) 0; border-bottom: 1px solid var(--fr-neutral-700); }
.queue-plan[data-state="active"] { background: var(--fr-harbor-950); margin-inline: calc(-1 * var(--fr-s2)); padding-inline: var(--fr-s2); }
.queue-plan[data-state="complete"] .queue-plan-title { color: var(--fr-success-400); }
.queue-plan-top { display: flex; align-items: center; gap: var(--fr-s2); }
.queue-plan-index { color: var(--fr-neutral-300); font-size: 0.75rem; }
.queue-plan-title { min-width: 0; flex: 1 1 auto; overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.queue-plan-meta { color: var(--fr-neutral-300); font-size: 0.75rem; white-space: nowrap; }
.queue-plan-actions { display: flex; gap: var(--fr-s1); }
.queue-plan-actions .icon-button { width: 1.875rem; height: 1.875rem; }
.queue-steps { margin: var(--fr-s2) 0 0 1.625rem; padding: 0; list-style: none; }
.queue-step { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr) auto; align-items: center; gap: var(--fr-s2); min-height: 2rem; color: var(--fr-neutral-300); font-size: 0.75rem; }
.queue-step[data-state="active"] { color: var(--fr-neutral-100); }
.queue-step[data-state="complete"] { color: var(--fr-success-400); }
.queue-step[data-kind="prerequisite"] { color: var(--fr-success-400); }
.queue-step[data-kind="prerequisite"] .queue-step-marker { border-color: var(--fr-success-400); background: var(--fr-success-950); }
.queue-step-detail { display: block; color: var(--fr-neutral-300); font-size: 0.6875rem; }
.queue-step-marker { width: 1.125rem; height: 1.125rem; display: inline-grid; place-items: center; border: 1px solid var(--fr-neutral-700); border-radius: 999px; font-size: 0.625rem; }
.queue-step[data-state="active"] .queue-step-marker { border-color: var(--fr-harbor-400); background: var(--fr-harbor-800); }
.queue-step[data-state="complete"] .queue-step-marker { border-color: var(--fr-success-400); background: var(--fr-success-950); }
.queue-step-time { white-space: nowrap; }
.step-progress { grid-column: 2 / -1; width: 100%; height: 0.375rem; overflow: hidden; border: 0; border-radius: 999px; background: var(--fr-neutral-800); accent-color: var(--fr-harbor-400); }
.step-progress::-webkit-progress-bar { background: var(--fr-neutral-800); }
.step-progress::-webkit-progress-value { background: var(--fr-harbor-400); }
.executor-progress { width: 100%; height: 0.375rem; margin-top: var(--fr-s2); overflow: hidden; border: 0; border-radius: 999px; background: var(--fr-neutral-800); accent-color: var(--fr-harbor-400); }
.executor-progress::-webkit-progress-bar { background: var(--fr-neutral-800); }
.executor-progress::-webkit-progress-value { background: var(--fr-harbor-400); }
.executor {
  position: sticky;
  bottom: 0;
  margin: var(--fr-s4) calc(-1 * var(--fr-s4)) calc(-1 * var(--fr-s4));
  padding: var(--fr-s3) var(--fr-s4);
  border-top: 1px solid var(--fr-neutral-700);
  background: var(--fr-neutral-950);
}
.executor-status { min-width: 0; }
.executor-status strong { display: block; }
.executor-status p { display: flex; align-items: baseline; min-width: 0; gap: 0.35ch; margin: var(--fr-s1) 0 0; color: var(--fr-neutral-300); font-size: 0.75rem; }
.exec-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exec-meta { flex: 0 0 auto; white-space: nowrap; }
.loading-line { height: 0.25rem; overflow: hidden; background: var(--fr-neutral-900); }
.compact-strip { display: none; }
.panel[data-compact="true"] {
  width: min(22rem, calc(100vw - 1rem));
  height: auto;
  min-height: 0;
  resize: none;
  grid-template-rows: auto auto;
}
.panel[data-compact="true"] .tabs,
.panel[data-compact="true"] .tabpanels,
.panel[data-compact="true"] .loading-line { display: none; }
.panel[data-compact="true"] .compact-strip {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--fr-s1) var(--fr-s2);
  padding: var(--fr-s3) var(--fr-s4);
}
.panel[data-compact="true"] .compact-strip > #fr-compact-phase { grid-column: 1; grid-row: 1; }
.panel[data-compact="true"] .compact-strip > #fr-compact-message { grid-column: 1; grid-row: 2; min-width: 0; }
.panel[data-compact="true"] .compact-strip > #fr-compact-progress { grid-column: 1 / -1; grid-row: 3; }
.panel[data-compact="true"] .compact-strip > .compact-actions { grid-column: 2; grid-row: 1 / 3; display: flex; gap: var(--fr-s1); align-items: center; }
.panel[data-compact="true"] .compact-strip p { display: flex; align-items: baseline; min-width: 0; gap: 0.35ch; margin: 0; overflow: hidden; color: var(--fr-neutral-300); font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
.loading-line::after { content: ""; display: block; width: 35%; height: 100%; background: var(--fr-harbor-400); animation: loading 1.2s linear infinite; }
@keyframes loading { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
@media (max-width: 40rem) {
  .panel { width: calc(100vw - (2 * var(--fr-panel-gap))); height: min(78dvh, calc(100dvh - 5rem)); resize: vertical; }
  .queue-plan-top { flex-wrap: wrap; }
  .queue-plan-actions { margin-left: 1.625rem; }
  .items-layout { display: block; }
  .item-browser { height: 48%; border-right: 0; border-bottom: 1px solid var(--fr-neutral-800); }
  .detail { height: 52%; }
  .plan-form { grid-template-columns: minmax(0, 1fr) 5rem; }
  .plan-form .button { grid-column: 1 / -1; }
  .skills-view, .plan-view, .detail { padding: var(--fr-s3); }
}
@media (max-width: 22rem) {
  .panel { border-radius: var(--fr-radius-md); }
  .tab { flex: 1 1 0; padding-inline: var(--fr-s2); }
  .tab-actions { flex: 0 0 auto; }
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

export function searchPlanTargets(itemEntries, query = '', priorityIds = [], limit = 10) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  const priorities = new Map(priorityIds.map((id, index) => [id, index]));
  const matchRank = (label) => {
    const normalized = String(label).toLocaleLowerCase();
    if (!normalizedQuery) return 0;
    if (normalized.startsWith(normalizedQuery)) return 0;
    if (normalized.split(/\s+/u).some((word) => word.startsWith(normalizedQuery))) return 1;
    return normalized.includes(normalizedQuery) ? 2 : Number.POSITIVE_INFINITY;
  };
  return itemEntries
    .map(([id, item]) => ({ id, item, label: item?.label || humanizeId(id), match: matchRank(item?.label || humanizeId(id)) }))
    .filter((entry) => Number.isFinite(entry.match))
    .sort((left, right) => {
      if (left.match !== right.match) return left.match - right.match;
      const leftPriority = priorities.get(left.id) ?? Number.POSITIVE_INFINITY;
      const rightPriority = priorities.get(right.id) ?? Number.POSITIVE_INFINITY;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatFinishTime(remainingMs, now = Date.now()) {
  return new Date(now + Math.max(0, Number(remainingMs) || 0)).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function estimatePlanDuration(plan) {
  return (plan?.steps || []).reduce((total, step) => {
    const interval = Math.max(0, Number(step.interval) || 0);
    const count = Math.max(0, Number(step.count) || 0);
    return total + interval * count;
  }, 0);
}

export function projectSteps(datasets, snapshot, steps) {
  const projected = {
    ...(snapshot || {}),
    inventory: { ...(snapshot?.inventory || {}) },
  };
  const actionById = new Map();
  for (const [skillId, actions] of Object.entries(datasets.actions || {})) {
    for (const action of actions || []) actionById.set(`${skillId}:${action.id}`, action);
  }
  for (const step of steps || []) {
    const action = actionById.get(`${step.skillId}:${step.actionId}`);
    const count = Math.max(0, Number(step.count) || 0);
    if (action && count) {
      for (const [itemId, qty] of Object.entries(action.inputs || {})) {
        projected.inventory[itemId] = Math.max(0, (Number(projected.inventory[itemId]) || 0) - (Number(qty) || 0) * count);
      }
      for (const [itemId, qty] of Object.entries(action.outputs || {})) {
        projected.inventory[itemId] = Math.max(0, (Number(projected.inventory[itemId]) || 0) + (Number(qty) || 0) * count);
      }
    }
    if (step.rare && step.produceItemId) {
      projected.inventory[step.produceItemId] = Math.max(0, (Number(projected.inventory[step.produceItemId]) || 0) + Math.max(0, Number(step.produceQty) || 0));
    }
  }
  return projected;
}

export function projectPlanState(datasets, snapshot, plans) {
  return projectSteps(datasets, snapshot, (plans || []).filter((plan) => plan?.ok).flatMap((plan) => plan.steps || []));
}

export function resolvePlanQueue(datasets, snapshot, goals) {
  const queue = [];
  let projected = projectPlanState(datasets, snapshot, []);
  for (const goal of goals || []) {
    const plan = createPlan(datasets, projected, { itemId: goal.itemId, qty: goal.qty });
    const entry = { ...goal, plan, estimateMs: estimatePlanDuration(plan) };
    queue.push(entry);
    projected = projectPlanState(datasets, projected, [plan]);
  }
  return queue;
}

export function clampFloatingPosition(position, size, viewport, gutter = 8, minVisible = 56) {
  const width = Math.max(0, Number(size?.width) || 0);
  const height = Math.max(0, Number(size?.height) || 0);
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  // Keep at least a grabbable sliver on screen so the window can be tucked aside
  // without getting lost, and keep the top edge reachable so its drag handle stays usable.
  const keepX = Math.min(Math.max(0, Number(minVisible) || 0), width || Math.max(0, Number(minVisible) || 0));
  const keepY = Math.min(Math.max(0, Number(minVisible) || 0), height || Math.max(0, Number(minVisible) || 0));
  const minLeft = keepX - width;
  const maxLeft = Math.max(minLeft, viewportWidth - keepX);
  const minTop = gutter;
  const maxTop = Math.max(minTop, viewportHeight - keepY);
  return {
    left: Math.max(minLeft, Math.min(Number(position?.left) || 0, maxLeft)),
    top: Math.max(minTop, Math.min(Number(position?.top) || 0, maxTop)),
  };
}

export function fitWithinViewport(position, size, viewport, gutter = 8) {
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  // Cap the window to the viewport size independently of where it sits, so a window
  // dragged partly off an edge keeps its size instead of collapsing.
  const maxWidth = Math.max(0, viewportWidth - 2 * gutter);
  const maxHeight = Math.max(0, viewportHeight - 2 * gutter);
  const width = Math.min(Math.max(0, Number(size?.width) || 0), maxWidth);
  const height = Math.min(Math.max(0, Number(size?.height) || 0), maxHeight);
  const { left, top } = clampFloatingPosition(position, { width, height }, viewport, gutter);
  return { left, top, maxWidth, maxHeight };
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

function enableFloatingDrag(documentRef, element, handle, onPosition, onMove) {
  let drag = null;
  let suppressClick = false;
  const viewport = () => ({
    width: Number(documentRef.defaultView?.innerWidth) || Number(globalThis.innerWidth) || 1024,
    height: Number(documentRef.defaultView?.innerHeight) || Number(globalThis.innerHeight) || 768,
  });
  const move = (event) => {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const left = drag.left + (Number(event.clientX) - drag.clientX);
    const top = drag.top + (Number(event.clientY) - drag.clientY);
    const rect = element.getBoundingClientRect();
    const position = clampFloatingPosition({ left, top }, rect, viewport());
    const distance = Math.hypot(Number(event.clientX) - drag.clientX, Number(event.clientY) - drag.clientY);
    if (distance > 4) drag.moved = true;
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    onMove?.();
  };
  const end = (event) => {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const moved = drag.moved;
    drag = null;
    element.dataset.dragging = 'false';
    try { handle.releasePointerCapture?.(event.pointerId); } catch { /* capture may already be released */ }
    if (!moved) return;
    suppressClick = true;
    onPosition({ left: Number.parseFloat(element.style.left) || 0, top: Number.parseFloat(element.style.top) || 0 });
  };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      clientX: Number(event.clientX) || 0,
      clientY: Number(event.clientY) || 0,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    element.dataset.dragging = 'true';
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* pointer capture is optional in embedded browsers */ }
    event.preventDefault?.();
  });
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  return {
    consumeClick() {
      if (!suppressClick) return false;
      suppressClick = false;
      return true;
    },
  };
}

export function createOverlayShell(documentRef) {
  if (documentRef.getElementById?.(HOST_ID)) return null;
  const host = makeElement(documentRef, 'div', { id: HOST_ID });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = makeElement(documentRef, 'style', { text: CSS });
  const launcher = makeElement(documentRef, 'button', {
    class: 'launcher', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'fr-panel',
    'aria-label': 'Open Fractured Realms Companion', html: `${ICONS.helm}<span class="launcher-label" id="fr-launcher-label">Companion</span>`,
  });
  launcher.dataset.state = 'loading';

  const panel = makeElement(documentRef, 'section', {
    class: 'panel', id: 'fr-panel', 'aria-label': 'Fractured Realms Companion', tabindex: '-1',
  });
  panel.hidden = true;
  const header = makeElement(documentRef, 'header', { class: 'panel-header' });
  const identity = makeElement(documentRef, 'div', {
    class: 'identity panel-drag-handle',
    html: `${ICONS.helm}<strong>Fractured Realms Companion</strong>`,
  });
  const compactToggle = makeElement(documentRef, 'button', {
    class: 'icon-button', type: 'button', id: 'fr-compact-toggle', 'aria-pressed': 'false',
    title: 'Compact mode', 'aria-label': 'Compact mode', html: ICONS.collapse,
  });
  const close = makeElement(documentRef, 'button', {
    class: 'icon-button', type: 'button', title: 'Close companion', 'aria-label': 'Close companion', html: ICONS.close,
  });
  header.append(identity, compactToggle, close);

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

  const queueControls = makeElement(documentRef, 'div', {
    class: 'tab-actions', role: 'group', 'aria-label': 'Queue controls',
    html: `<button class="icon-button accent" id="fr-run" type="button" title="Start queue — stops your current game action" aria-label="Start queue" disabled>${ICONS.play}</button>`
      + `<button class="icon-button" id="fr-resume" type="button" title="Resume queue" aria-label="Resume queue" hidden>${ICONS.resume}</button>`
      + `<button class="icon-button danger" id="fr-stop" type="button" title="Stop queue" aria-label="Stop queue" disabled>${ICONS.stop}</button>`
      + `<button class="icon-button" id="fr-clear" type="button" title="Clear queue" aria-label="Clear queue" disabled>${ICONS.clear}</button>`,
  });
  tabs.append(queueControls);
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
  const compactStrip = makeElement(documentRef, 'div', {
    class: 'compact-strip',
    html: '<strong id="fr-compact-phase"></strong><p id="fr-compact-message"></p><progress class="executor-progress" id="fr-compact-progress" max="1" value="0"></progress><div class="compact-actions"><button class="icon-button accent" id="fr-compact-start" type="button" title="Start queue" aria-label="Start queue" hidden>' + ICONS.play + '</button><button class="icon-button" id="fr-compact-resume" type="button" title="Resume queue" aria-label="Resume queue" hidden>' + ICONS.resume + '</button><button class="icon-button danger" id="fr-compact-stop" type="button" title="Stop queue" aria-label="Stop queue">' + ICONS.stop + '</button></div>',
  });
  panel.append(header, loading, error, tabs, tabpanels, compactStrip);
  shadow.append(style, launcher, panel);
  documentRef.body.append(host);

  const view = documentRef.defaultView || globalThis.window;
  const storage = view?.localStorage;
  let positions = {};
  try { positions = JSON.parse(storage?.getItem(POSITION_STORAGE_KEY) || '{}') || {}; } catch { positions = {}; }
  const viewport = () => ({
    width: Number(view?.innerWidth) || Number(globalThis.innerWidth) || 1024,
    height: Number(view?.innerHeight) || Number(globalThis.innerHeight) || 768,
  });
  const applyPosition = (element, position) => {
    if (!position) return;
    const rect = element.getBoundingClientRect();
    const next = clampFloatingPosition(position, rect, viewport());
    element.style.left = `${next.left}px`;
    element.style.top = `${next.top}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
  };
  const fitPanel = () => {
    if (panel.hidden) return;
    const rect = panel.getBoundingClientRect();
    const hasInlinePosition = Boolean(panel.style.left || panel.style.top);
    const left = hasInlinePosition ? Number.parseFloat(panel.style.left) : rect.left;
    const top = hasInlinePosition ? Number.parseFloat(panel.style.top) : rect.top;
    const fitted = fitWithinViewport(
      { left: Number.isFinite(left) ? left : rect.left, top: Number.isFinite(top) ? top : rect.top },
      rect,
      viewport(),
    );
    if (hasInlinePosition) {
      panel.style.left = `${fitted.left}px`;
      panel.style.top = `${fitted.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
    panel.style.maxWidth = `${fitted.maxWidth}px`;
    panel.style.maxHeight = `${fitted.maxHeight}px`;
  };
  const savePosition = (key, position) => {
    positions = { ...positions, [key]: position };
    try { storage?.setItem(POSITION_STORAGE_KEY, JSON.stringify(positions)); } catch { /* persistence is optional */ }
  };
  applyPosition(launcher, positions.launcher);
  panel.dataset.compact = positions.compactMode === true ? 'true' : 'false';
  compactToggle.setAttribute('aria-pressed', panel.dataset.compact === 'true' ? 'true' : 'false');
  const launcherDrag = enableFloatingDrag(documentRef, launcher, launcher, (position) => savePosition('launcher', position));
  enableFloatingDrag(documentRef, panel, identity, (position) => savePosition('panel', position), fitPanel);

  let expandedSize = null;
  const setCompact = (compact) => {
    const enabled = Boolean(compact);
    if (enabled) {
      // A manual resize leaves inline width/height on the panel, and inline styles
      // outrank the .panel[data-compact] stylesheet rule, so clear them (remembering
      // the expanded size) to let compact mode shrink the box.
      if (panel.dataset.compact !== 'true') {
        expandedSize = { width: panel.style.width, height: panel.style.height };
      }
      panel.style.width = '';
      panel.style.height = '';
    } else if (expandedSize) {
      panel.style.width = expandedSize.width;
      panel.style.height = expandedSize.height;
    }
    panel.dataset.compact = String(enabled);
    compactToggle.setAttribute('aria-pressed', String(enabled));
    savePosition('compactMode', enabled);
    fitPanel();
  };
  compactToggle.addEventListener('click', () => setCompact(panel.dataset.compact !== 'true'));
  const setOpen = (open, restoreFocus = false) => {
    panel.hidden = !open;
    if (open) {
      applyPosition(panel, positions.panel);
      fitPanel();
    }
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
    launcher.innerHTML = `${ICONS.error}<span class="launcher-label" id="fr-launcher-label">Companion unavailable</span>`;
    error.innerHTML = `${ICONS.error}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
    error.hidden = false;
    setOpen(true, false);
  };

  launcher.addEventListener('click', () => {
    if (launcherDrag.consumeClick()) return;
    setOpen(panel.hidden, panel.hidden === false);
  });
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

  view?.addEventListener?.('resize', () => {
    const launcherRect = launcher.getBoundingClientRect();
    applyPosition(launcher, { left: launcherRect.left, top: launcherRect.top });
    if (!panel.hidden) fitPanel();
  });

  return { host, shadow, launcher, panel, header, identity, compactToggle, compactStrip, close, loading, error, tabs, tabButtons, queueControls, panels, setOpen, setCompact, selectTab, showError };
}

function blockedText(blocked) {
  if (!blocked) return '';
  if (typeof blocked === 'string') return blocked;
  const reason = blocked.reason || blocked.type;
  if (reason === 'level') return `Requires ${blocked.skillName || blocked.skillId || 'skill'} level ${blocked.minLevel ?? blocked.levelReq ?? blocked.level ?? '—'}${blocked.actionName ? ` for ${blocked.actionName}` : ''}.`;
  if (reason === 'tool') return `Unlock ${blocked.toolName || humanizeId(blocked.toolId)} in the Shop${blocked.actionName ? ` before running ${blocked.actionName}` : ''}.`;
  if (reason === 'pattern') return `Unlock the ${humanizeId(blocked.patternId)} glyph pattern${blocked.actionName ? ` before running ${blocked.actionName}` : ''}.`;
  if (reason === 'prayer') return `Reach Prayer level ${blocked.minPrayerLevel} before running ${blocked.actionName}.`;
  if (reason === 'map') return `Chart ${humanizeId(blocked.mapId)}${blocked.actionName ? ` before running ${blocked.actionName}` : ''}.`;
  if (reason === 'recipe') return `Learn the ${blocked.actionName || 'required'} recipe before running this step.`;
  if (reason === 'bag-full') return 'Free at least one bag slot before running an action.';
  if (reason === 'input') return `Requires ${blocked.required} ${humanizeId(blocked.itemId)} in the bag; ${blocked.available} available.`;
  if (reason === 'rare-only') return `Only available as a rare drop${Array.isArray(blocked.chances) && blocked.chances.length ? ` (${blocked.chances.map((chance) => formatChance(chance.chance)).join(', ')})` : ''}.`;
  if (reason === 'no-source') return 'No deterministic source exists in this game build.';
  if (reason === 'cycle') return `A dependency cycle prevents a safe plan${blocked.itemId ? ` at ${blocked.itemId}` : ''}.`;
  return blocked.message || String(reason || 'This step is blocked.');
}

function createApplication(shell, datasets, api) {
  const documentRef = shell.panel.ownerDocument;
  const indexes = buildIndexes(datasets);
  const items = datasets.items || {};
  const sortedItems = Object.entries(items).sort(([, left], [, right]) =>
    String(left.label || '').localeCompare(String(right.label || '')),
  );
  const skillNames = Object.fromEntries((datasets.skills || []).map((skill) => [skill.id, skill.name || skill.label || skill.id]));
  const state = {
    selectedItemId: null,
    planItemId: '',
    recentPlanItemIds: [],
    query: '',
    currentPlan: null,
    planNotice: null,
    queueGoals: [],
    planQueue: [],
    executionSteps: [],
    nextPlanId: 1,
    executorStatus: { phase: 'idle', currentStep: null, message: 'Add one or more plans to the queue.' },
  };

  const storage = shell.panel.ownerDocument.defaultView?.localStorage;
  const persistQueue = () => {
    try {
      storage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ goals: state.queueGoals, nextPlanId: state.nextPlanId }));
    } catch { /* persistence is optional */ }
  };
  const restoreQueue = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(QUEUE_STORAGE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.goals)) return false;
      const goals = parsed.goals;
      if (!goals.every((goal) => goal && typeof goal === 'object' && typeof goal.id === 'string'
        && Object.prototype.hasOwnProperty.call(items, goal.itemId) && Number.isInteger(goal.qty) && goal.qty >= 1)) return false;
      const maxGoalId = goals.reduce((max, goal) => {
        const match = /^plan-(\d+)$/u.exec(goal.id);
        return Math.max(max, match ? Number(match[1]) || 0 : 0);
      }, 0);
      state.queueGoals = goals.map((goal) => ({ id: goal.id, itemId: goal.itemId, qty: goal.qty }));
      state.nextPlanId = Math.max(Number(parsed.nextPlanId) || 0, maxGoalId + 1);
      rebuildQueue();
      state.executorStatus.message = `Restored ${goals.length} queued plan(s).`;
      return true;
    } catch { return false; }
  };

  const compactPhase = shell.compactStrip?.querySelector?.('#fr-compact-phase');
  const compactMessage = shell.compactStrip?.querySelector?.('#fr-compact-message');
  const compactProgress = shell.compactStrip?.querySelector?.('#fr-compact-progress');
  const compactStart = shell.compactStrip?.querySelector?.('#fr-compact-start');
  const compactResume = shell.compactStrip?.querySelector?.('#fr-compact-resume');
  const compactStop = shell.compactStrip?.querySelector?.('#fr-compact-stop');

  shell.loading.hidden = true;
  shell.launcher.dataset.state = 'ready';
  let lastStructuralKey = '';
  const executor = createDirectExecutor(api, {
    onUpdate(status) {
      state.executorStatus = status;
      if (status.phase === 'complete') {
        try { storage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ goals: [], nextPlanId: state.nextPlanId })); } catch { /* persistence is optional */ }
      } else if (status.phase === 'error' || status.phase === 'idle') {
        persistQueue();
      }
      const key = `${status.phase}:${status.currentStep}:${state.planQueue.length}`;
      if (key !== lastStructuralKey) { lastStructuralKey = key; renderPlan(); }
      else renderExecutor();
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
      <div class="item-heading${item.art ? ' has-art' : ''}">
        ${item.art ? `<img class="item-art" src="/art/icons/items/${encodeURIComponent(id)}.png" alt="">` : ''}
        <div><h2>${escapeHtml(item.label || humanizeId(id))}</h2><p class="meta">${escapeHtml(item.type || 'Unknown type')}${item.subtype ? ` / ${escapeHtml(item.subtype)}` : ''}</p></div>
        <button class="button" id="fr-detail-plan" type="button" data-plan-item="${escapeHtml(id)}">Plan this item</button>
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
  skillsPanel.innerHTML = `<div class="skills-view"><div class="skills-toolbar field"><label for="fr-skill-select">Skill</label><select class="control" id="fr-skill-select"></select></div><p class="skill-action-status" id="fr-skill-action-status" role="status" aria-live="polite">Start an action directly from the table. This stops the current game action.</p><div id="fr-skill-table"></div></div>`;
  const skillSelect = skillsPanel.querySelector('#fr-skill-select');
  const skillActionStatus = skillsPanel.querySelector('#fr-skill-action-status');
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
    let snapshot = {};
    try { snapshot = api.getState() || {}; } catch { /* action buttons remain available for runtime validation */ }
    const locked = isExecutionLocked(state.executorStatus?.phase);
    skillTable.innerHTML = `<div class="table-wrap"><table><caption>${escapeHtml(skillNames[skillId] || skillId)} actions · ${actions.length.toLocaleString()} total</caption><thead><tr><th scope="col">Action</th><th scope="col">Level</th><th scope="col">Interval</th><th scope="col">Inputs</th><th scope="col">Outputs</th><th scope="col">Tool</th><th scope="col"><span class="visually-hidden">Start action</span></th></tr></thead><tbody>${actions.map((action) => {
      const rare = (action.rareOutputs || []).map((entry) => `${escapeHtml(labelFor(items, entry.item))} <span class="data">×${escapeHtml(entry.qty ?? 1)}</span> <span class="badge warning">${escapeHtml(formatChance(entry.chance))}</span>`).join('<br>');
      const blocker = actionBlocker(datasets, snapshot, skillId, action);
      const blockerMessage = blockedText(blocker);
      return `<tr><td><span class="cell-title">${escapeHtml(action.name || humanizeId(action.id))}</span>${action.spot ? `<span class="cell-id">${escapeHtml(datasets.strings?.[`name.${action.spot}`] || humanizeId(action.spot))}</span>` : ''}</td><td class="data">${escapeHtml(action.levelReq)}</td><td class="data">${escapeHtml(formatInterval(action.interval))}</td><td>${quantityEntries(action.inputs, items)}</td><td>${quantityEntries(action.outputs, items)}${rare ? `<br>${rare}` : ''}</td><td>${action.toolReq ? escapeHtml(datasets.strings?.[`name.${action.toolReq}`] || labelFor(items, action.toolReq)) : '—'}</td><td><button class="button compact" type="button" data-start-action data-skill-id="${escapeHtml(skillId)}" data-action-id="${escapeHtml(action.id)}" aria-label="Start ${escapeHtml(action.name || humanizeId(action.id))}"${blockerMessage ? ` title="${escapeHtml(blockerMessage)}"` : ''}${locked ? ' disabled' : ''}>${ICONS.play}Start</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  skillSelect.addEventListener('change', renderSkillTable);
  skillTable.addEventListener('click', async (event) => {
    const control = event.target.closest?.('[data-start-action]');
    if (!control || control.disabled || isExecutionLocked(state.executorStatus?.phase)) return;
    const skillId = control.dataset.skillId;
    const action = (datasets.actions?.[skillId] || []).find((candidate) => String(candidate.id) === control.dataset.actionId);
    if (!action) return;
    const blocker = actionBlocker(datasets, api.getState(), skillId, action);
    if (blocker) {
      skillActionStatus.dataset.state = 'error';
      skillActionStatus.textContent = blockedText(blocker);
      return;
    }
    control.disabled = true;
    skillActionStatus.dataset.state = 'idle';
    skillActionStatus.textContent = `Starting ${action.name || humanizeId(action.id)}…`;
    try {
      await api.stopAction();
      await api.startAction(skillId, action.id);
      skillActionStatus.textContent = `${action.name || humanizeId(action.id)} started. Starting another action will replace it.`;
    } catch (error) {
      skillActionStatus.dataset.state = 'error';
      skillActionStatus.textContent = error instanceof Error ? error.message : `Unable to start ${action.name || humanizeId(action.id)}.`;
    } finally {
      control.disabled = false;
    }
  });

  const planPanel = shell.panels.plan;
  planPanel.innerHTML = `
    <div class="plan-view">
      <form class="plan-form" id="fr-plan-form">
        <div class="field"><label for="fr-plan-item">Desired item</label><div class="plan-combobox"><input class="control" id="fr-plan-item" type="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="fr-plan-options" autocomplete="off" placeholder="Search item names" required></div></div>
        <div class="field"><label for="fr-plan-qty">Quantity</label><input class="control data" id="fr-plan-qty" type="number" min="1" step="1" value="1" inputmode="numeric"></div>
        <button class="button" id="fr-resolve-plan" type="submit">Add plan</button>
      </form>
      <div class="combobox-popover" id="fr-plan-options" role="listbox" aria-label="Matching items" hidden></div>
      <div id="fr-plan-result"><div class="empty">Add an item to begin a queue. Each plan is resolved against the output of plans before it.</div></div>
      <div class="executor" aria-label="Queue status"><div class="executor-status" role="status" aria-live="polite" aria-atomic="true"><strong id="fr-executor-phase">Ready</strong><p id="fr-executor-message">Add one or more plans to the queue.</p><progress class="executor-progress" id="fr-executor-progress" max="1" value="0" aria-label="Queue progress"></progress></div></div>
    </div>`;
  const planForm = planPanel.querySelector('#fr-plan-form');
  const planItem = planPanel.querySelector('#fr-plan-item');
  const planQty = planPanel.querySelector('#fr-plan-qty');
  const planResult = planPanel.querySelector('#fr-plan-result');
  const executorPhase = planPanel.querySelector('#fr-executor-phase');
  const executorMessage = planPanel.querySelector('#fr-executor-message');
  const executorProgress = planPanel.querySelector('#fr-executor-progress');
  const runButton = shell.queueControls.querySelector('#fr-run');
  const resumeButton = shell.queueControls.querySelector('#fr-resume');
  const stopButton = shell.queueControls.querySelector('#fr-stop');
  const clearButton = shell.queueControls.querySelector('#fr-clear');
  const planOptions = planPanel.querySelector('#fr-plan-options');
  shell.shadow.append(planOptions);
  let planTargetResults = [];
  let activePlanTarget = -1;

  function planTargetPriorities() {
    const ids = [];
    const context = new Map();
    const add = (id, label) => {
      if (!id || !items[id] || context.has(id)) return;
      ids.push(id);
      context.set(id, label);
    };
    add(state.selectedItemId, 'Current item');
    for (const id of state.recentPlanItemIds) add(id, 'Recent');
    let snapshot = {};
    try { snapshot = api.getState() || {}; } catch { /* ranking remains available without live inventory */ }
    for (const [id, amount] of Object.entries(snapshot.inventory || {})) if (Number(amount) > 0) add(id, 'In bag');
    const skillId = skillSelect.value || actionSkillIds[0];
    for (const action of datasets.actions?.[skillId] || []) {
      for (const id of Object.keys(action.outputs || {})) add(id, `${skillNames[skillId] || humanizeId(skillId)} output`);
    }
    return { ids, context };
  }

  function positionPlanOptions() {
    const rect = planItem.getBoundingClientRect();
    const view = documentRef.defaultView || globalThis;
    const viewportWidth = Number(view.innerWidth) || 1024;
    const viewportHeight = Number(view.innerHeight) || 768;
    const gutter = 8;
    const width = Math.min(rect.width, viewportWidth - (2 * gutter));
    const left = Math.max(gutter, Math.min(rect.left, viewportWidth - width - gutter));
    const top = Math.min(rect.bottom + 4, viewportHeight - gutter);
    planOptions.style.left = `${left}px`;
    planOptions.style.top = `${top}px`;
    planOptions.style.width = `${width}px`;
    planOptions.style.maxHeight = `${Math.max(96, Math.min(280, viewportHeight - top - gutter))}px`;
  }

  function renderPlanTargetOptions(query = '') {
    const { ids, context } = planTargetPriorities();
    planTargetResults = searchPlanTargets(sortedItems, query, ids, 10);
    if (activePlanTarget >= planTargetResults.length) activePlanTarget = planTargetResults.length - 1;
    planOptions.innerHTML = planTargetResults.length
      ? planTargetResults.map((entry, index) => `<button class="combobox-option" id="fr-plan-option-${index}" type="button" role="option" data-plan-item-id="${escapeHtml(entry.id)}" aria-selected="${index === activePlanTarget}"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(context.get(entry.id) || entry.item?.type || 'Item')}</small></button>`).join('')
      : '<div class="combobox-empty" role="status">No matching items</div>';
    planItem.setAttribute('aria-activedescendant', activePlanTarget >= 0 ? `fr-plan-option-${activePlanTarget}` : '');
  }

  function openPlanTargets(query = '') {
    if (planItem.disabled) return;
    activePlanTarget = -1;
    renderPlanTargetOptions(query);
    positionPlanOptions();
    planOptions.hidden = false;
    planItem.setAttribute('aria-expanded', 'true');
  }

  function closePlanTargets() {
    planOptions.hidden = true;
    planItem.setAttribute('aria-expanded', 'false');
    planItem.setAttribute('aria-activedescendant', '');
    activePlanTarget = -1;
  }

  function selectPlanTarget(itemId) {
    if (!items[itemId]) return false;
    state.planItemId = itemId;
    planItem.value = labelFor(items, itemId);
    planItem.setCustomValidity?.('');
    closePlanTargets();
    return true;
  }

  function movePlanTarget(delta) {
    if (planOptions.hidden) openPlanTargets(state.planItemId ? '' : planItem.value);
    if (!planTargetResults.length) return;
    activePlanTarget = activePlanTarget < 0
      ? (delta > 0 ? 0 : planTargetResults.length - 1)
      : (activePlanTarget + delta + planTargetResults.length) % planTargetResults.length;
    renderPlanTargetOptions(state.planItemId ? '' : planItem.value);
    planOptions.querySelector?.(`#fr-plan-option-${activePlanTarget}`)?.scrollIntoView?.({ block: 'nearest' });
  }

  planItem.addEventListener('focus', () => openPlanTargets(state.planItemId ? '' : planItem.value));
  planItem.addEventListener('input', () => {
    state.planItemId = '';
    planItem.setCustomValidity?.('');
    openPlanTargets(planItem.value);
  });
  planItem.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      movePlanTarget(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && !planOptions.hidden && activePlanTarget >= 0) {
      event.preventDefault();
      selectPlanTarget(planTargetResults[activePlanTarget]?.id);
    } else if (event.key === 'Escape' && !planOptions.hidden) {
      event.preventDefault();
      closePlanTargets();
    } else if (event.key === 'Tab') closePlanTargets();
  });
  planOptions.addEventListener('click', (event) => {
    const option = event.target.closest?.('[data-plan-item-id]');
    if (option) selectPlanTarget(option.dataset.planItemId);
  });
  shell.shadow.addEventListener('pointerdown', (event) => {
    if (event.target !== planItem && !planOptions.contains?.(event.target)) closePlanTargets();
  });
  shell.panel.addEventListener('scroll', closePlanTargets, true);
  shell.close.addEventListener('click', closePlanTargets);
  documentRef.defaultView?.addEventListener?.('resize', closePlanTargets);

  function flattenQueue() {
    const flattened = [];
    state.planQueue.forEach((entry, planIndex) => {
      (entry.plan?.steps || []).forEach((step, planStepIndex) => flattened.push({
        ...step,
        queuePlanId: entry.id,
        queuePlanIndex: planIndex,
        queuePlanCount: state.planQueue.length,
        queuePlanStep: planStepIndex,
        queuePlanSteps: entry.plan.steps.length,
        queuePlanLabel: labelFor(items, entry.itemId),
      }));
    });
    return flattened;
  }

  const queueView = (status = state.executorStatus) => {
    const currentIndex = Number.isInteger(status?.currentStep) ? Number(status.currentStep) : -1;
    const currentPlanIndex = currentIndex >= 0 ? state.executionSteps[currentIndex]?.queuePlanIndex ?? -1 : -1;
    const locked = isExecutionLocked(status?.phase);
    return {
      status, currentIndex, currentPlanIndex, locked,
      frozenIds: new Set(state.planQueue.slice(0, currentPlanIndex + 1).map((entry) => entry.id)),
      hasPending: state.planQueue.some((_, planIndex) => planIndex > currentPlanIndex),
    };
  };

  function rebuildQueue() {
    state.planQueue = resolvePlanQueue(datasets, api.getState(), state.queueGoals);
    state.executionSteps = flattenQueue();
    state.currentPlan = state.planQueue.at(-1)?.plan || null;
  }

  function remainingFrozenSteps(status) {
    const { currentIndex, currentPlanIndex } = queueView(status);
    if (currentPlanIndex < 0) return [];
    const remaining = [];
    for (let globalIndex = currentIndex + 1; globalIndex < state.executionSteps.length; globalIndex += 1) {
      const step = state.executionSteps[globalIndex];
      if ((step.queuePlanIndex ?? -1) > currentPlanIndex) break;
      if (globalIndex !== currentIndex + 1) {
        remaining.push({ ...step });
        continue;
      }
      const outputRemaining = Math.max(0, Number(status?.stepTarget) - Number(status?.stepProduced));
      if (!outputRemaining) continue;
      const perCount = Math.max(1, Number(step.produceQty) / Math.max(1, Number(step.count)));
      remaining.push({ ...step, produceQty: outputRemaining, count: Math.ceil(outputRemaining / perCount) });
    }
    return remaining;
  }

  function pendingPlanSteps(currentPlanIndex) {
    return state.planQueue
      .slice(currentPlanIndex + 1)
      .flatMap((entry) => entry.plan?.steps || []);
  }

  function rebuildPending() {
    const build = (status) => {
      const { currentPlanIndex, frozenIds } = queueView(status);
      const frozen = state.planQueue.slice(0, currentPlanIndex + 1);
      const pendingGoals = state.queueGoals.filter((goal) => !frozenIds.has(goal.id));
      const projected = projectSteps(datasets, api.getState(), remainingFrozenSteps(status));
      const pending = resolvePlanQueue(datasets, projected, pendingGoals);
      const blocked = pending.find((entry) => !entry.plan?.ok);
      if (blocked) {
        state.planNotice = { itemId: blocked.itemId, qty: blocked.qty, plan: blocked.plan };
        renderPlan();
        return { ok: false };
      }
      state.planQueue = [...frozen, ...pending];
      state.executionSteps = flattenQueue();
      const cutIndex = frozen.reduce((total, entry) => total + (entry.plan?.steps?.length || 0), 0);
      return { ok: true, cutIndex, replacement: state.executionSteps.slice(cutIndex) };
    };

    let status = state.executorStatus;
    let built = build(status);
    if (!built.ok) return false;
    if (!executor.splice(built.cutIndex, built.replacement)) {
      status = executor.getStatus();
      state.executorStatus = status;
      built = build(status);
      if (!built.ok) return false;
      if (!executor.splice(built.cutIndex, built.replacement)) {
        state.planNotice = { itemId: '', qty: 0, plan: { ok: false, steps: [], reason: 'The queue advanced while editing. Try again.' } };
        renderPlan();
        return false;
      }
    }
    state.planNotice = null;
    persistQueue();
    renderPlan();
    return true;
  }

  function queueEstimate() {
    return state.planQueue.reduce((total, entry) => total + entry.estimateMs, 0);
  }

  function queueIsRunnable() {
    return state.planQueue.length > 0
      && state.planQueue.every((entry) => entry.plan?.ok)
      && state.executionSteps.length > 0;
  }

  function satisfiedPrerequisites(plan) {
    const byItem = new Map();
    for (const entry of plan?.satisfied || []) {
      const current = byItem.get(entry.itemId) || { itemId: entry.itemId, requiredQty: 0, satisfiedQty: 0 };
      current.requiredQty += Math.max(0, Number(entry.requiredQty) || 0);
      current.satisfiedQty += Math.max(0, Number(entry.satisfiedQty) || 0);
      byItem.set(entry.itemId, current);
    }
    return [...byItem.values()];
  }

  const describeStatus = (view) => {
    const { status, currentIndex, locked } = view;
    const total = state.executionSteps.length;
    const current = currentIndex >= 0 ? state.executionSteps[currentIndex] : null;
    const phaseLabels = { idle: 'Ready', starting: 'Starting', running: 'Running', paused: 'Paused', complete: 'Complete', error: 'Stopped' };
    const phaseText = state.planNotice?.plan && !state.planNotice.plan.ok ? 'Plan blocked' : (phaseLabels[status.phase] || status.phase);
    let messageText;
    let actionText;
    let metaText = '';
    if (current) {
      const produced = `${Number(status.stepProduced) || 0} of ${Number(status.stepTarget) || 0}${current.rare ? ' rare drops' : ''}`;
      const planPos = `plan ${current.queuePlanIndex + 1}/${state.planQueue.length}`;
      const remaining = Number(status.remainingMs) > 0 ? ` · ~${formatDuration(status.remainingMs)}` : '';
      actionText = current.actionName || humanizeId(current.actionId);
      metaText = `${produced} · ${planPos}${remaining}`;
      messageText = `${actionText} · ${metaText}`;
    } else if (state.planQueue.length) {
      const estimate = queueEstimate();
      messageText = `${state.planQueue.length} ${state.planQueue.length === 1 ? 'plan' : 'plans'} · ${total} ${total === 1 ? 'action' : 'actions'}${estimate ? ` · ~${formatDuration(estimate)}` : ''}`;
      actionText = messageText;
    } else {
      messageText = status.message || 'Add one or more plans to the queue.';
      actionText = messageText;
    }
    const stepFraction = Number(status.stepTarget) > 0 ? Math.min(1, Math.max(0, Number(status.stepProduced) / Number(status.stepTarget))) : 0;
    const launcherText = locked
      ? (status.phase === 'paused'
        ? 'Companion · paused'
        : `Companion · ${Math.min(total, currentIndex + 1)}/${total}${Number(status.remainingMs) > 0 ? ` · ${formatDuration(status.remainingMs)}` : ''}`)
      : status.phase === 'complete' ? 'Companion · queue done'
        : status.phase === 'error' ? 'Companion · queue stopped' : 'Companion';
    return {
      phaseText, messageText, actionText, metaText, launcherText,
      progressMax: Math.max(1, total),
      progressValue: status.phase === 'complete' ? total : Math.max(0, Math.max(0, currentIndex) + stepFraction),
    };
  };

  const stepTimeLabel = (step, status, active) => {
    const estimate = Math.max(0, (Number(step.interval) || 0) * (Number(step.count) || 0));
    const base = active && Number(status.stepRemainingMs) > 0
      ? `about ${formatDuration(status.stepRemainingMs)} left`
      : estimate ? `about ${formatDuration(estimate)}` : '—';
    return step.rare ? `${base} (avg)` : base;
  };

  const updateActiveStepRow = (view) => {
    const { status, currentIndex } = view;
    if (currentIndex < 0) return;
    const row = planResult.querySelector?.(`[data-step-global="${currentIndex}"]`);
    if (!row) return;
    const step = state.executionSteps[currentIndex];
    if (!step) return;
    const timeCell = row.querySelector?.('.queue-step-time');
    if (timeCell) timeCell.textContent = stepTimeLabel(step, status, true);
    const bar = row.querySelector?.('.step-progress');
    if (bar && Number(status.stepTarget) > 0) {
      bar.max = Number(status.stepTarget);
      bar.value = Number(status.stepProduced) || 0;
    }
  };

  const setStatusMessage = (el, described) => {
    if (!el) return;
    const meta = described.metaText ? `<span class="exec-meta">· ${escapeHtml(described.metaText)}</span>` : '';
    el.innerHTML = `<span class="exec-name">${escapeHtml(described.actionText ?? described.messageText)}</span>${meta}`;
  };

  function renderExecutor() {
    const view = queueView();
    const { status, locked } = view;
    const described = describeStatus(view);
    updateActiveStepRow(view);
    const queueTotal = planResult.querySelector?.('#fr-queue-total');
    if (queueTotal) {
      const queueFinish = locked && Number(status.remainingMs) > 0 ? ` · done ~${formatFinishTime(status.remainingMs)}` : '';
      queueTotal.textContent = `${state.planQueue.length} ${state.planQueue.length === 1 ? 'plan' : 'plans'} · about ${formatDuration(queueEstimate())}${queueFinish}`;
    }
    executorPhase.textContent = described.phaseText;
    setStatusMessage(executorMessage, described);
    executorProgress.max = described.progressMax;
    executorProgress.value = described.progressValue;
    for (const control of skillTable.querySelectorAll?.('[data-start-action]') || []) control.disabled = locked;
    runButton.disabled = locked || status.phase === 'complete' || !queueIsRunnable();
    resumeButton.hidden = status.phase !== 'paused';
    resumeButton.classList?.toggle?.('attention', status.phase === 'paused');
    stopButton.disabled = !locked;
    clearButton.disabled = locked ? !view.hasPending : !state.planQueue.length;
    const clearLabel = locked ? 'Clear pending plans' : 'Clear queue';
    clearButton.title = clearLabel;
    clearButton.setAttribute('aria-label', clearLabel);
    const label = shell.launcher.querySelector?.('#fr-launcher-label') ?? shell.shadow.querySelector?.('#fr-launcher-label');
    if (label) label.textContent = described.launcherText;
    if (compactPhase) compactPhase.textContent = described.phaseText;
    setStatusMessage(compactMessage, described);
    if (compactProgress) {
      compactProgress.max = executorProgress.max;
      compactProgress.value = executorProgress.value;
    }
    if (compactResume) compactResume.hidden = status.phase !== 'paused';
    if (compactStart) {
      compactStart.hidden = locked;
      compactStart.disabled = runButton.disabled;
    }
    if (compactStop) compactStop.hidden = !locked;
  }

  function renderPlanNotice(notice) {
    const plan = notice?.plan;
    if (!plan) return '';
    const prerequisites = satisfiedPrerequisites(plan);
    const prerequisiteRows = prerequisites.map((entry) => `<li class="queue-step" data-kind="prerequisite"><span class="queue-step-marker">${ICONS.check}</span><span>${escapeHtml(labelFor(items, entry.itemId))}<span class="queue-step-detail">Prerequisite satisfied</span></span><span class="queue-step-time data">${escapeHtml(entry.satisfiedQty)} of ${escapeHtml(entry.requiredQty)} ready</span></li>`).join('');
    if (plan.ok) {
      return `<div class="banner success" role="status">${ICONS.check}<div><strong>${escapeHtml(labelFor(items, notice.itemId))} is already satisfied</strong><p>The requested quantity is available without another action.</p></div></div>${prerequisiteRows ? `<ol class="queue-steps">${prerequisiteRows}</ol>` : ''}`;
    }
    const block = blockedText(plan.blocked || plan.reason);
    return `<div class="banner plan-blocked" role="alert">${ICONS.error}<div><strong>${escapeHtml(labelFor(items, notice.itemId))} could not be queued</strong><p>${escapeHtml(block || plan.message || 'Resolve the blockers and try again.')}</p></div></div>${prerequisiteRows ? `<ol class="queue-steps">${prerequisiteRows}</ol>` : ''}`;
  }

  function renderPlan() {
    const status = state.executorStatus || { phase: 'idle' };
    const view = queueView(status);
    const { currentPlanIndex } = view;
    const currentIndex = view.currentIndex < 0 ? null : view.currentIndex;
    let globalIndex = 0;
    const queueRows = state.planQueue.map((entry, planIndex) => {
      const startIndex = globalIndex;
      const steps = entry.plan?.steps || [];
      const endIndex = startIndex + steps.length;
      globalIndex = endIndex;
      const planComplete = status.phase === 'complete'
        || (currentIndex != null && currentIndex >= endIndex && status.phase !== 'idle');
      const planActive = currentIndex != null && currentIndex >= startIndex && currentIndex < endIndex && status.phase !== 'idle';
      const planState = planComplete ? 'complete' : planActive ? 'active' : 'pending';
      const prerequisites = satisfiedPrerequisites(entry.plan);
      const prerequisiteRows = prerequisites.map((requirement) => `<li class="queue-step" data-state="complete" data-kind="prerequisite"><span class="queue-step-marker">${ICONS.check}</span><span>${escapeHtml(labelFor(items, requirement.itemId))}<span class="queue-step-detail">Prerequisite satisfied</span></span><span class="queue-step-time data">${escapeHtml(requirement.satisfiedQty)} of ${escapeHtml(requirement.requiredQty)} ready</span></li>`).join('');
      const stepRows = steps.map((step, planStepIndex) => {
        const stepIndex = startIndex + planStepIndex;
        const complete = status.phase === 'complete' || (currentIndex != null && stepIndex < currentIndex && status.phase !== 'idle');
        const active = currentIndex === stepIndex && status.phase !== 'idle';
        const stepState = complete ? 'complete' : active ? 'active' : 'pending';
        const marker = complete ? ICONS.check : String(planStepIndex + 1);
        const activeProgress = active && Number(status.stepTarget) > 0
          ? `<progress class="step-progress" max="${escapeHtml(status.stepTarget)}" value="${escapeHtml(status.stepProduced || 0)}" aria-label="${escapeHtml(step.actionName)} progress"></progress>`
          : '';
        const time = stepTimeLabel(step, status, active);
        const quantity = step.rare ? `~×${escapeHtml(step.count)}` : `×${escapeHtml(step.count)}`;
        const chanceBadge = step.rare
          ? ` <span class="badge warning">${escapeHtml(formatChance(step.chance))}</span>` : '';
        return `<li class="queue-step" data-state="${stepState}" data-step-global="${stepIndex}"><span class="queue-step-marker">${marker}</span><span>${escapeHtml(step.actionName || humanizeId(step.actionId))}${chanceBadge} <span class="data">${quantity}</span></span><span class="queue-step-time data">${escapeHtml(time)}</span>${activeProgress}</li>`;
      }).join('');
      const locked = isExecutionLocked(status.phase);
      const mutable = !locked || planIndex !== currentPlanIndex;
      const label = labelFor(items, entry.itemId);
      const upIsPromote = locked && planIndex - 1 === currentPlanIndex;
      const upDisabled = !mutable || planIndex === 0;
      const upLabel = upIsPromote ? 'Run now — interrupts the current plan' : `Move ${label} up`;
      const upTitle = upIsPromote ? 'Run now — interrupts the current plan' : 'Move up';
      const downDisabled = !mutable || planIndex === state.planQueue.length - 1;
      const editDisabled = !mutable;
      const actionLabel = `${steps.length} ${steps.length === 1 ? 'action' : 'actions'}`;
      const planMeta = planState === 'complete'
        ? `${actionLabel} · done`
        : `${actionLabel}${prerequisites.length ? ` · ${prerequisites.length} ready` : ''} · about ${escapeHtml(formatDuration(entry.estimateMs))}`;
      return `<li class="queue-plan" data-state="${planState}" data-plan-id="${escapeHtml(entry.id)}"><div class="queue-plan-top"><span class="queue-plan-index data">${planIndex + 1}</span><span class="queue-plan-title">${escapeHtml(label)} <span class="data">×${escapeHtml(entry.qty)}</span></span><span class="queue-plan-meta">${planMeta}</span><span class="queue-plan-actions"><button class="icon-button" type="button" data-queue-action="up" data-plan-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(upLabel)}" title="${escapeHtml(upTitle)}"${upDisabled ? ' disabled' : ''}>${ICONS.up}</button><button class="icon-button" type="button" data-queue-action="down" data-plan-id="${escapeHtml(entry.id)}" aria-label="Move ${escapeHtml(label)} down" title="Move down"${downDisabled ? ' disabled' : ''}>${ICONS.down}</button><button class="icon-button" type="button" data-queue-action="remove" data-plan-id="${escapeHtml(entry.id)}" aria-label="Remove ${escapeHtml(label)}" title="Remove"${editDisabled ? ' disabled' : ''}>${ICONS.remove}</button><button class="icon-button" type="button" data-queue-action="edit" data-plan-id="${escapeHtml(entry.id)}" aria-label="Edit ${escapeHtml(label)}" title="Edit"${editDisabled ? ' disabled' : ''}>${ICONS.edit}</button></span></div><ol class="queue-steps">${prerequisiteRows}${stepRows || (!prerequisiteRows ? '<li class="queue-step" data-state="complete"><span class="queue-step-marker">✓</span><span>Already satisfied by current inventory</span><span></span></li>' : '')}</ol></li>`;
    }).join('');
    const notice = renderPlanNotice(state.planNotice);
    const queueFinish = isExecutionLocked(status.phase) && Number(status.remainingMs) > 0
      ? ` · done ~${formatFinishTime(status.remainingMs)}` : '';
    planResult.innerHTML = `${notice}${state.planQueue.length ? `<div class="queue-header"><h3>Plan queue</h3><span class="queue-total data" id="fr-queue-total">${state.planQueue.length} ${state.planQueue.length === 1 ? 'plan' : 'plans'} · about ${escapeHtml(formatDuration(queueEstimate()))}${queueFinish}</span></div><ol class="queue-list">${queueRows}</ol>` : '<div class="empty">Add an item to begin a queue. Each plan is resolved against the output of plans before it.</div>'}`;
    renderExecutor();
  }

  planForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const locked = isExecutionLocked(state.executorStatus?.phase);
    const qty = Math.max(1, Math.trunc(Number(planQty.value) || 1));
    planQty.value = String(qty);
    if (!state.planItemId) {
      planItem.setCustomValidity?.('Choose an item from the suggestions.');
      planItem.reportValidity?.();
      openPlanTargets(planItem.value);
      return;
    }
    try {
      let projected;
      if (locked) {
        const status = state.executorStatus;
        const { currentPlanIndex } = queueView(status);
        projected = projectSteps(datasets, api.getState(), [
          ...remainingFrozenSteps(status),
          ...pendingPlanSteps(currentPlanIndex),
        ]);
      } else {
        projected = projectPlanState(datasets, api.getState(), state.planQueue.map((entry) => entry.plan));
      }
      const plan = createPlan(datasets, projected, { itemId: state.planItemId, qty });
      state.currentPlan = plan;
      state.recentPlanItemIds = [state.planItemId, ...state.recentPlanItemIds.filter((id) => id !== state.planItemId)].slice(0, 5);
      if (plan.ok && plan.steps?.length) {
        state.queueGoals.push({ id: `plan-${state.nextPlanId++}`, itemId: state.planItemId, qty });
        persistQueue();
        state.planNotice = null;
        if (locked) {
          if (!rebuildPending()) {
            state.queueGoals.pop();
            persistQueue();
          }
        } else {
          rebuildQueue();
          persistQueue();
          state.executorStatus = { phase: 'idle', currentStep: null, message: 'Plan added to the queue.' };
        }
      } else if (plan.ok) {
        state.planNotice = { itemId: state.planItemId, qty, plan };
        if (!locked) state.executorStatus = { phase: 'idle', currentStep: null, message: `${labelFor(items, state.planItemId)} is already available in the requested quantity.` };
      } else {
        state.planNotice = { itemId: state.planItemId, qty, plan };
        if (!locked) state.executorStatus = { phase: 'idle', currentStep: null, message: 'Resolve the blocker before adding this plan.' };
      }
    } catch (error) {
      const plan = { ok: false, steps: [], reason: error instanceof Error ? error.message : String(error) };
      state.currentPlan = plan;
      state.planNotice = { itemId: state.planItemId, qty, plan };
      state.executorStatus = { phase: 'error', currentStep: null, message: 'The plan could not be resolved.' };
    }
    renderPlan();
  });

  const promotePlan = (planId, view) => {
    const previousGoals = [...state.queueGoals];
    const currentEntry = state.planQueue[view.currentPlanIndex];
    if (!currentEntry) return false;
    const currentGoalId = currentEntry.id;
    const promoted = state.queueGoals.find((goal) => goal.id === planId);
    if (!promoted) return false;
    const remaining = state.queueGoals.filter((goal) => goal.id !== planId);
    const anchor = remaining.findIndex((goal) => goal.id === currentGoalId);
    if (anchor < 0) return false;
    remaining.splice(anchor, 0, promoted);
    state.queueGoals = remaining;

    const completed = state.planQueue.slice(0, view.currentPlanIndex);
    const completedIds = new Set(completed.map((entry) => entry.id));
    const tail = resolvePlanQueue(datasets, api.getState(), state.queueGoals.filter((goal) => !completedIds.has(goal.id)));
    const blocked = tail.find((entry) => !entry.plan?.ok);
    if (blocked) {
      state.queueGoals = previousGoals;
      state.planNotice = { itemId: blocked.itemId, qty: blocked.qty, plan: blocked.plan };
      renderPlan();
      return false;
    }
    state.planQueue = [...completed, ...tail];
    state.executionSteps = flattenQueue();
    const startIndex = completed.reduce((total, entry) => total + (entry.plan?.steps?.length || 0), 0);
    if (startIndex >= state.executionSteps.length) {
      executor.stop();
      state.planNotice = null;
      persistQueue();
      renderPlan();
      return true;
    }
    if (!executor.jump(state.executionSteps, startIndex)) {
      state.queueGoals = previousGoals;
      rebuildPending();
      state.planNotice = { itemId: '', qty: 0, plan: { ok: false, steps: [], reason: 'The queue advanced while editing. Try again.' } };
      renderPlan();
      return false;
    }
    state.planNotice = null;
    persistQueue();
    renderPlan();
    return true;
  };

  const rebuildFromLive = () => {
    const resolved = resolvePlanQueue(datasets, api.getState(), state.queueGoals);
    const blocked = resolved.find((entry) => !entry.plan?.ok);
    if (blocked) {
      state.planNotice = { itemId: blocked.itemId, qty: blocked.qty, plan: blocked.plan };
      renderPlan();
      return false;
    }
    state.planQueue = resolved;
    state.executionSteps = flattenQueue();
    state.planNotice = null;
    if (!state.executionSteps.length) {
      executor.stop();
      persistQueue();
      renderPlan();
      return true;
    }
    if (!executor.jump(state.executionSteps, 0)) {
      state.planNotice = { itemId: '', qty: 0, plan: { ok: false, steps: [], reason: 'The queue advanced while editing. Try again.' } };
      renderPlan();
      return false;
    }
    persistQueue();
    renderPlan();
    return true;
  };

  planResult.addEventListener('click', (event) => {
    const control = event.target.closest?.('[data-queue-action][data-plan-id]');
    if (!control || control.disabled) return;
    const index = state.queueGoals.findIndex((goal) => goal.id === control.dataset.planId);
    if (index < 0) return;
    const view = queueView();
    const locked = view.locked;
    const action = control.dataset.queueAction;
    // First pending plan promoted over the running one keeps the targeted, mostly
    // non-disruptive preemption path.
    if (action === 'up' && locked && index - 1 === view.currentPlanIndex) {
      promotePlan(control.dataset.planId, view);
      return;
    }
    const previousGoals = [...state.queueGoals];
    // Editing anything at or before the running plan re-resolves the whole queue
    // from live inventory; pure pending edits stay on the non-disruptive splice.
    let touchesFrozen;
    if (action === 'edit') {
      const goal = state.queueGoals[index];
      touchesFrozen = locked && index <= view.currentPlanIndex;
      selectPlanTarget(goal.itemId);
      planQty.value = String(goal.qty);
      state.queueGoals.splice(index, 1);
    } else if (action === 'remove') {
      touchesFrozen = locked && index <= view.currentPlanIndex;
      state.queueGoals.splice(index, 1);
    } else {
      const target = action === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= state.queueGoals.length) return;
      touchesFrozen = locked && Math.min(index, target) <= view.currentPlanIndex;
      [state.queueGoals[index], state.queueGoals[target]] = [state.queueGoals[target], state.queueGoals[index]];
    }
    persistQueue();
    state.planNotice = null;
    if (locked) {
      const rebuilt = touchesFrozen ? rebuildFromLive() : rebuildPending();
      if (!rebuilt && touchesFrozen) {
        state.queueGoals = previousGoals;
        persistQueue();
        renderPlan();
      }
    } else {
      rebuildQueue();
      state.executorStatus = { phase: 'idle', currentStep: null, message: state.planQueue.length ? 'Queue updated.' : 'Queue cleared.' };
      renderPlan();
    }
    if (action === 'edit') planItem.focus?.();
  });

  const startQueue = () => {
    if (isExecutionLocked(state.executorStatus?.phase) || !state.planQueue.length) return;
    rebuildQueue();
    const blocked = state.planQueue.find((entry) => !entry.plan?.ok);
    if (blocked) {
      state.planNotice = { itemId: blocked.itemId, qty: blocked.qty, plan: blocked.plan };
      state.executorStatus = { phase: 'idle', currentStep: null, message: 'The queue changed and now contains a blocked plan.' };
      renderPlan();
      return;
    }
    state.executionSteps = flattenQueue();
    if (state.executionSteps.length) executor.run(state.executionSteps);
  };
  runButton.addEventListener('click', startQueue);
  resumeButton.addEventListener('click', () => executor.resume());
  stopButton.addEventListener('click', () => executor.stop());
  compactStart?.addEventListener('click', startQueue);
  compactResume?.addEventListener('click', () => executor.resume());
  compactStop?.addEventListener('click', () => executor.stop());
  clearButton.addEventListener('click', () => {
    const locked = isExecutionLocked(state.executorStatus?.phase);
    if (locked) {
      const { frozenIds } = queueView(state.executorStatus);
      state.queueGoals = state.queueGoals.filter((goal) => frozenIds.has(goal.id));
      persistQueue();
      rebuildPending();
      return;
    }
    state.queueGoals = [];
    persistQueue();
    state.planQueue = [];
    state.executionSteps = [];
    state.currentPlan = null;
    state.planNotice = null;
    state.executorStatus = { phase: 'idle', currentStep: null, message: 'Queue cleared.' };
    renderPlan();
  });
  detail.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-plan-item]');
    if (!target) return;
    selectPlanTarget(target.dataset.planItem);
    shell.selectTab(2, true);
  });

  restoreQueue();
  renderItemList();
  renderItemDetail();
  renderSkillTable();
  renderPlan();
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
