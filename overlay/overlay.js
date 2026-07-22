import { indexModel, liveBlocker, factSatisfied } from './engine/model.js';
import { computeReach } from './engine/closure.js';
import { resolveQueue, nextUnlocks } from './engine/queue.js';
import { createDirectExecutor } from './executor.js';

export const DATA_FILES = Object.freeze([['model', 'model.json']]);

const HOST_ID = 'fractured-realms-companion';
const POSITION_STORAGE_KEY = 'fractured-realms-companion.positions.v1';
const QUEUE_STORAGE_KEY = 'fractured-realms-companion.queue.v1';
const TAB_IDS = Object.freeze(['items', 'skills', 'plan']);
const LIST_LIMIT = 120;
const SEARCH_LIMIT = 240;

const BRAND_MARK = '<img class="brand-mark" src="data:image/webp;base64,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" alt="" aria-hidden="true">';

const ICONS = Object.freeze({
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
.brand-mark {
  width: var(--fr-icon-lg);
  height: var(--fr-icon-lg);
  flex: 0 0 auto;
  object-fit: contain;
}
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
.banner.warning { border-color: var(--fr-brass-400); background: var(--fr-brass-950); color: var(--fr-brass-400); }
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
.form-error { margin: var(--fr-s2) 0 0; color: var(--fr-danger-400); font-size: 0.75rem; }
.table-wrap { overflow: auto; border: 1px solid var(--fr-neutral-800); border-radius: var(--fr-radius-sm); }
.table-wrap table { min-width: 44rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
caption { padding: var(--fr-s3); color: var(--fr-neutral-300); text-align: left; }
th, td { padding: var(--fr-s2) var(--fr-s3); border-bottom: 1px solid var(--fr-neutral-800); text-align: left; vertical-align: top; }
th { position: sticky; top: 0; background: var(--fr-neutral-950); color: var(--fr-neutral-300); font-size: 0.75rem; font-weight: 650; }
tbody tr:last-child td { border-bottom: 0; }
.cell-title { display: block; color: var(--fr-neutral-100); font-weight: 600; }
.cell-id { display: block; margin-top: var(--fr-s1); color: var(--fr-neutral-300); font-size: 0.6875rem; }
.plan-form { display: grid; grid-template-columns: minmax(0, 1fr) auto 6rem auto; align-items: end; gap: var(--fr-s2); padding-bottom: var(--fr-s4); border-bottom: 1px solid var(--fr-neutral-800); }
.plan-summary { display: flex; align-items: center; justify-content: space-between; gap: var(--fr-s3); margin: var(--fr-s4) 0 var(--fr-s2); }
.plan-summary p { margin: var(--fr-s1) 0 0; color: var(--fr-neutral-300); }
.step-index { width: 1.625rem; height: 1.625rem; display: inline-grid; place-items: center; border-radius: 999px; background: var(--fr-neutral-900); color: var(--fr-neutral-300); font-size: 0.6875rem; }
.step-name { flex: 1 1 auto; font-weight: 650; }
.step-qty { color: var(--fr-harbor-400); }
.step-note { display: flex; align-items: flex-start; gap: var(--fr-s2); color: var(--fr-brass-400) !important; }
.step-note svg { margin-top: 0.1rem; }
.plan-step .step-inputs { color: var(--fr-brass-400); }
.queue-header { display: flex; align-items: center; justify-content: space-between; gap: var(--fr-s3); margin-top: var(--fr-s5); }
.queue-plan[data-state="blocked"] .queue-plan-title { color: var(--fr-brass-400); }
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
  .plan-form { grid-template-columns: minmax(0, 1fr) auto 5rem; }
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

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  compactDisplay: 'short',
  maximumSignificantDigits: 3,
});

export function formatCompactNumber(value) {
  const numeric = Number(value);
  return compactNumberFormatter.format(Number.isFinite(numeric) ? Math.max(0, numeric) : 0);
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
    'aria-label': 'Open Fractured Realms Companion', html: `${BRAND_MARK}<span class="launcher-label" id="fr-launcher-label">Companion</span>`,
  });
  launcher.dataset.state = 'loading';

  const panel = makeElement(documentRef, 'section', {
    class: 'panel', id: 'fr-panel', 'aria-label': 'Fractured Realms Companion', tabindex: '-1',
  });
  panel.hidden = true;
  const header = makeElement(documentRef, 'header', { class: 'panel-header' });
  const identity = makeElement(documentRef, 'div', {
    class: 'identity panel-drag-handle',
    html: `${BRAND_MARK}<strong>Fractured Realms Companion</strong>`,
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
  if (typeof blocked === 'string') {
    if (blocked === 'no-xp') return 'This action grants no XP, so the level can never be reached.';
    return blocked;
  }
  const reason = blocked.reason || blocked.type;
  if (reason === 'no-xp') return blocked.message || 'This action grants no XP, so the level can never be reached.';
  if (reason === 'level') return `Requires ${blocked.skillName || blocked.skillId || 'skill'} level ${blocked.minLevel ?? blocked.levelReq ?? blocked.level ?? '—'}${blocked.actionName ? ` for ${blocked.actionName}` : ''}.`;
  if (reason === 'tool') return `Unlock ${blocked.toolName || humanizeId(blocked.toolId)} in the Shop${blocked.actionName ? ` before running ${blocked.actionName}` : ''}.`;
  if (reason === 'pattern') return `Unlock the ${humanizeId(blocked.patternId)} glyph pattern${blocked.actionName ? ` before running ${blocked.actionName}` : ''}.`;
  if (reason === 'prayer') return `Reach Prayer level ${blocked.minPrayerLevel} before running ${blocked.actionName}.`;
  if (reason === 'map') return `Chart ${humanizeId(blocked.mapId)}${blocked.actionName ? ` before running ${blocked.actionName}` : ''}.`;
  if (reason === 'recipe') return `Learn the ${blocked.actionName || 'required'} recipe before running this step.`;
  if (reason === 'bag-full') return 'Free at least one bag slot before running an action.';
  if (reason === 'input') return `Requires ${blocked.required} ${humanizeId(blocked.itemId)} in the bag; ${blocked.available} available.`;
  if (reason === 'rare-only') return `Only available as a rare drop${Array.isArray(blocked.chances) && blocked.chances.length ? ` (${blocked.chances.map((chance) => formatChance(chance.chance)).join(', ')})` : ''}.`;
  if (reason === 'rare-stalled') return blocked.message || 'No rare drops after repeated restocks. Start the queue again to retry.';
  if (reason === 'no-source') return 'No deterministic source exists in this game build.';
  if (reason === 'cycle') return `A dependency cycle prevents a safe plan${blocked.itemId ? ` at ${blocked.itemId}` : ''}.`;
  return blocked.message || String(reason || 'This step is blocked.');
}

function actionName(action) {
  return action?.name || humanizeId(action?.id);
}

function factLabel(fact) {
  const value = String(fact || '');
  const [kind, ...parts] = value.split(':');
  return kind === 'level' ? `${humanizeId(parts[0])} level ${parts[1]}` : `${humanizeId(kind)}: ${humanizeId(parts.join(':'))}`;
}

export function buildIndexes(model) {
  const sourcesOf = Object.create(null);
  const usesOf = Object.create(null);
  const add = (index, itemId, entry) => {
    if (!itemId) return;
    (index[itemId] ||= []).push(entry);
  };
  for (const action of model?.actions || []) {
    const base = {
      kind: action.skillId === 'bounty' ? 'bounty' : 'action',
      rare: false,
      skillId: action.skillId,
      actionId: action.id,
      actionName: actionName(action),
      levelReq: action.levelReq,
      interval: action.interval,
      spot: action.spot,
    };
    for (const [itemId, qty] of Object.entries(action.outputs || {})) {
      if (itemId === 'gold') continue;
      add(sourcesOf, itemId, { ...base, qty });
    }
    for (const rare of action.rareOutputs || []) {
      if (rare?.item) add(sourcesOf, rare.item, { ...base, rare: true, qty: rare.qty, chance: rare.chance });
    }
    for (const [itemId, qty] of Object.entries(action.inputs || {})) {
      add(usesOf, itemId, { kind: 'action', skillId: action.skillId, actionId: action.id, actionName: actionName(action), qty });
    }
  }
  for (const zone of model?.zones || []) for (const enemy of zone?.enemies || []) for (const drop of enemy?.drops || []) {
    if (!drop?.id || drop.id === 'gold') continue;
    add(sourcesOf, drop.id, { kind: 'enemy-drop', rare: true, enemyName: enemy.name || enemy.id, zoneName: zone.name || zone.id, qty: drop.qty, chance: drop.chance });
  }
  for (const building of model?.buildings || []) for (const upgrade of building?.upgrades || []) {
    for (const [itemId, qty] of Object.entries(upgrade.cost || {})) if (itemId !== 'gold') {
      add(usesOf, itemId, { kind: 'building', buildingId: building.id, buildingName: building.name || building.id, upgradeLevel: upgrade.level, upgradeLabel: upgrade.label, qty });
    }
  }
  const sourceSort = (a, b) => Number(a.rare) - Number(b.rare)
    || String(a.kind).localeCompare(String(b.kind))
    || String(a.skillId || a.zoneName || '').localeCompare(String(b.skillId || b.zoneName || ''))
    || Number(a.levelReq || 0) - Number(b.levelReq || 0)
    || String(a.actionName || a.enemyName || '').localeCompare(String(b.actionName || b.enemyName || ''));
  const useSort = (a, b) => String(a.kind).localeCompare(String(b.kind))
    || String(a.actionName || a.buildingName || '').localeCompare(String(b.actionName || b.buildingName || ''));
  for (const values of Object.values(sourcesOf)) values.sort(sourceSort);
  for (const values of Object.values(usesOf)) values.sort(useSort);
  return { sourcesOf, usesOf };
}

function createApplication(shell, modelJson, api) {
  const documentRef = shell.panel.ownerDocument;
  const model = indexModel(modelJson || {});
  const datasets = model;
  const indexes = buildIndexes(model);
  const items = model.items || {};
  const strings = model.stringsEn || {};
  const skillNames = Object.fromEntries((model.skills || []).map((skill) => [skill.id, skill.name || skill.id]));
  const skills = (model.skills || []).filter((skill) => model._index.actionsBySkill.has(skill.id) || (skill.id === 'agility' && (model.agilityCourses || []).length) || (skill.id === 'cartography' && (model.maps || []).length));
  const sortedItems = Object.entries(items).sort(([, a], [, b]) => String(a.label || '').localeCompare(String(b.label || '')));
  const actionFor = (skillId, actionId) => (model._index.actionsBySkill.get(skillId) || []).find((action) => action.id === actionId);
  const hasSpecialAction = (skillId, actionId) => skillId === 'agility'
    ? (model.agilityCourses || []).some((course) => course.id === actionId)
    : skillId === 'cartography' && (model.maps || []).some((map) => map.id === actionId);
  const hasFinitePositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const knownSkill = (skillId) => typeof skillId === 'string' && Boolean(skillNames[skillId]);
  const validTarget = (target) => {
    if (!target || typeof target !== 'object' || typeof target.type !== 'string') return false;
    if (target.type === 'item' || target.type === 'item-gain') return typeof target.itemId === 'string' && Boolean(items[target.itemId]) && hasFinitePositive(target[target.type === 'item' ? 'qty' : 'gain']);
    if (target.type === 'level') return knownSkill(target.skillId) && Number.isInteger(target.level) && target.level >= 1;
    if (target.type === 'xp') return knownSkill(target.skillId) && hasFinitePositive(target.xp);
    if (target.type === 'action') return knownSkill(target.skillId) && (Boolean(actionFor(target.skillId, target.actionId)) || hasSpecialAction(target.skillId, target.actionId)) && ((hasFinitePositive(target.runs) && target.minutes == null) || (hasFinitePositive(target.minutes) && target.runs == null));
    if (target.type === 'unlock') return typeof target.fact === 'string' && model._index.factUniverse.has(target.fact);
    if (target.type === 'gold') return hasFinitePositive(target.amount);
    return false;
  };
  const state = {
    selectedItemId: null,
    selectedPlanItemId: null,
    queueGoals: [],
    resolvedQueue: { steps: [], targets: [] },
    executorStatus: { phase: 'idle', message: 'Add a target to begin.', stepStatuses: {}, runningStepId: null },
    queueStartedAt: null,
    nextPlanId: 1,
  };
  const storage = documentRef.defaultView?.localStorage;
  const liveState = () => { try { return api.getState() || {}; } catch { return {}; } };
  const persistQueue = () => { try { storage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ goals: state.queueGoals, nextPlanId: state.nextPlanId })); } catch { /* optional */ } };
  const refreshQueue = () => {
    state.resolvedQueue = resolveQueue(model, liveState(), state.queueGoals.map((entry) => entry.target));
    return state.resolvedQueue;
  };

  shell.loading.hidden = true;
  shell.launcher.dataset.state = 'ready';

  const itemsPanel = shell.panels.items;
  itemsPanel.innerHTML = `<div class="items-layout"><section class="item-browser" aria-label="Item browser"><div class="toolbar"><div class="field grow"><label for="fr-item-search">Search items</label><div class="search-control">${ICONS.search}<input id="fr-item-search" type="search" autocomplete="off" placeholder="Item name"></div></div></div><p class="result-count" id="fr-result-count" aria-live="polite"></p><ul class="item-list" id="fr-item-list"></ul></section><article class="detail" id="fr-item-detail" aria-live="polite"></article></div>`;
  const itemSearch = itemsPanel.querySelector('#fr-item-search');
  const resultCount = itemsPanel.querySelector('#fr-result-count');
  const itemList = itemsPanel.querySelector('#fr-item-list');
  const detail = itemsPanel.querySelector('#fr-item-detail');
  const filteredItems = () => {
    const needle = String(itemSearch?.value || '').trim().toLocaleLowerCase();
    return (needle ? sortedItems.filter(([id, item]) => `${item.label || ''}\n${id}`.toLocaleLowerCase().includes(needle)) : sortedItems);
  };
  const renderItemList = () => {
    const matches = filteredItems(); const limit = itemSearch?.value ? SEARCH_LIMIT : LIST_LIMIT;
    resultCount.textContent = matches.length > limit ? `${matches.length} results · showing first ${limit}` : `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`;
    itemList.innerHTML = matches.slice(0, limit).map(([id, item]) => `<li><button class="item-row" type="button" data-item-id="${escapeHtml(id)}" aria-current="${id === state.selectedItemId}"><span>${escapeHtml(item.label || humanizeId(id))}</span></button></li>`).join('') || '<li class="empty">No items match.</li>';
  };
  const renderItemDetail = () => {
    const id = state.selectedItemId; const item = id ? items[id] : null;
    if (!item) { detail.innerHTML = '<div class="detail-empty">Select an item to inspect its sources and uses.</div>'; return; }
    const sources = indexes.sourcesOf[id] || []; const uses = indexes.usesOf[id] || [];
    const meal = (model.recipeMeals || []).find((entry) => entry?.output === id || entry?.output?.item === id || entry?.itemId === id || entry?.item === id || entry?.outputs?.[id] != null);
    const healAmount = item.healAmount ?? meal?.healAmount;
    const sourceRows = sources.map((source) => {
      const origin = source.kind === 'enemy-drop' ? `${source.enemyName} · ${source.zoneName}` : source.actionName;
      const context = source.kind === 'enemy-drop' ? 'Manual enemy drop' : `${skillNames[source.skillId] || source.skillId} level ${source.levelReq ?? 1} · ${formatInterval(source.interval)}`;
      return `<li class="record-row"><div class="record-top"><strong>${escapeHtml(origin)}</strong><div class="badges"><span class="badge ${source.rare ? 'warning' : 'signal'}">${source.rare ? `Rare ${formatChance(source.chance)}` : 'Guaranteed'}</span><span class="badge">×${escapeHtml(source.qty ?? 1)}</span></div></div><p>${escapeHtml(context)}</p></li>`;
    }).join('') || '<li class="record-row"><p>No source is recorded for this item.</p></li>';
    const useRows = uses.map((use) => use.kind === 'building'
      ? `<li class="record-row"><div class="record-top"><strong>${escapeHtml(use.buildingName)}</strong><span class="badge">Cost ×${escapeHtml(use.qty)}</span></div><p>${escapeHtml(use.upgradeLabel || `Upgrade level ${use.upgradeLevel ?? '—'}`)}</p></li>`
      : `<li class="record-row"><div class="record-top"><strong>${escapeHtml(use.actionName)}</strong><span class="badge">Input ×${escapeHtml(use.qty)}</span></div><p>${escapeHtml(skillNames[use.skillId] || use.skillId)}</p></li>`).join('') || '<li class="record-row"><p>No action or building upgrade consumes this item.</p></li>';
    detail.innerHTML = `<div class="item-heading${item.art ? ' has-art' : ''}">${item.art ? `<img class="item-art" src="/art/icons/items/${encodeURIComponent(id)}.png" alt="">` : ''}<div><h2>${escapeHtml(item.label || humanizeId(id))}</h2><p class="meta">${escapeHtml(item.type || 'Unknown type')}${item.subtype ? ` / ${escapeHtml(item.subtype)}` : ''}</p></div><button class="button" type="button" data-plan-item="${escapeHtml(id)}">Plan this item</button></div><p class="prose">${escapeHtml(item.desc || strings[`itemdesc.${id}`] || 'No description is available in this build.')}</p><dl class="facts">${item.value != null ? `<div><dt>Value</dt><dd>${escapeHtml(item.value)}</dd></div>` : ''}${healAmount != null ? `<div><dt>Healing</dt><dd>${escapeHtml(healAmount)}</dd></div>` : ''}</dl><h3>Sources</h3><ul class="record-list">${sourceRows}</ul><h3>Uses</h3><ul class="record-list">${useRows}</ul>`;
  };
  itemSearch.addEventListener('input', renderItemList);
  itemList.addEventListener('click', (event) => { const row = event.target.closest?.('[data-item-id]'); if (!row) return; state.selectedItemId = row.dataset.itemId; renderItemList(); renderItemDetail(); });
  detail.addEventListener('click', (event) => { const button = event.target.closest?.('[data-plan-item]'); if (!button) return; state.selectedPlanItemId = button.dataset.planItem; planKind.value = 'item'; planItem.value = items[state.selectedPlanItemId]?.label || state.selectedPlanItemId; updateTargetFields(); shell.selectTab(2, true); });
  detail.addEventListener('error', (event) => { if (event.target.matches?.('.item-art')) event.target.hidden = true; }, true);

  const skillsPanel = shell.panels.skills;
  skillsPanel.innerHTML = `<div class="skills-view"><div class="skills-toolbar field"><label for="fr-skill-select">Skill</label><select class="control" id="fr-skill-select"></select></div><p class="skill-action-status" id="fr-skill-action-status" role="status" aria-live="polite">Start an action directly from the table.</p><div id="fr-skill-table"></div></div>`;
  const skillSelect = skillsPanel.querySelector('#fr-skill-select'); const skillTable = skillsPanel.querySelector('#fr-skill-table'); const skillStatus = skillsPanel.querySelector('#fr-skill-action-status');
  skillSelect.innerHTML = skills.map((skill) => `<option value="${escapeHtml(skill.id)}">${escapeHtml(skillNames[skill.id] || skill.id)}</option>`).join('');
  const renderSkillTable = () => {
    const skillId = skillSelect.value || skills[0]?.id; const actions = model._index.actionsBySkill.get(skillId) || []; const snapshot = liveState(); const locked = isExecutionLocked(state.executorStatus?.phase);
    skillTable.innerHTML = actions.length ? `<div class="table-wrap"><table><caption>${escapeHtml(skillNames[skillId] || skillId)} actions · ${actions.length} total</caption><thead><tr><th>Action</th><th>Level</th><th>Interval</th><th>Inputs</th><th>Outputs</th><th>Tool</th><th></th></tr></thead><tbody>${actions.map((action) => { const blocker = liveBlocker(model, snapshot, { kind: 'action', skillId, actionId: action.id }); const rare = (action.rareOutputs || []).map((entry) => `${escapeHtml(labelFor(items, entry.item))} ×${escapeHtml(entry.qty ?? 1)} <span class="badge warning">${escapeHtml(formatChance(entry.chance))}</span>`).join('<br>'); const tool = action.toolReq ? (strings[`name.${action.toolReq}`] || labelFor(items, action.toolReq)) : '—'; return `<tr><td><span class="cell-title">${escapeHtml(actionName(action))}</span>${action.spot ? `<span class="cell-id">${escapeHtml(strings[`name.${action.spot}`] || humanizeId(action.spot))}</span>` : ''}</td><td class="data">${escapeHtml(action.levelReq ?? '—')}</td><td class="data">${escapeHtml(formatInterval(action.interval))}</td><td>${quantityEntries(action.inputs, items)}</td><td>${quantityEntries(action.outputs, items)}${rare ? `<br>${rare}` : ''}</td><td>${escapeHtml(tool)}</td><td><button class="button compact" type="button" data-start-action data-skill-id="${escapeHtml(skillId)}" data-action-id="${escapeHtml(action.id)}"${locked ? ' disabled' : ''}${blocker ? ` aria-label="Blocked: ${escapeHtml(blockedText(blocker))}"` : ''}>Start</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No actions recorded for this skill.</div>';
  };
  skillSelect.addEventListener('change', renderSkillTable);
  skillTable.addEventListener('click', async (event) => { const button = event.target.closest?.('[data-start-action]'); if (!button || button.disabled || isExecutionLocked(state.executorStatus?.phase)) return; const skillId = button.dataset.skillId; const action = actionFor(skillId, button.dataset.actionId); if (!action) return; const blocker = liveBlocker(model, liveState(), { kind: 'action', skillId, actionId: action.id }); if (blocker) { skillStatus.textContent = `Blocked: ${factLabel(blocker)}`; skillStatus.dataset.state = 'error'; return; } try { await api.stopAction(); await api.startAction(skillId, action.id); skillStatus.textContent = `${actionName(action)} started.`; skillStatus.dataset.state = 'idle'; } catch (error) { skillStatus.textContent = error instanceof Error ? error.message : String(error); skillStatus.dataset.state = 'error'; } });

  const planPanel = shell.panels.plan;
  planPanel.innerHTML = `<div class="plan-view"><form class="plan-form" id="fr-plan-form"><div class="field"><label for="fr-plan-target">Target type</label><select class="control" id="fr-plan-target"><option value="item">Item total</option><option value="item-gain">Item gain</option><option value="level">Skill level</option><option value="xp">Skill XP</option><option value="action">Action</option><option value="unlock">Unlock</option><option value="gold">Gold</option></select></div><div class="field" id="fr-plan-item-field"><label for="fr-plan-item">Desired item</label><div class="plan-combobox"><input class="control" id="fr-plan-item" type="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="fr-plan-options" aria-expanded="false" autocomplete="off" placeholder="Search item names"><div class="combobox-popover" id="fr-plan-options" role="listbox" hidden></div></div></div><div class="field" id="fr-plan-skill-field" hidden><label for="fr-plan-skill">Skill</label><select class="control" id="fr-plan-skill"></select></div><div class="field" id="fr-plan-action-field" hidden><label for="fr-plan-action">Action</label><select class="control" id="fr-plan-action"></select></div><div class="field" id="fr-plan-unlock-field" hidden><label for="fr-plan-unlock">Unlock</label><select class="control" id="fr-plan-unlock"></select></div><div class="field"><label for="fr-plan-qty" id="fr-plan-qty-label">Quantity</label><input class="control data" id="fr-plan-qty" type="number" min="1" step="1" value="1" inputmode="numeric"></div><div class="field" id="fr-plan-mode-field" hidden><label for="fr-plan-action-mode">Action target</label><select class="control" id="fr-plan-action-mode"><option value="runs">Runs</option><option value="minutes">Minutes</option></select></div><button class="button" id="fr-resolve-plan" type="submit">Add target</button></form><p class="form-error" id="fr-plan-form-error" role="status" aria-live="polite" hidden></p><div id="fr-plan-result"><div class="empty">Add a target to begin a queue.</div></div><div class="executor" aria-label="Queue status"><div class="executor-status" role="status" aria-live="polite"><strong id="fr-executor-phase">Ready</strong><p id="fr-executor-message">Add a target to begin a queue.</p><progress class="executor-progress" id="fr-executor-progress" max="1" value="0" aria-label="Queue progress"></progress></div></div></div>`;
  const planForm = planPanel.querySelector('#fr-plan-form'); const planFormError = planPanel.querySelector('#fr-plan-form-error'); const planKind = planPanel.querySelector('#fr-plan-target'); const planItem = planPanel.querySelector('#fr-plan-item'); const planOptions = planPanel.querySelector('#fr-plan-options'); const planSkill = planPanel.querySelector('#fr-plan-skill'); const planAction = planPanel.querySelector('#fr-plan-action'); const planUnlock = planPanel.querySelector('#fr-plan-unlock'); const planQty = planPanel.querySelector('#fr-plan-qty'); const planQtyLabel = planPanel.querySelector('#fr-plan-qty-label'); const planMode = planPanel.querySelector('#fr-plan-action-mode');
  planSkill.innerHTML = skills.map((skill) => `<option value="${escapeHtml(skill.id)}">${escapeHtml(skillNames[skill.id] || skill.id)}</option>`).join('');
  if (!planKind.value) planKind.value = 'item';
  if (!planSkill.value) planSkill.value = skills[0]?.id || '';
  const renderActionOptions = () => { const actions = model._index.actionsBySkill.get(planSkill.value) || []; const special = planSkill.value === 'agility' ? (model.agilityCourses || []).map((course) => ({ id: course.id, name: course.name })) : planSkill.value === 'cartography' ? (model.maps || []).map((map) => ({ id: map.id, name: map.name })) : []; const options = actions.length ? actions : special; planAction.innerHTML = options.map((action) => `<option value="${escapeHtml(action.id)}">${escapeHtml(actionName(action))}</option>`).join(''); planAction.value = options[0]?.id || ''; };
  const renderUnlockOptions = () => { const entries = nextUnlocks(model, liveState(), 30); planUnlock.innerHTML = entries.map((entry) => `<option value="${escapeHtml(entry.fact)}">${escapeHtml(factLabel(entry.fact))} · ${escapeHtml(formatDuration(entry.costMs))}</option>`).join('') || '<option value="">No outstanding unlocks</option>'; planUnlock.value = entries[0]?.fact || ''; };
  const updateTargetFields = () => {
    const kind = planKind.value; const itemKind = kind === 'item' || kind === 'item-gain'; const skillKind = kind === 'level' || kind === 'xp' || kind === 'action';
    planPanel.querySelector('#fr-plan-item-field').hidden = !itemKind; planPanel.querySelector('#fr-plan-skill-field').hidden = !skillKind; planPanel.querySelector('#fr-plan-action-field').hidden = kind !== 'action'; planPanel.querySelector('#fr-plan-unlock-field').hidden = kind !== 'unlock'; planPanel.querySelector('#fr-plan-mode-field').hidden = kind !== 'action';
    planQtyLabel.textContent = kind === 'level' ? 'Level' : kind === 'xp' ? 'XP' : kind === 'gold' ? 'Gold' : kind === 'item-gain' ? 'Gain' : kind === 'action' ? 'Amount' : 'Quantity';
    planQty.min = kind === 'level' ? '2' : '1';
    renderActionOptions(); if (kind === 'unlock') renderUnlockOptions();
  };
  const setFormError = (message = '') => { planFormError.textContent = message; planFormError.hidden = !message; planFormError.dataset.state = message ? 'error' : 'idle'; };
  planKind.addEventListener('change', () => { setFormError(); updateTargetFields(); }); planSkill.addEventListener('change', () => { setFormError(); renderActionOptions(); });
  planForm.addEventListener('submit', (event) => { event.preventDefault(); try { const target = makeTarget(); setFormError(); state.queueGoals.push({ id: `plan-${state.nextPlanId++}`, target }); persistQueue(); refreshQueue(); renderPlan(); } catch (error) { setFormError(error instanceof Error ? error.message : String(error)); } });  let planTargetResults = [];
  let activePlanTarget = -1;
  const positionPlanOptions = () => {
    const rect = planItem.getBoundingClientRect?.() || { left: 8, bottom: 44, width: 240 };
    const view = documentRef.defaultView || globalThis;
    const viewportWidth = Number(view?.innerWidth) || 1024; const viewportHeight = Number(view?.innerHeight) || 768; const gutter = 8;
    const width = Math.min(Number(rect.width) || 240, Math.max(0, viewportWidth - 2 * gutter));
    const left = Math.max(gutter, Math.min(Number(rect.left) || gutter, viewportWidth - width - gutter));
    const top = Math.min((Number(rect.bottom) || 44) + 4, viewportHeight - gutter);
    planOptions.style.left = `${left}px`; planOptions.style.top = `${top}px`; planOptions.style.width = `${width}px`; planOptions.style.maxHeight = `${Math.max(96, Math.min(280, viewportHeight - top - gutter))}px`;
  };
  const renderItemOptions = (query = planItem.value) => {
    planTargetResults = searchPlanTargets(sortedItems, query, [state.selectedItemId, state.selectedPlanItemId].filter(Boolean), 12);
    if (activePlanTarget >= planTargetResults.length) activePlanTarget = planTargetResults.length - 1;
    planOptions.innerHTML = planTargetResults.length
      ? planTargetResults.map((entry, index) => `<button type="button" role="option" id="fr-plan-option-${index}" class="combobox-option" data-plan-option="${escapeHtml(entry.id)}" aria-selected="${index === activePlanTarget}"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.item?.type || 'Item')}</small></button>`).join('')
      : '<span class="combobox-empty" role="status">No matching items</span>';
    planItem.setAttribute('aria-activedescendant', activePlanTarget >= 0 ? `fr-plan-option-${activePlanTarget}` : '');
  };
  const closeItemOptions = () => { planOptions.hidden = true; planItem.setAttribute('aria-expanded', 'false'); planItem.setAttribute('aria-activedescendant', ''); activePlanTarget = -1; };
  const openItemOptions = (query = planItem.value) => { activePlanTarget = -1; renderItemOptions(query); positionPlanOptions(); planOptions.hidden = false; planItem.setAttribute('aria-expanded', 'true'); };
  const selectPlanItem = (itemId) => { if (!items[itemId]) return false; state.selectedPlanItemId = itemId; planItem.value = items[itemId]?.label || itemId; closeItemOptions(); return true; };
  const movePlanItem = (delta) => {
    if (planOptions.hidden) openItemOptions(planItem.value);
    if (!planTargetResults.length) return;
    activePlanTarget = activePlanTarget < 0 ? (delta > 0 ? 0 : planTargetResults.length - 1) : (activePlanTarget + delta + planTargetResults.length) % planTargetResults.length;
    renderItemOptions(planItem.value);
    planOptions.querySelector?.(`#fr-plan-option-${activePlanTarget}`)?.scrollIntoView?.({ block: 'nearest' });
  };
  planItem.addEventListener('input', () => { state.selectedPlanItemId = null; openItemOptions(planItem.value); });
  planItem.addEventListener('focus', () => openItemOptions(state.selectedPlanItemId ? '' : planItem.value));
  planItem.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); movePlanItem(event.key === 'ArrowDown' ? 1 : -1); }
    else if (event.key === 'Enter' && !planOptions.hidden && activePlanTarget >= 0) { event.preventDefault(); selectPlanItem(planTargetResults[activePlanTarget]?.id); }
    else if (event.key === 'Escape' && !planOptions.hidden) { event.preventDefault(); closeItemOptions(); }
    else if (event.key === 'Tab') closeItemOptions();
  });
  planOptions.addEventListener('click', (event) => { const button = event.target.closest?.('[data-plan-option]'); if (button) selectPlanItem(button.dataset.planOption); });
  shell.shadow.addEventListener?.('pointerdown', (event) => { if (event.target !== planItem && !planOptions.contains?.(event.target)) closeItemOptions(); });
  planPanel.addEventListener('scroll', closeItemOptions, true);
  shell.close.addEventListener('click', closeItemOptions); documentRef.defaultView?.addEventListener?.('resize', closeItemOptions);
  const makeTarget = () => {
    const kind = planKind.value; const amount = Math.max(1, Math.trunc(Number(planQty.value) || 0));
    if (kind === 'item' || kind === 'item-gain') { const itemId = state.selectedPlanItemId || sortedItems.find(([id, item]) => String(item.label || '').toLocaleLowerCase() === planItem.value.trim().toLocaleLowerCase())?.[0]; if (!itemId || !items[itemId]) throw new Error('Choose an item from the search results.'); return { type: kind, itemId, [kind === 'item' ? 'qty' : 'gain']: amount }; }
    if (kind === 'level') return { type: 'level', skillId: planSkill.value, level: amount };
    if (kind === 'xp') return { type: 'xp', skillId: planSkill.value, xp: amount };
    if (kind === 'action') { const target = { type: 'action', skillId: planSkill.value, actionId: planAction.value }; target[planMode.value] = amount; return target; }
    if (kind === 'unlock') { if (!planUnlock.value) throw new Error('No unlock is currently available.'); return { type: 'unlock', fact: planUnlock.value }; }
    return { type: 'gold', amount };
  };

  let renderPlan;
  const dependencyManual = (step, allSteps, status) => {
    const byId = new Map((allSteps || []).map((candidate) => [candidate.id, candidate])); const seen = new Set();
    const visit = (id) => {
      if (seen.has(id)) return null; seen.add(id);
      const dependency = byId.get(id); if (!dependency) return null;
      if (dependency.kind === 'manual' && status.stepStatuses?.[dependency.id] !== 'done') return dependency;
      for (const parentId of dependency.deps || []) { const found = visit(parentId); if (found) return found; }
      return null;
    };
    for (const id of step.deps || []) { const found = visit(id); if (found) return found; }
    return null;
  };
  const stepProgress = (step, status) => {
    if (status.runningStepId !== step.id) return null;
    const rawValue = typeof status.stepProgress === 'object' && status.stepProgress !== null ? status.stepProgress[step.id] : status.stepProgress ?? status.stepProduced ?? status.progressValue ?? 0;
    const rawMax = typeof status.stepProgressMax === 'object' && status.stepProgressMax !== null ? status.stepProgressMax[step.id] : status.stepProgressMax ?? status.stepTarget ?? step.expected?.runs;
    const value = rawValue && typeof rawValue === 'object' ? rawValue.value ?? rawValue.current : rawValue;
    const max = rawMax && typeof rawMax === 'object' ? rawMax.max ?? rawMax.total : rawMax;
    if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(max)) || Number(max) <= 0) return null;
    return { value: Math.max(0, Math.min(Number(max), Number(value))), max: Number(max) };
  };
  const blockerChain = (blocked, live) => {
    const start = blocked?.fact; if (!start) return [];
    try {
      const reach = computeReach(model, live); const chain = []; const seen = new Set();
      const visit = (fact) => {
        if (!fact || seen.has(fact)) return; seen.add(fact);
        const entry = reach.get?.(fact); const parents = entry?.parents || reach.parents?.get?.(fact) || [];
        for (const parent of parents) if (!factSatisfied(model, live, parent)) visit(parent);
        chain.push(fact);
      };
      visit(start); return chain.length > 1 ? chain.slice(-4) : [];
    } catch { return []; }
  };
  const renderExecutor = () => {
    const status = state.executorStatus || {}; const phase = status.phase || 'idle'; const locked = isExecutionLocked(phase);
    const phaseNode = planPanel.querySelector('#fr-executor-phase'); const messageNode = planPanel.querySelector('#fr-executor-message'); const progress = planPanel.querySelector('#fr-executor-progress');
    const totalSteps = Number(status.totalSteps) || state.resolvedQueue.steps.length || 0; const completedSteps = Number(status.completedSteps) || 0;
    const running = state.resolvedQueue.steps.find((step) => step.id === status.runningStepId);
    const phaseText = phase[0]?.toUpperCase() + phase.slice(1);
    phaseNode.textContent = phaseText; messageNode.textContent = status.message || (phase === 'waiting' ? 'Waiting for a runnable step.' : '');
    progress.max = Math.max(1, totalSteps); progress.value = Math.min(progress.max, completedSteps);
    const runButton = shell.queueControls.querySelector('#fr-run'); const resumeButton = shell.queueControls.querySelector('#fr-resume'); const stopButton = shell.queueControls.querySelector('#fr-stop'); const clearButton = shell.queueControls.querySelector('#fr-clear');
    runButton.disabled = !state.resolvedQueue.steps.length || locked;
    stopButton.disabled = !locked; resumeButton.hidden = phase !== 'waiting';
    clearButton.disabled = !state.queueGoals.length || locked;
    clearButton.title = locked ? 'Clear queue when execution stops' : 'Clear queue'; clearButton.setAttribute('aria-label', clearButton.title);
    for (const button of shell.panels.skills.querySelectorAll?.('[data-start-action]') || []) button.disabled = locked;
    const launcherLabel = shell.launcher.querySelector?.('#fr-launcher-label');
    if (launcherLabel) launcherLabel.textContent = phase === 'running'
      ? `Companion · ${Math.min(totalSteps, completedSteps + (running ? 1 : 0))}/${totalSteps}`
      : phase === 'waiting' ? 'Companion · waiting' : phase === 'complete' ? 'Companion · queue done' : phase === 'error' ? 'Companion · queue stopped' : 'Companion';
    shell.launcher.dataset.state = phase === 'error' ? 'error' : 'ready';
    const compactPhase = shell.compactStrip.querySelector('#fr-compact-phase'); const compactMessage = shell.compactStrip.querySelector('#fr-compact-message'); const compactProgress = shell.compactStrip.querySelector('#fr-compact-progress'); const compactStart = shell.compactStrip.querySelector('#fr-compact-start'); const compactResume = shell.compactStrip.querySelector('#fr-compact-resume'); const compactStop = shell.compactStrip.querySelector('#fr-compact-stop');
    compactPhase.textContent = phaseText; compactMessage.textContent = messageNode.textContent;
    compactProgress.max = Math.max(1, totalSteps); compactProgress.value = Math.min(compactProgress.max, completedSteps);
    compactStart.hidden = !state.queueGoals.length || locked; compactStart.disabled = !state.resolvedQueue.steps.length;
    compactResume.hidden = phase !== 'waiting'; compactResume.disabled = !state.resolvedQueue.steps.length; compactStop.hidden = !locked; compactStop.disabled = !locked;
  };
  const stepStatus = (step, live, status) => {
    if (status.stepStatuses?.[step.id] === 'done') return 'done';
    if (status.stepStatuses?.[step.id] === 'running') return 'running';
    if (step.kind === 'manual') return 'waiting on you';
    const blocker = liveBlocker(model, live, step); return blocker ? `blocked: ${factLabel(blocker)}` : 'ready';
  };
  const planNum = (value) => Number(value) || 0;
  const planQtyText = (value) => { const n = planNum(value); if (Number.isInteger(n)) return String(n); return n < 1 ? n.toFixed(2) : n.toFixed(1); };
  // The item a step drives toward: its item-quantity stop, else its largest whole output.
  const stepPrimaryOutput = (step) => {
    const produces = step.expected?.produces || {};
    if (step.stop?.type === 'itemQty' && step.stop.itemId != null && produces[step.stop.itemId] != null) return step.stop.itemId;
    let best = null; let bestQty = 0;
    for (const [id, qty] of Object.entries(produces)) { if (id === 'gold') continue; const q = planNum(qty); if (q >= 1 && q > bestQty) { best = id; bestQty = q; } }
    return best;
  };
  const stepYieldHtml = (step) => {
    if (step.kind === 'manual') return '';
    const parts = []; const runs = planNum(step.expected?.runs);
    if (runs > 1) parts.push(`<span class="data">\u00d7${escapeHtml(String(runs))}</span>`);
    const primary = stepPrimaryOutput(step);
    if (primary) parts.push(`\u2192 <span class="data">${escapeHtml(planQtyText(step.expected?.produces?.[primary]))}</span> ${escapeHtml(labelFor(items, primary))}`);
    else if (planNum(step.expected?.produces?.gold)) parts.push(`\u2192 <span class="data">${escapeHtml(planQtyText(step.expected.produces.gold))}</span> gold`);
    return parts.join(' ');
  };
  const stepInputsHtml = (step) => {
    const consumes = step.expected?.consumes || {};
    const entries = Object.entries(consumes).filter(([id, qty]) => id !== 'gold' && planNum(qty) > 0);
    if (!entries.length) return '';
    return `needs ${entries.map(([id, qty]) => `<span class="data">${escapeHtml(planQtyText(qty))}</span> ${escapeHtml(labelFor(items, id))}`).join(' \u00b7 ')}`;
  };
  renderPlan = () => {
    const result = state.resolvedQueue; const live = liveState(); const status = state.executorStatus || {}; const locked = isExecutionLocked(status.phase); const labels = Object.fromEntries(state.queueGoals.map((entry) => [entry.id, targetLabel(entry.target)]));
    const firstBlocked = result.targets.findIndex((entry) => !entry.ok);
    const targetRows = state.queueGoals.map((goal, index) => {
      const entry = result.targets[index]; const queuedBehind = !entry && firstBlocked >= 0 && index > firstBlocked; const blocked = entry?.blocked; const label = labels[goal.id] || targetLabel(goal.target);
      const chain = blocked ? blockerChain(blocked, live) : [];
      const statusBadge = queuedBehind ? '<span class="badge warning">queued behind blocked target</span>' : entry?.ok ? '<span class="badge signal">ready</span>' : entry ? '<span class="badge danger">blocked</span>' : '<span class="badge">queued</span>';
      const blocker = blocked ? `<p class="banner warning">Blocked: ${escapeHtml(blocked.fact || '')}${blocked.reason ? ` · ${escapeHtml(blocked.reason)}` : ''}${chain.length ? `<br>Prerequisite chain: ${escapeHtml(chain.map(factLabel).join(' → '))}` : ''}</p>` : queuedBehind ? '<p class="banner warning">Not planned: queued behind the blocked target above.</p>' : '';
      const remove = !locked ? `<button class="icon-button" type="button" data-queue-remove="${escapeHtml(goal.id)}" aria-label="Remove ${escapeHtml(label)}" title="Remove target">${ICONS.remove}</button>` : '';
      return `<section class="queue-plan" data-target-index="${index}" data-queued-behind-blocked="${queuedBehind}"><div class="queue-plan-top"><h3>${escapeHtml(label)} ${statusBadge}</h3>${remove}</div>${blocker}</section>`;
    }).join('');
    const rows = (result.steps || []).map((step) => {
      const current = stepStatus(step, live, status); const per = result.perStep?.find((entry) => entry.id === step.id); const depManual = current !== 'done' && step.kind !== 'manual' ? dependencyManual(step, result.steps, status) : null;
      const eta = depManual ? `after ${depManual.label || depManual.id}` : current === 'running' && Number(status.stepRemainingMs ?? step.expected?.ms) > 0 ? `about ${formatDuration(status.stepRemainingMs ?? step.expected?.ms)} left` : per ? `~${formatDuration(Math.max(0, Number(per.endMs) - Number(per.startMs)))}` : '';
      const anchor = locked && Number.isFinite(Number(state.queueStartedAt)) ? Number(state.queueStartedAt) : Date.now(); const readyAt = step.kind === 'manual' ? formatFinishTime(result.readyAt?.[step.id] || 0, anchor) : null; const progressState = stepProgress(step, status); const progressMarkup = progressState ? `<progress class="step-progress" max="${escapeHtml(progressState.max)}" value="${escapeHtml(progressState.value)}" aria-label="${escapeHtml(step.label || step.id)} progress"></progress>` : '';
      const detailBits = [stepYieldHtml(step), `${escapeHtml(eta)}${step.kind === 'manual' ? ` \u00b7 ready for you at ~${escapeHtml(readyAt)}` : ''}`].filter(Boolean).join(' \u00b7 ');
      const inputsHtml = current.startsWith('blocked') ? stepInputsHtml(step) : '';
      return `<li class="record-row plan-step" data-step-id="${escapeHtml(step.id)}"><div class="record-top"><strong>${escapeHtml(step.label || actionName(actionFor(step.skillId, step.actionId)) || step.id)}</strong><div class="badges"><span class="badge">${escapeHtml(step.purpose || 'goal')}</span><span class="badge" data-status="${escapeHtml(current)}">${escapeHtml(current)}</span></div></div>${detailBits ? `<p class="step-detail">${detailBits}</p>` : ''}${inputsHtml ? `<p class="step-inputs">${inputsHtml}</p>` : ''}${progressMarkup}${step.kind === 'manual' ? `<div class="instruction-card"><strong>Waiting for you</strong><p>${escapeHtml(step.instruction || step.label || 'Complete this step in the game.')}</p></div>` : ''}</li>`;
    }).join('');
    const totals = state.queueGoals.length ? `<p class="queue-total data" id="fr-queue-total">Optimistic: ${escapeHtml(formatDuration(result.optimisticMs || 0))} · Scheduler-faithful: ${escapeHtml(formatDuration(result.schedulerMs || 0))}</p>` : '';
    const infeasibility = result.infeasibility ? `<p class="banner warning" role="status">${ICONS.warning}<span>Simulation warning: ${escapeHtml(result.steps.find((step) => step.id === result.infeasibility.stepId)?.label || result.infeasibility.stepId || 'unknown step')} · ${escapeHtml(result.infeasibility.reason || 'infeasible')}</span></p>` : '';
    planPanel.querySelector('#fr-plan-result').innerHTML = state.queueGoals.length ? `${targetRows}${totals}${infeasibility}<h3>Timeline</h3><ol class="record-list">${rows || '<li class="empty">No steps required; targets are already satisfied.</li>'}</ol>` : '<div class="empty">Add a target to begin a queue.</div>';
    renderExecutor();
  };
  const targetActionLabel = (target) => actionName(actionFor(target.skillId, target.actionId) || (target.skillId === 'agility' ? (model.agilityCourses || []).find((course) => course.id === target.actionId) : target.skillId === 'cartography' ? (model.maps || []).find((map) => map.id === target.actionId) : null));
  const targetLabel = (target) => { if (!target) return 'Target'; if (target.type === 'item' || target.type === 'item-gain') return `${target.type === 'item-gain' ? 'Gain' : 'Reach'} ${target.qty ?? target.gain} ${labelFor(items, target.itemId)}`; if (target.type === 'level') return `${skillNames[target.skillId] || target.skillId} level ${target.level}`; if (target.type === 'xp') return `${skillNames[target.skillId] || target.skillId} XP ${target.xp}`; if (target.type === 'action') return `${targetActionLabel(target)} · ${target.runs ? `${target.runs} runs` : `${target.minutes} minutes`}`; if (target.type === 'unlock') return `Unlock ${factLabel(target.fact)}`; return `${target.amount} gold`; };

  const executor = createDirectExecutor(api, { liveBlocker: (stateSnapshot, step) => liveBlocker(model, stateSnapshot, step), factSatisfied: (stateSnapshot, fact) => factSatisfied(model, stateSnapshot, fact), onUpdate(status) { state.executorStatus = status; renderPlan?.(); } });
  const runQueue = () => { if (isExecutionLocked(state.executorStatus?.phase)) return; refreshQueue(); if (state.resolvedQueue.steps.length) { state.queueStartedAt = Date.now(); renderPlan(); executor.run(state.resolvedQueue.steps); } };
  const resumeQueue = () => { if (state.executorStatus?.phase !== 'waiting') return; refreshQueue(); if (state.resolvedQueue.steps.length) { state.queueStartedAt ??= Date.now(); executor.run(state.resolvedQueue.steps); } };
  const stopQueue = () => { state.queueStartedAt = null; executor.stop(); };
  shell.queueControls.querySelector('#fr-run').addEventListener('click', runQueue); shell.queueControls.querySelector('#fr-resume').addEventListener('click', resumeQueue); shell.queueControls.querySelector('#fr-stop').addEventListener('click', stopQueue); shell.queueControls.querySelector('#fr-clear').addEventListener('click', () => { if (isExecutionLocked(state.executorStatus?.phase)) return; state.queueGoals = []; state.resolvedQueue = { steps: [], targets: [] }; state.queueStartedAt = null; persistQueue(); renderPlan(); });
  shell.compactStrip.querySelector('#fr-compact-start').addEventListener('click', runQueue); shell.compactStrip.querySelector('#fr-compact-resume').addEventListener('click', resumeQueue); shell.compactStrip.querySelector('#fr-compact-stop').addEventListener('click', stopQueue);
  planPanel.addEventListener('click', (event) => { const remove = event.target.closest?.('[data-queue-remove]'); if (!remove || isExecutionLocked(state.executorStatus?.phase)) return; const index = state.queueGoals.findIndex((goal) => goal.id === remove.dataset.queueRemove); if (index < 0) return; state.queueGoals.splice(index, 1); persistQueue(); refreshQueue(); renderPlan(); });

  const restore = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(QUEUE_STORAGE_KEY) || 'null');
      if (Array.isArray(parsed?.goals)) {
        const seenIds = new Set();
        for (const entry of parsed.goals) {
          if (!entry || typeof entry !== 'object' || !validTarget(entry.target)) continue;
          const proposed = typeof entry.id === 'string' && entry.id.trim() ? entry.id : `plan-${state.nextPlanId++}`;
          const id = seenIds.has(proposed) ? `plan-${state.nextPlanId++}` : proposed;
          seenIds.add(id); state.queueGoals.push({ id, target: entry.target });
        }
        const next = Number(parsed.nextPlanId); if (Number.isInteger(next) && next > 0) state.nextPlanId = Math.max(state.nextPlanId, next);
      }
    } catch { /* optional */ }
    refreshQueue();
  };
  const restoreAndRender = () => { restore(); renderItemList(); renderItemDetail(); renderSkillTable(); renderPlan(); };
  updateTargetFields(); restoreAndRender();
  return { model, indexedModel: model, datasets, indexes, state, executor, renderItemList, renderItemDetail, renderSkillTable, renderPlan, refreshQueue };
}

export async function fetchModel(fetchRef) {
  const response = await fetchRef('/companion/data/model.json');
  if (!response?.ok) throw new Error(`model.json returned HTTP ${response?.status ?? 'unknown'}`);
  try { return await response.json(); } catch (error) { throw new Error(`model.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
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
    const model = await fetchModel(fetchRef);
    const app = createApplication(shell, model, api);
    return { shell, app, api, model, datasets: model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = message.includes('did not become available');
    shell.showError(timeout ? 'Companion connection timed out' : 'Companion data could not load', message);
    return { shell, app: null, api: null, error };
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') queueMicrotask(() => { void bootOverlay(); });
