import { indexModel, liveBlocker, factSatisfied } from './engine/model.js';
import { computeReach } from './engine/closure.js';
import { resolveQueue } from './engine/queue.js';
import { createDirectExecutor } from './executor.js';
import { levelForXp } from './engine/formulas.js';

export const DATA_FILES = Object.freeze([['model', 'model.json']]);

const HOST_ID = 'fractured-realms-companion';
const POSITION_STORAGE_KEY = 'fractured-realms-companion.positions.v1';
const QUEUE_STORAGE_KEY = 'fractured-realms-companion.queue.v1';
const TAB_IDS = Object.freeze(['items', 'skills', 'plan']);
const LIST_LIMIT = 120;
const SEARCH_LIMIT = 240;

const BRAND_MARK = '<img class="brand-mark" src="data:image/webp;base64,UklGRvYOAABXRUJQVlA4TOkOAAAvX8AXECq70fY/cuRMMJfBUXmwKCyttdZaazbFag2NwQzUzGB0q9ECilrmhLpB94C4/lOYvwBQ46xLC8XxqU0ZAKurxl6TPnxqMRnQXXdTOG/9Xwpblwhqc6DwtpoihEuA3gawEazFBFgFIoCzKExYR6+jQg6UKWiVAesfACx4tJcmvctgawNYCwFQrUmZAkKhXGZwyt4c2qVCCkyHCWhNJEAZwKmhDmVcVME/CzVUvmYADEBLV25t26rrzHWvDF05dRFuxJFKMMQ/NDMzsyQzUy+PtrZtZ2srBzO3jWXbrJdtY3Pa9hy2kjocSZqkaX58f9TU0zqQUoBs27Rd5Si2bdu2bdu2befbiG3btm0+xHo69+y194AoyUpdCU8uLr41oJH9AriLMphw1p34OGOfbcI5l/dbBrKjXrwDNYMfVENoCkWS493G1lKz+ZpT35dbygoawdTJdsGRfsnHCyM6M4UawvBb9gBHxhbwGjskZ1roalEuFNvVbW2zOQsouQpXMuHc1oxr0RIitWmmtgeG7RIss1Se19YQNqo4hHILpYAxtsmVLTFZUYwaIV+JfNyan6/pWCpiS2rFs/kzkTPzwSQbDqI6tLKvgkauzFL5t71sRHFhSTTAxlwPlFjZmrlYL1SEEFNchC8mDGgkTyaVtG5j+2pOJHNnvwzXNlxE81G4qETEmJWaA2OfS6rMWmV5WwPYsGCBD2AhWWKqEOQIlZXPlWbhYvhAcVGQC5vfunMjz+uTJGmyGBpJ5jRzTUfTeHMjQkWGC2tEPiqxerQyz6bXOoJAoSlpY7IB44jIRdWI3eZ/6XJezb/J9rcrBZwN75Ajq7XRaX4AEZGLqKQBDaThctoIFdar+MPXGRNpoUjKZsO4lNlf61OwUI8iIvJR/dsqQh35UAahZvAdb9FD3Fq3r+FYTthBiMyWuidRn23Io6AQhY8aMR9fbmiJiezykhQahjQ9UU+/nEWeLTaTmwgjW4L6Ue6XqMcA6j08XBsX61mZ51ww5GRP39jeCDbiZ3nkDeN8caDKy2C1tZxc5HuoULiIQV3XhQA+InMO+gHIpKnRlX01Vod9x8brwoN3i8yWUxwGBWfG8blxRNSFADq8t4m8RD4KDc7j1+SerA9BIfmtXEQiJbBI1HLL1ZUGBfMojRphwwpRguE5q2rvdCVXmC7FwwiBRhQC/jop8qMrrTdQFhmosFKQD+LEmLCwKfARMDUGHBP5VFqpJC+ZMxlba6wXZcN+qBA+oinS0d8KQFZbaQlmgaegLFNuKbk7++L8ttSj6ro+FizAzY1inEoPGshZ3Sw1DBX54SK26DodDRaYkEiaaG0UxDqoJlQOFiFgZhTVCUSdClE972TdM+Hs9MpeNfmGgZi/YRSR5gMFJlRMvVofBRM3QuXkmwcEobCIY1FN9V/no+pwJ3ub1m3spH8jyudiQz7wg4VmVEfMBwp0RIKFOBSooVzCctPV+eiHXVxI1ALqONzRDepVl8DtBR6kx6J5vaEQDc1s0fkAISAfLJD1FrXxCoLCwv0zhf15T7JHYIqNhQo1F3m33HTRXiyd2YQHC+aVJv6Q2tWv63RMzFfJhrRQpymIQbiSw1k8uVdeNoup7u8b8dV6fmn7MkKulzEvWF0rzwdhoQKd11NvtBBTRzXTFsH015Qz26dTSO7MPrh2SEUqxjh2xKN55WxSidLvNsbCcb3rirHYZXlz62ZOQkQs8DG11077FUqacpWZcK4tfc1eIVD9lNLh9c1t7rmGiRQZI41FNJqHcuLmPWRrAVGC4Wc2k5dBRjHkNGhM+iGhTyAmfMRQmg8KFRew0HTRdKJBqJx8q0htPYDyIARBhxu4WMtfqCl2KNBKUDfK4yaDBWzXxXwVrUMloUfazF+Di/s/hSvrwwwbNoioYkHtgY2+/WDIKWhezYPvLMaixZjmI0F7N6gnzoUSAJgWzupeOAskYRps6SvbGgoXCamqmqIUhIBvdnYTN2fnfrYkUA7FEuNcTi4cNZwwoIm2Sf72S8sVjWUWG7YZsmH3LBcyqqpKVH+o003sjGNlnkuq2GGgBLa0U/c9zM27WubzhBkNwOhextZ5j2xNcqGjT6cDSdTQLuDzhNbqv3N5L8OFJOszw0X0eL/KR5nQdTrQboSHe+rCvkoGxb5rcil3B7VgVuw8EyrGG4q4jtPZJLPe+XSfC3X3U2stT9I3DvYuKedzIA2n9koSyyw1dNdY6q8VtmEuWMixKYGOB+Aot+aV8/o7fV9xNimnzHMJJUmDvSRpmXd5ciKiJZqLhlZZriLpMfP0ORdWXnm/n+/bZwh/v6LqTvpveKh8PgEu59fklllp5spc7897HyshoUeAz7HHblf1gbaGuNi3GKfS9w25uy4a1wfaMldaSe2u4lAu6VtTSqsBTYl/ZoMiqmx0klhn74WUA8zey2Vbd5+EnB8L4tgWAv/3L1h07u1esF72xhWnAeDK9qVtVmvvr7mJDX2ZS+ghYhx7LB+FDamsH75zTB+jtDF11n23ObMuO7OXVg+h6yKX8wIAaLRoSGTllip+5GUW0nTJ7sKsOfvJV1q/mrrxZfal5+sn2Dc5bdvkjPPDJ+Lcfeoze++WhbNdSDnpPklKALDM5Yw2Wndv9j4+HNXWgLguKhcRPhKK6+FkP2eczd2344wGq1fL1YVoxK16xK6QGF9e4NO63VpjacOodbqxUzlk1RZf6Mi4dAuPaExdK629e9lnG3UPPt4v/PkS2yYnjl2B59s3ef0m6/PMs4usH0/9rCcD9CZYc3Ahu3PoA305x7hQcLdYHVhYhcV4oWcrLebtGyjc+ODlHP68E9ESeOCL+cy/LFYXHy/GlXOqlTnZvBIq7G+XBwBQP6pDft6cceF0Xk9Q0iSZVl5+b2bg/9fY3+UCx+4TXv3q59ve5RX/+yuq76b2G/9Po5RFDUArZQCg2lohN2u8t+YFISDb0U048Oq6zhXqG4rwO3v6v0lDeKB3clH110A+8Xq0NUR313zs5SxtHmr7/13Gvszhwi/hkudXcibLtFngfS1FzLLPhhUXPqj3Y9fHT8Wx/cQ4tp/w6m87dgXl//4Va65+OMaEiyejnKTNwRxAbrBHYFUt664xjw3dTTZAiImFWB5yfbRzllEdzkfN06dw+18H8pHa7I3q4s394Kn17OnLxuwASd9LPTlXXf2wv/j7W+zbgrJvCzz/LeLfb6i4/fEyeIJ8Fkw4r2VoYxqJDc7mp6RputzJdjWAF1hXxepC+F9XzoNVllsU+wRjGiqtNOAiH46aRRVx3+xUsJDD/GHNhuO8ufcdNX5pnGKDK9iXUtKlzqfPuVBzN/2f8Ptr7Ju8anmXF+7nl9Q/yV3Z7/CWBDLNo8AcOJfTnXOmw032+PPCvNyNllHpXIXPm5ObeQoAC11It2BONLm4fYm1vm6XN3I+nyf3ersRQymaQBzbjX+JSGhrRLQ2XDjCW3OTRbmr8TV48p/LDnFu45P8Fd+3z3F9/FRaXn/y6RrHXstpwsVj1vts2QSsmou1uUhk1h8Kdk9O3qy7NCTuvV8mzbQU6YGyXZZJJXXW2NzekEBM+nXcKgSgTum+obvvaW9ErB4rTJcyinAIXOXkK7ns7z75xH7/igWn3m4kleU0aB7iUHGA7GFDMoE7I7XFx3u+wESmXjYF7UAwfxsBmlLmzL9hC0VEXdcppWMCFpeory3Vf+5R7SdA5fVMuzVXU7OkWr0DTLj4jjb/3zXGhnQBOdgEBSLE/FUWykJGic2mavBd+CB2ng8LSoIQQHV60qQnN/zjYAA8A+AQ6dpdx6lc7uzzm1lEsSFTKGziA/XyRylz9KKwyEQFNu/l5llE3JT6EQP0Y4UgCBaz3FwT2AGpmKTBDFTO1XpcOPIof1iphQKPsLPNCCvxJ+g0dgGUwRUdzuTJOfXZoX6c0A94MBBjZLKrW7RmboNSunUzj+KYg0JFbEMVJzhYEgY4mEcNxU5FRfiYPWNp9u4fUFEfe4OPG9WStMWZeZnNC3Nnv7+2w1lAkxtsS5U5HY0QY8KGNSLqD4po4631knE6rZYDBY8UjUMauydYwDiifvewSKrwS+D0vkp2HadyXNq+pGDIzaODfi1eR48jIubfysf8pabLKvqBaUxDLaEFH/36+Fld3yrm6y63MassSNsdOJXHE7lz3kjOFCjy1XPq1Loq/2mzxGwxX+hhsgF8RKGuikGQNKBaaU6aL4Ac3NjFXL5awQ/yiEKAEMhaq/qiVA0Kh0G4uL/SOrMPrhUCtV0fEwtUVMIay6PkKEK1lRpBAXkVdSEqcw7GoV5OvIpVb8LZLWm/bhYDs0XPvz+mS41KfyjKxlqr2Ceuy1DPUWVtA2UKETdFOQ0aRn3IoWEx43o+UChCPuXWukntA4VG8uLDZxFx4GV2+r9k3EQZFGoIjdjIx2gdZnE8UoKXG3Y2KUdSeBocGduz44iFgXh9Wmi7SLmIfTDcyJVCPt69pD47/xopMa6ca4Ymrau1xvVoCX9VVbx3rK6x0w8Qc9E7COf2YypX1oG1bMR/uoN+CIqS5+K+S+HO+hAs5AMq/ms0LKbcWn1y7tmL8MKW1L/mY7qmibIeBiV1LXStsC9XYwFxKl4PG/0IZEi63gKr+uj2bmBn/gdUMsYKa41mev4WUB0opNxaZaLcBAYF86gMtqqPhaKkZMOojdx8hIpT2ea0faR5IYppbElr+h+pugp3F/J1pVJp4rwcGbnVdmUeTNRjCqdGbBnbSHWiGPA7F+vx5CjefXSZuZIaoaTB5R3J4OJEHZQfyFqIW4n1Aa2DVZZKb9refygXqM9o6wilEtQpt5489ohsM3UtuS4sCla1CXFdvidgmkWCJaYKaevIpSbK8qPem9CngbqOYBdTBhyMk9ESht74IG0jua7Vs0nFd+e8EAJi9bCS1hHMc8C4kNWbG/tmbyh4CLkcivDsQraRvIZkB98g/GbOF/IZEwV7OLklW6jTbtFDY66+imQO09CauS5cAuNiQW0dwaSBM/uhlXyAaP41uJIziZrp7xeYKk80z8FqfMla5c2wkWzn/PI502ixydpEczDgTD5Jv79d3l08/9tx55YAAA==" alt="" aria-hidden="true">';

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
  top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14"/><path d="M12 20V9"/><path d="m7 13 5-5 5 5"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m13.5 6.5 3 3"/></svg>',
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
  /* Semantic roles keep components independent from palette names. */
  --fr-surface-canvas: var(--fr-neutral-1000);
  --fr-surface-panel: var(--fr-neutral-950);
  --fr-surface-control: var(--fr-neutral-900);
  --fr-surface-hover: var(--fr-neutral-800);
  --fr-border-subtle: var(--fr-neutral-800);
  --fr-border-control: var(--fr-neutral-700);
  --fr-text-primary: var(--fr-neutral-100);
  --fr-text-secondary: var(--fr-neutral-300);
  --fr-text-disabled: var(--fr-neutral-300);
  --fr-state-signal: var(--fr-harbor-400);
  --fr-state-signal-surface: var(--fr-harbor-950);
  --fr-state-warning: var(--fr-brass-400);
  --fr-state-warning-surface: var(--fr-brass-950);
  --fr-state-danger: var(--fr-danger-400);
  --fr-state-danger-surface: var(--fr-danger-950);
  --fr-state-success: var(--fr-success-400);
  --fr-state-success-surface: var(--fr-success-950);
  --fr-space-control: var(--fr-s3);
  --fr-space-pane: var(--fr-s4);
  --fr-pane-rail: 16.5rem;
  --fr-copy-measure: 68ch;
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
.tabbar { display: flex; border-bottom: 1px solid var(--fr-neutral-800); background: var(--fr-neutral-950); }
.tabs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  gap: var(--fr-s1);
  padding: var(--fr-s1) var(--fr-s3) 0;
}
.queue-controls { flex: 0 0 auto; display: flex; align-items: center; gap: var(--fr-s1); padding: 0 var(--fr-s3); }
.plan-spinner { flex: 0 0 auto; display: inline-block; width: 0.875rem; height: 0.875rem; border-radius: 999px; border: 2px solid var(--fr-neutral-700); border-top-color: var(--fr-harbor-400); animation: spin 0.7s linear infinite; }
.plan-spinner[hidden] { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
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
.badge.success { border-color: var(--fr-success-400); background: var(--fr-success-950); color: var(--fr-success-400); }
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
.button:focus-visible, .icon-button:focus-visible, .launcher:focus-visible, .tab:focus-visible, .control:focus-visible, .search-control:focus-within, .item-row:focus-visible, .combobox-option:focus-visible, #fr-plan-compose-toggle:focus-visible, #fr-plan-compose-cancel:focus-visible, .compact-strip .icon-button:focus-visible, .executor-actions .button:focus-visible, #fr-clear-confirmation button:focus-visible {
  outline: 2px solid var(--fr-harbor-400);
  outline-offset: 2px;
}
.skills-view { padding: var(--fr-s4); }
.skills-toolbar { max-width: 24rem; margin-bottom: var(--fr-s2); }
.skill-action-status { min-height: 1.25rem; margin: 0 0 var(--fr-s3); color: var(--fr-neutral-300); font-size: 0.75rem; }
.skill-action-status[data-state="error"] { color: var(--fr-brass-400); }
.form-error { margin: var(--fr-s2) 0 0; color: var(--fr-danger-400); font-size: 0.75rem; }
.table-wrap { overflow: auto; border: 1px solid var(--fr-neutral-800); border-radius: var(--fr-radius-sm); }
.table-wrap table { min-width: 44rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
caption { padding: var(--fr-s3); color: var(--fr-neutral-300); text-align: left; }
th, td { padding: var(--fr-s2) var(--fr-s3); border-bottom: 1px solid var(--fr-neutral-800); text-align: left; vertical-align: middle; }
th { position: sticky; top: 0; background: var(--fr-neutral-950); color: var(--fr-neutral-300); font-size: 0.75rem; font-weight: 650; }
tbody tr:last-child td { border-bottom: 0; }
.cell-title { display: block; color: var(--fr-neutral-100); font-weight: 600; }
.cell-id { display: block; margin-top: var(--fr-s1); color: var(--fr-neutral-300); font-size: 0.6875rem; }
.plan-view { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.plan-view > * { min-width: 0; }
.plan-toolbar { flex: 0 0 auto; position: relative; display: flex; align-items: center; gap: var(--fr-s2); min-height: 3.5rem; padding: var(--fr-s3) var(--fr-space-pane); border-bottom: 1px solid var(--fr-border-subtle); background: var(--fr-surface-panel); }
.plan-toolbar h2 { flex: 0 0 auto; }
.plan-toolbar-summary { min-width: 0; color: var(--fr-text-secondary); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-toolbar-actions { display: flex; align-items: center; gap: var(--fr-s1); margin-left: auto; }
.plan-toolbar-actions .button { white-space: nowrap; }
#fr-clear-confirmation { display: flex; align-items: center; gap: var(--fr-s1); margin-left: auto; padding: var(--fr-s1) 0; color: var(--fr-text-secondary); font-size: 0.75rem; }
#fr-clear-confirmation strong { margin-right: var(--fr-s1); color: var(--fr-text-primary); font-weight: 600; }
.plan-composer { flex: 0 0 auto; padding: var(--fr-space-pane); border-bottom: 1px solid var(--fr-border-subtle); background: var(--fr-surface-canvas); }
.plan-composer[hidden] { display: none; }
.plan-form { display: flex; flex-wrap: wrap; align-items: end; gap: var(--fr-s2) var(--fr-s3); }
.plan-form .field { flex: 1 1 9rem; }
.plan-form .button { flex: 0 0 auto; }
.plan-form-actions { display: flex; gap: var(--fr-s1); }
.field-help { flex-basis: 100%; margin: 0; color: var(--fr-text-secondary); font-size: 0.6875rem; line-height: 1.35; }
#fr-plan-result { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; padding: var(--fr-space-pane); }
#fr-plan-result .empty { color: var(--fr-text-secondary); font-size: 0.8125rem; line-height: 1.5; }
.plan-queue-list { margin: 0; padding: 0; list-style: none; }
.queue-plan { padding: var(--fr-s3) 0; }
.queue-plan + .queue-plan { margin-top: var(--fr-s2); }
.queue-plan[data-active="true"] { border-left: 2px solid var(--fr-state-signal); margin-left: calc(-1 * var(--fr-s3)); padding-left: var(--fr-s3); }
.queue-plan-top { display: flex; align-items: center; gap: var(--fr-s2); min-width: 0; }
.queue-plan-index { flex: 0 0 auto; color: var(--fr-text-secondary); font-size: 0.75rem; }
.queue-plan-title { min-width: 0; flex: 1 1 auto; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8125rem; font-weight: 650; }
.queue-plan-top .badge { flex: 0 0 auto; }
.queue-plan-meta { flex: 0 0 auto; color: var(--fr-text-secondary); font-size: 0.75rem; white-space: nowrap; }
.queue-plan-actions { flex: 0 0 auto; display: flex; flex-wrap: nowrap; align-items: center; gap: var(--fr-s1); margin-left: auto; }
.queue-plan-actions .icon-button { width: var(--fr-control); height: var(--fr-control); }
.queue-plan-actions .icon-button.danger { color: var(--fr-danger-400); }
.queue-plan[data-state="done"] .queue-plan-title { color: var(--fr-state-success); }
.queue-plan[data-state="blocked"] .queue-plan-title, .queue-plan[data-state="waiting"] .queue-plan-title { color: var(--fr-state-warning); }
.queue-plan .badge[data-state="planned"] { border-color: var(--fr-harbor-800); color: var(--fr-state-signal); }
.queue-plan .badge[data-state="done"] { border-color: var(--fr-success-400); background: var(--fr-state-success-surface); color: var(--fr-state-success); }
.queue-plan .badge[data-state="blocked"], .queue-plan .badge[data-state="waiting"] { border-color: var(--fr-brass-700); background: var(--fr-state-warning-surface); color: var(--fr-state-warning); }
.queue-plan-proximity, .target-explanation { margin: var(--fr-s2) 0 0 1.75rem; color: var(--fr-text-secondary); font-size: 0.75rem; line-height: 1.4; overflow-wrap: anywhere; }
.queue-steps { margin: var(--fr-s2) 0 0 1.75rem; padding: 0; list-style: none; }
.plan-step { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr) auto; align-items: start; gap: var(--fr-s2); padding: var(--fr-s2) 0; }
.plan-step + .plan-step { border-top: 1px solid var(--fr-border-subtle); }
.step-marker { width: 1.25rem; height: 1.25rem; display: inline-grid; place-items: center; border: 1px solid var(--fr-border-control); border-radius: 999px; color: var(--fr-text-secondary); font-size: 0.625rem; }
.plan-step[data-state="running"] .step-marker { border-color: var(--fr-state-signal); color: var(--fr-state-signal); }
.plan-step[data-state="done"] .step-marker { border-color: var(--fr-success-400); color: var(--fr-state-success); }
.plan-step[data-state="blocked"] .step-marker, .plan-step[data-state^="manual"] .step-marker { border-color: var(--fr-brass-700); color: var(--fr-state-warning); }
.step-content { min-width: 0; }
.step-content > strong { display: block; overflow-wrap: anywhere; line-height: 1.3; font-weight: 600; }
.step-detail { display: block; margin-top: 0.125rem; color: var(--fr-text-secondary); font-size: 0.6875rem; line-height: 1.4; overflow-wrap: anywhere; }
.step-state { display: inline-block; margin-top: 0.125rem; color: var(--fr-text-secondary); font-size: 0.6875rem; }
.plan-step[data-state="running"] .step-state { color: var(--fr-state-signal); }
.plan-step[data-state="blocked"] .step-state, .plan-step[data-state^="manual"] .step-state { color: var(--fr-state-warning); }
.step-timing { flex: 0 0 auto; color: var(--fr-text-secondary); font-size: 0.6875rem; line-height: 1.35; text-align: right; white-space: nowrap; }
.instruction-card { margin-top: 0.125rem; color: var(--fr-state-warning); font-size: 0.6875rem; line-height: 1.4; overflow-wrap: anywhere; }
.step-progress { grid-column: 1 / -1; width: 100%; height: 0.5rem; margin-top: var(--fr-s2); overflow: hidden; border: 0; border-radius: 999px; background: var(--fr-neutral-800); accent-color: var(--fr-state-signal); }
.step-progress-text { grid-column: 1 / -1; margin-top: 0.125rem; color: var(--fr-text-secondary); font-size: 0.6875rem; }
.step-progress::-webkit-progress-bar, .executor-progress::-webkit-progress-bar { background: var(--fr-neutral-800); }
.step-progress::-webkit-progress-value, .executor-progress::-webkit-progress-value { background: var(--fr-state-signal); }
.executor-progress { width: 100%; height: 0.375rem; margin-top: var(--fr-s2); overflow: hidden; border: 0; border-radius: 999px; background: var(--fr-neutral-800); accent-color: var(--fr-state-signal); }
.plan-overview { display: grid; gap: var(--fr-s1); margin: var(--fr-s5) 0 var(--fr-s2); padding-top: var(--fr-s4); border-top: 1px solid var(--fr-border-subtle); }
.plan-overview div { display: flex; justify-content: space-between; gap: var(--fr-s2); }
.plan-overview dt { color: var(--fr-text-secondary); font-size: 0.75rem; }
.plan-overview dd { margin: 0; }
.plan-overview-presence { margin: var(--fr-s3) 0 0; color: var(--fr-text-secondary); font-size: 0.75rem; line-height: 1.45; }
.plan-manual-list { margin-top: var(--fr-s4); border-top: 1px solid var(--fr-border-subtle); }
.plan-manual-list h3 { margin: 0; padding: var(--fr-s2) 0; font-size: 0.8125rem; }
.plan-manual-list ul { margin: 0; padding: 0; list-style: none; }
.manual-list-row { display: flex; justify-content: space-between; gap: var(--fr-s2); padding: var(--fr-s2) 0; border-top: 1px solid var(--fr-border-subtle); color: var(--fr-text-secondary); font-size: 0.75rem; }
.manual-list-row[data-state="manual-now"] { color: var(--fr-state-warning); }
.plan-edit-lock { margin: 0 0 var(--fr-s3); color: var(--fr-text-secondary); font-size: 0.75rem; }
.executor { flex: 0 0 auto; min-width: 0; padding: var(--fr-s3) var(--fr-space-pane); border-top: 1px solid var(--fr-border-subtle); background: var(--fr-surface-panel); }
.executor-status { min-width: 0; }
.executor-status strong { display: block; }
.executor-status p { min-width: 0; margin: var(--fr-s1) 0 0; color: var(--fr-text-secondary); font-size: 0.75rem; line-height: 1.4; overflow-wrap: anywhere; }
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
.panel[data-compact="true"] .tabbar,
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
.panel[data-compact="true"] .compact-strip p { display: block; min-width: 0; margin: 0; overflow: hidden; color: var(--fr-neutral-300); font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
.loading-line::after { content: ""; display: block; width: 35%; height: 100%; background: var(--fr-harbor-400); animation: loading 1.2s linear infinite; }
@keyframes loading { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
@media (prefers-reduced-motion: reduce) {
  .icon-button.attention, .plan-spinner { animation: none; }
  .loading-line::after { animation: none; width: 100%; opacity: 0.55; }
}
@media (max-width: 40rem) {
  .panel { width: calc(100vw - (2 * var(--fr-panel-gap))); height: min(78dvh, calc(100dvh - 5rem)); resize: vertical; }
  .queue-plan-top { flex-wrap: wrap; }
  .queue-plan-meta { order: 3; }
  .queue-plan-actions { margin-left: 1.75rem; }
  .items-layout { display: block; }
  .item-browser { height: 48%; border-right: 0; border-bottom: 1px solid var(--fr-neutral-800); }
  .detail { height: 52%; }
  .plan-form .field, .plan-form .button { flex-basis: 100%; }
  .skills-view, .detail { padding: var(--fr-s3); }
}
@media (max-width: 22rem) {
  .panel { border-radius: var(--fr-radius-md); }
  .tab { flex: 1 1 0; padding-inline: var(--fr-s2); }
  .toolbar { padding: var(--fr-s2); }
  .launcher-label { max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
@media (max-width: 40rem) {
  .plan-form .field, .plan-form-actions { flex-basis: 100%; }
  .plan-form-actions .button { flex: 1 1 0; }
}
@media (max-width: 22rem) {
  .plan-toolbar { flex-wrap: wrap; }
  .plan-toolbar-actions { width: 100%; margin-left: 0; }
  .plan-toolbar-actions .button { flex: 1 1 0; }
  .queue-plan-actions { margin-left: 0; }
  .plan-step { grid-template-columns: 1.5rem minmax(0, 1fr); }
  .step-timing { grid-column: 2 / -1; text-align: left; }
}

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
    html: '<strong id="fr-compact-phase"></strong><p id="fr-compact-message"></p><progress class="executor-progress" id="fr-compact-progress" max="1" value="0"></progress><div class="compact-actions"><span class="plan-spinner" id="fr-compact-spinner" aria-hidden="true" hidden></span><button class="icon-button accent" id="fr-compact-start" type="button" title="Start queue" aria-label="Start queue" hidden>' + ICONS.play + '</button><button class="icon-button" id="fr-compact-resume" type="button" title="Resume queue" aria-label="Resume queue" hidden>' + ICONS.resume + '</button><button class="icon-button danger" id="fr-compact-stop" type="button" title="Stop queue" aria-label="Stop queue">' + ICONS.stop + '</button></div>',
  });
  const queueControls = makeElement(documentRef, 'div', {
    class: 'queue-controls', role: 'group', 'aria-label': 'Plan execution',
    html: '<span class="plan-spinner" id="fr-queue-spinner" aria-hidden="true" hidden></span><button class="icon-button accent" id="fr-run" type="button" title="Start plan" aria-label="Start plan">' + ICONS.play + '</button><button class="icon-button" id="fr-resume" type="button" title="Resume plan" aria-label="Resume plan" hidden>' + ICONS.resume + '</button><button class="icon-button danger" id="fr-stop" type="button" title="Stop plan" aria-label="Stop plan" hidden>' + ICONS.stop + '</button>',
  });
  const tabbar = makeElement(documentRef, 'div', { class: 'tabbar' });
  tabbar.append(tabs, queueControls);
  panel.append(header, loading, error, tabbar, tabpanels, compactStrip);
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
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      setOpen(false, true);
    }
  });

  view?.addEventListener?.('resize', () => {
    const launcherRect = launcher.getBoundingClientRect();
    applyPosition(launcher, { left: launcherRect.left, top: launcherRect.top });
    if (!panel.hidden) fitPanel();
  });

  return { host, shadow, launcher, panel, header, identity, compactToggle, compactStrip, close, loading, error, tabs, tabbar, queueControls, tabButtons, panels, setOpen, setCompact, selectTab, showError };
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
  if (kind === 'level') return `${humanizeId(parts[0])} level ${parts[1]}`;
  return parts.length ? `${humanizeId(kind)}: ${humanizeId(parts.join(':'))}` : humanizeId(kind);
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
    if (target.type === 'use-stock') return typeof target.itemId === 'string' && Boolean(items[target.itemId]);
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
    composerOpen: false,
    lastAnnouncementKey: '',
  };
  const storage = documentRef.defaultView?.localStorage;
  const liveState = () => { try { return api.getState() || {}; } catch { return {}; } };
  const persistQueue = () => { try { storage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ goals: state.queueGoals, nextPlanId: state.nextPlanId })); } catch { /* optional */ } };
  const refreshQueue = () => {
    state.resolvedQueue = resolveQueue(model, liveState(), state.queueGoals.map((entry) => entry.target));
    return state.resolvedQueue;
  };

  // Off-thread planning. resolveQueue is a pure (model, snapshot, targets) -> result function that
  // costs ~90-460ms on the live model; on the main thread it froze the overlay over a running game.
  // Offload it to a module worker that imports the same served engine modules. Where Worker/Blob
  // URLs are unavailable (Node tests, restricted hosts) we plan synchronously instead, so results
  // and behavior are identical either way.
  const runtimeView = documentRef.defaultView;
  let planWorker = null;
  let planSeq = 0;
  let planLatest = 0;
  const planWaiters = new Map();
  const initPlanWorker = () => {
    const WorkerCtor = runtimeView?.Worker;
    const BlobCtor = runtimeView?.Blob ?? (typeof Blob === 'undefined' ? null : Blob);
    const urlApi = runtimeView?.URL?.createObjectURL ? runtimeView.URL : (typeof URL !== 'undefined' && URL.createObjectURL ? URL : null);
    if (!WorkerCtor || !BlobCtor || !urlApi) return null;
    try {
      const modelUrl = new URL('./engine/model.js', import.meta.url).href;
      const queueUrl = new URL('./engine/queue.js', import.meta.url).href;
      const source = [
        `import { indexModel } from ${JSON.stringify(modelUrl)};`,
        `import { resolveQueue } from ${JSON.stringify(queueUrl)};`,
        'let model = null;',
        'self.onmessage = (event) => {',
        '  const message = event.data || {};',
        '  if (message.type === "model") { model = indexModel(message.model || {}); return; }',
        '  if (message.type === "plan") {',
        '    let result = null; let error = null;',
        '    try { result = resolveQueue(model, message.snapshot, message.targets); }',
        '    catch (err) { error = err && err.message ? String(err.message) : String(err); }',
        '    self.postMessage({ type: "result", id: message.id, result, error });',
        '  }',
        '};',
      ].join('\n');
      const blobUrl = urlApi.createObjectURL(new BlobCtor([source], { type: 'text/javascript' }));
      const worker = new WorkerCtor(blobUrl, { type: 'module' });
      worker.onmessage = (event) => {
        const { id, result, error } = event.data || {};
        const settle = planWaiters.get(id);
        if (!settle) return;
        planWaiters.delete(id);
        if (!error && result) shell.host.dataset.planWorker = 'active';
        settle(error ? null : result);
      };
      worker.onerror = () => { planWorker = null; for (const settle of planWaiters.values()) settle(null); planWaiters.clear(); };
      worker.postMessage({ type: 'model', model: modelJson });
      return worker;
    } catch { return null; }
  };
  planWorker = initPlanWorker();

  // Delayed, quiet, indeterminate busy cue: shown only if a plan outlasts ~200ms, so the common
  // fast plan shows nothing and never flickers. Lives in the tab-bar queue controls (visible on
  // every tab) and the compact strip, so planning is signalled everywhere, not just the Plan tab.
  let planBusyTimer = null;
  const togglePlanBusy = (busy) => { for (const spinner of [shell.queueControls?.querySelector?.('#fr-queue-spinner'), shell.compactStrip?.querySelector?.('#fr-compact-spinner')]) if (spinner) spinner.hidden = !busy; if (busy) shell.queueControls?.setAttribute?.('aria-busy', 'true'); else shell.queueControls?.removeAttribute?.('aria-busy'); };
  const showPlanBusy = () => togglePlanBusy(true);
  const clearPlanBusy = () => { if (planBusyTimer != null) { clearTimeout(planBusyTimer); planBusyTimer = null; } togglePlanBusy(false); };
  const armPlanBusy = () => { if (planBusyTimer == null) planBusyTimer = setTimeout(() => { planBusyTimer = null; showPlanBusy(); }, 200); };

  // Resolve the current queue off-thread and adopt the latest result; superseded replies are
  // dropped so rapid reorders never apply a stale plan. Synchronous fallback when no worker.
  const planAsync = () => {
    if (!planWorker) { refreshQueue(); return Promise.resolve(state.resolvedQueue); }
    const targets = state.queueGoals.map((entry) => entry.target);
    const snapshot = liveState();
    const id = ++planSeq;
    planLatest = id;
    armPlanBusy();
    return new Promise((resolve) => { planWaiters.set(id, resolve); planWorker.postMessage({ type: 'plan', id, snapshot, targets }); }).then((result) => {
      if (id !== planLatest) return state.resolvedQueue;
      if (result && Array.isArray(result.steps)) state.resolvedQueue = result; else refreshQueue();
      clearPlanBusy();
      return state.resolvedQueue;
    });
  };
  let lastPlan = Promise.resolve();
  const afterPlan = (done) => { if (planWorker) { lastPlan = planAsync().then(done); } else { refreshQueue(); done(); lastPlan = Promise.resolve(); } return lastPlan; };

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
  detail.addEventListener('click', (event) => { const button = event.target.closest?.('[data-plan-item]'); if (!button) return; state.selectedPlanItemId = button.dataset.planItem; planKind.value = 'item'; planItem.value = items[state.selectedPlanItemId]?.label || state.selectedPlanItemId; updateTargetFields(); setComposerOpen(true, { focus: false }); shell.selectTab(2, false); planQty.focus?.(); planQty.select?.(); });
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
  planPanel.innerHTML = `<div class="plan-view"><div class="plan-toolbar" id="fr-plan-toolbar"><h2>Plan</h2><span id="fr-plan-toolbar-summary" class="plan-toolbar-summary"></span><div class="plan-toolbar-actions"><button class="button compact" id="fr-plan-compose-toggle" type="button" aria-expanded="false" aria-controls="fr-plan-composer">Add target</button><button class="button compact" id="fr-clear" type="button">${ICONS.clear} Clear all</button></div></div><section id="fr-plan-composer" class="plan-composer" aria-label="Add plan target"><form class="plan-form" id="fr-plan-form"><div class="field"><label for="fr-plan-target">Target type</label><select class="control" id="fr-plan-target"><option value="item">Reach item total</option><option value="item-gain">Gain items</option><option value="level">Reach skill level</option><option value="xp">Reach skill XP</option><option value="action">Run an action</option><option value="use-stock">Use current stock</option></select></div><div class="field" id="fr-plan-item-field"><label for="fr-plan-item">Desired item</label><div class="plan-combobox"><input class="control" id="fr-plan-item" type="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="fr-plan-options" aria-expanded="false" autocomplete="off" placeholder="Search item names"><div class="combobox-popover" id="fr-plan-options" role="listbox" hidden></div></div></div><div class="field" id="fr-plan-skill-field" hidden><label for="fr-plan-skill">Skill</label><select class="control" id="fr-plan-skill"></select></div><div class="field" id="fr-plan-action-field" hidden><label for="fr-plan-action">Action</label><select class="control" id="fr-plan-action"></select></div><div class="field" id="fr-plan-qty-field"><label for="fr-plan-qty" id="fr-plan-qty-label">Total quantity</label><input class="control data" id="fr-plan-qty" type="number" min="1" step="1" value="1" inputmode="numeric"></div><div class="field" id="fr-plan-mode-field" hidden><label for="fr-plan-action-mode">Measure by</label><select class="control" id="fr-plan-action-mode"><option value="runs">Runs</option><option value="minutes">Minutes</option></select></div><div class="plan-form-actions"><button class="button primary" id="fr-resolve-plan" type="submit">Add target</button><button class="button compact" id="fr-plan-compose-cancel" type="button">Cancel</button></div><p class="field-help" id="fr-plan-kind-help"></p></form><p class="form-error" id="fr-plan-form-error" role="status" hidden></p></section><div id="fr-plan-result" class="plan-queue" aria-label="Plan targets and steps"></div><div class="executor" aria-label="Plan execution"><div class="executor-status"><strong id="fr-executor-phase">Ready to run</strong><p id="fr-executor-message">Add a target to begin.</p><progress class="executor-progress" id="fr-executor-progress" max="1" value="0" aria-label="Plan progress"></progress></div></div><div id="fr-plan-announcer" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></div></div>`;
  const planForm = planPanel.querySelector('#fr-plan-form'); const planFormError = planPanel.querySelector('#fr-plan-form-error'); const planKind = planPanel.querySelector('#fr-plan-target'); const planItem = planPanel.querySelector('#fr-plan-item'); const planOptions = planPanel.querySelector('#fr-plan-options'); const planSkill = planPanel.querySelector('#fr-plan-skill'); const planAction = planPanel.querySelector('#fr-plan-action'); const planQty = planPanel.querySelector('#fr-plan-qty'); const planQtyLabel = planPanel.querySelector('#fr-plan-qty-label'); const planMode = planPanel.querySelector('#fr-plan-action-mode'); const composer = planPanel.querySelector('#fr-plan-composer'); const composeToggle = planPanel.querySelector('#fr-plan-compose-toggle'); const composeCancel = planPanel.querySelector('#fr-plan-compose-cancel'); const kindHelp = planPanel.querySelector('#fr-plan-kind-help'); const clearButton = planPanel.querySelector('#fr-clear'); const announcer = planPanel.querySelector('#fr-plan-announcer');
  const kindCopy = { item: ['Reach item total', 'Reach an inventory total.', 'Total quantity'], 'item-gain': ['Gain items', 'Gain this many from your current inventory.', 'Quantity to gain'], level: ['Reach skill level', 'Reach a total skill level.', 'Target level'], xp: ['Reach skill XP', 'Reach a total skill XP value.', 'Target XP'], action: ['Run an action', 'Run one action for a count or duration.', 'Amount'], 'use-stock': ['Use current stock', 'Craft as much as your current inputs allow.', 'Amount'] };
  const announcePlan = (message) => { if (announcer && announcer.textContent !== message) announcer.textContent = message; };
  const setComposerOpen = (open, { focus = true } = {}) => { const enabled = Boolean(open); state.composerOpen = enabled; composer.hidden = !enabled; composeToggle.hidden = !state.queueGoals.length || enabled; composeToggle.setAttribute('aria-expanded', String(enabled)); if (enabled && focus) (planKind || composer).focus?.(); else if (!enabled && focus) composeToggle.focus?.(); };
  planSkill.innerHTML = skills.map((skill) => `<option value="${escapeHtml(skill.id)}">${escapeHtml(skillNames[skill.id] || skill.id)}</option>`).join('');
  if (!planKind.value) planKind.value = 'item';
  if (!planSkill.value) planSkill.value = skills[0]?.id || '';
  const renderActionOptions = () => { const actions = model._index.actionsBySkill.get(planSkill.value) || []; const special = planSkill.value === 'agility' ? (model.agilityCourses || []).map((course) => ({ id: course.id, name: course.name })) : planSkill.value === 'cartography' ? (model.maps || []).map((map) => ({ id: map.id, name: map.name })) : []; const options = actions.length ? actions : special; planAction.innerHTML = options.map((action) => `<option value="${escapeHtml(action.id)}">${escapeHtml(actionName(action))}</option>`).join(''); planAction.value = options[0]?.id || ''; };
  const updateTargetFields = () => { const kind = planKind.value; const itemKind = kind === 'item' || kind === 'item-gain' || kind === 'use-stock'; const skillKind = kind === 'level' || kind === 'xp' || kind === 'action'; planPanel.querySelector('#fr-plan-item-field').hidden = !itemKind; planPanel.querySelector('#fr-plan-skill-field').hidden = !skillKind; planPanel.querySelector('#fr-plan-action-field').hidden = kind !== 'action'; planPanel.querySelector('#fr-plan-mode-field').hidden = kind !== 'action'; planPanel.querySelector('#fr-plan-qty-field').hidden = kind === 'use-stock'; const copy = kindCopy[kind] || kindCopy.item; kindHelp.textContent = copy[1]; planQtyLabel.textContent = copy[2]; planQty.min = '1'; renderActionOptions(); };
  const setFormError = (message = '', field = null) => { planFormError.textContent = message; planFormError.hidden = !message; planFormError.dataset.state = message ? 'error' : 'idle'; for (const node of [planItem, planQty, planSkill, planAction]) { node.removeAttribute?.('aria-invalid'); node.removeAttribute?.('aria-describedby'); } if (message && field) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', 'fr-plan-form-error'); } };
  planKind.addEventListener('change', () => { setFormError(); updateTargetFields(); }); planSkill.addEventListener('change', () => { setFormError(); renderActionOptions(); });
  composeToggle.addEventListener('click', () => setComposerOpen(composer.hidden)); composeCancel.addEventListener('click', () => setComposerOpen(false));
  planForm.addEventListener('submit', (event) => { event.preventDefault(); try { const target = makeTarget(); setFormError(); const entry = { id: `plan-${state.nextPlanId++}`, target }; state.queueGoals.push(entry); persistQueue(); announcePlan(`Added ${targetLabel(target)} as priority ${state.queueGoals.length}.`); setComposerOpen(false); afterPlan(() => renderPlan()); } catch (error) { const message = error instanceof Error ? error.message : String(error); setFormError(message, message.includes('Choose an item') ? planItem : planQty); } });
  let planTargetResults = [];
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
  planPanel.addEventListener('scroll', (event) => { if (planOptions.contains?.(event.target)) return; closeItemOptions(); }, true);
  planPanel.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; if (!planOptions.hidden) { event.preventDefault(); closeItemOptions(); return; } if (!composer.hidden && state.queueGoals.length) { event.preventDefault(); setComposerOpen(false); } });
  shell.close.addEventListener('click', closeItemOptions); documentRef.defaultView?.addEventListener?.('resize', closeItemOptions);
  const makeTarget = () => {
    const kind = planKind.value; const rawAmount = Number(planQty.value);
    if (kind !== 'use-stock' && (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount < 1)) throw new Error('Enter a whole number of at least 1.');
    const amount = rawAmount;
    if (kind === 'item' || kind === 'item-gain' || kind === 'use-stock') { const itemId = state.selectedPlanItemId || sortedItems.find(([id, item]) => String(item.label || '').toLocaleLowerCase() === planItem.value.trim().toLocaleLowerCase())?.[0]; if (!itemId || !items[itemId]) throw new Error('Choose an item from the search results.'); return kind === 'use-stock' ? { type: 'use-stock', itemId } : { type: kind, itemId, [kind === 'item' ? 'qty' : 'gain']: amount }; }
    if (kind === 'level') return { type: 'level', skillId: planSkill.value, level: amount };
    if (kind === 'xp') return { type: 'xp', skillId: planSkill.value, xp: amount };
    const target = { type: 'action', skillId: planSkill.value, actionId: planAction.value }; target[planMode.value] = amount; return target;
  };

  let renderPlan;
  const stepProgress = (step, status) => {
    if (!step || status.runningStepId !== step.id) return null;
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
      const status = state.executorStatus || {}; const phase = status.phase || 'idle'; const locked = isExecutionLocked(phase); const result = state.resolvedQueue; const totalSteps = Number(status.totalSteps) || result.steps.length || 0; const completedSteps = Number(status.completedSteps) || 0; const running = result.steps.find((step) => step.id === status.runningStepId); const currentProgress = stepProgress(running, status); const fraction = currentProgress ? currentProgress.value / currentProgress.max : 0; const overall = Math.min(totalSteps, completedSteps + (running ? fraction : 0));
      const phaseNode = planPanel.querySelector('#fr-executor-phase'); const messageNode = planPanel.querySelector('#fr-executor-message'); const progress = planPanel.querySelector('#fr-executor-progress'); const runButton = shell.queueControls.querySelector('#fr-run'); const resumeButton = shell.queueControls.querySelector('#fr-resume'); const stopButton = shell.queueControls.querySelector('#fr-stop');
      const firstUnresolved = result.steps.find((step) => status.stepStatuses?.[step.id] !== 'done'); const blockedTarget = result.targets.find((entry) => entry?.blocked); let phaseText = 'Ready to run'; let message = 'Add a target to begin.';
      if (phase === 'running') { phaseText = 'Running'; const remainMs = Number(status.stepRemainingMs ?? running?.expected?.ms) || 0; message = `${running?.label || 'Current action'} · step ${Math.min(totalSteps, completedSteps + 1)} of ${totalSteps}${remainMs > 0 ? ` · ~${formatDuration(remainMs)} left` : ''}`; } else if (phase === 'waiting') { phaseText = 'Needs you'; message = status.message || 'Complete the next manual step.'; } else if (phase === 'complete' || (state.queueGoals.length && totalSteps === 0)) { phaseText = 'Plan complete'; message = status.message || 'All targets are satisfied.'; } else if (phase === 'error') { phaseText = 'Plan stopped'; message = status.message || 'The plan stopped.'; } else if (status.message === 'Stopped') { phaseText = 'Stopped'; message = 'Stopped'; } else if (state.queueGoals.length && !result.steps.length && blockedTarget) { phaseText = 'Plan blocked'; message = `Resolve ${blockedTarget.blocked?.fact ? factLabel(blockedTarget.blocked.fact) : 'the blocker'} or remove the blocked target.`; } else if (state.queueGoals.length && firstUnresolved) { phaseText = 'Ready to run'; message = `First: ${firstUnresolved.label || firstUnresolved.id}. Starting stops your current game action.`; }
      phaseNode.textContent = phaseText; messageNode.textContent = message; progress.max = Math.max(1, totalSteps); progress.value = overall; progress.setAttribute('aria-valuetext', currentProgress ? `${completedSteps} of ${totalSteps} steps complete, ${Math.round(currentProgress.value)} of ${currentProgress.max} runs in the current step` : `${completedSteps} of ${totalSteps} steps complete`);
      const retry = phase === 'error' && result.steps.length; runButton.hidden = locked || !result.steps.length; runButton.disabled = !result.steps.length || locked; runButton.setAttribute('aria-label', retry ? 'Retry plan' : 'Start plan'); runButton.setAttribute('title', retry ? 'Retry plan' : 'Start plan'); resumeButton.hidden = phase !== 'waiting'; resumeButton.disabled = !result.steps.length; stopButton.hidden = !locked; stopButton.disabled = !locked; clearButton.disabled = !state.queueGoals.length || locked;
      for (const button of planPanel.querySelectorAll?.('[data-queue-move], [data-queue-remove]') || []) { button.disabled = locked; if (locked) button.setAttribute('aria-describedby', 'fr-plan-edit-lock-hint'); else button.removeAttribute?.('aria-describedby'); } const confirmation = planPanel.querySelector('#fr-clear-confirmation'); if (confirmation) for (const button of confirmation.querySelectorAll?.('button') || []) button.disabled = locked; for (const button of shell.panels.skills.querySelectorAll?.('[data-start-action]') || []) button.disabled = locked;
      const launcherLabel = shell.launcher.querySelector?.('#fr-launcher-label'); if (launcherLabel) launcherLabel.textContent = phase === 'running' ? `Companion · ${Math.min(totalSteps, completedSteps + (running ? 1 : 0))}/${totalSteps}` : phase === 'waiting' ? 'Companion · waiting' : phase === 'complete' ? 'Companion · plan done' : phase === 'error' ? 'Companion · plan stopped' : 'Companion'; shell.launcher.dataset.state = phase === 'error' ? 'error' : 'ready';
      const compactPhase = shell.compactStrip.querySelector('#fr-compact-phase'); const compactMessage = shell.compactStrip.querySelector('#fr-compact-message'); const compactProgress = shell.compactStrip.querySelector('#fr-compact-progress'); const compactStart = shell.compactStrip.querySelector('#fr-compact-start'); const compactResume = shell.compactStrip.querySelector('#fr-compact-resume'); const compactStop = shell.compactStrip.querySelector('#fr-compact-stop'); compactPhase.textContent = phaseText; compactMessage.textContent = message; compactProgress.max = Math.max(1, totalSteps); compactProgress.value = overall; compactProgress.setAttribute('aria-valuetext', progress.getAttribute('aria-valuetext') || ''); compactStart.hidden = !state.queueGoals.length || locked; compactStart.disabled = !result.steps.length; compactResume.hidden = phase !== 'waiting'; compactResume.disabled = !result.steps.length; compactStop.hidden = !locked; compactStop.disabled = !locked;
      const announcementKey = `${phase}|${status.runningStepId || ''}|${phase === 'waiting' ? message : ''}|${phase === 'error' ? message : ''}|${phase === 'complete' ? 'complete' : ''}`; if (state.lastAnnouncementKey !== announcementKey) { state.lastAnnouncementKey = announcementKey; if (phase === 'running' && running) announcePlan(`Running ${running.label || running.id}.`); else if (phase === 'waiting') announcePlan(message); else if (phase === 'complete') announcePlan('Plan complete.'); else if (phase === 'error') announcePlan(message); }
    }
  const stepPresentation = (step, allSteps, live, status) => {
      const reported = status.stepStatuses?.[step.id]; if (reported === 'done') return { state: 'done', label: 'Done', blocker: null }; if (reported === 'running') return { state: 'running', label: 'Running', blocker: null };
      const deps = (step.deps || []).map((id) => allSteps.find((candidate) => candidate.id === id)).filter(Boolean); const unfinished = deps.find((dependency) => status.stepStatuses?.[dependency.id] !== 'done');
      if (step.kind === 'manual') return unfinished ? { state: 'manual-later', label: 'Needs you later', blocker: unfinished } : { state: 'manual-now', label: 'Needs you', blocker: null };
      if (unfinished) return { state: 'later', label: 'Later', blocker: unfinished }; const blocker = liveBlocker(model, live, step); return blocker ? { state: 'blocked', label: `Blocked · ${factLabel(blocker)}`, blocker } : { state: 'ready', label: 'Ready', blocker: null };
    }
  const planNum = (value) => Number(value) || 0;
  const planQtyText = (value) => { const n = planNum(value); if (Number.isInteger(n)) return n.toLocaleString(); return n < 1 ? n.toFixed(2) : n.toFixed(1); };
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
    if (runs > 1) parts.push(`<span class="data">\u00d7${escapeHtml(planQtyText(runs))}</span>`);
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
  // Live progress toward an inventory- or gold-denominated goal.
  const goalProximityHtml = (target, live) => { if (target?.type === 'item') return `<span class="data">${escapeHtml(planQtyText(live.inventory?.[target.itemId]))}</span> / <span class="data">${escapeHtml(planQtyText(target.qty))}</span> ${escapeHtml(labelFor(items, target.itemId))}`; if (target?.type === 'item-gain') return `Current <span class="data">${escapeHtml(planQtyText(live.inventory?.[target.itemId]))}</span> · gain goal <span class="data">+${escapeHtml(planQtyText(target.gain))}</span>`; if (target?.type === 'level') { const current = levelForXp(model.xpTable, live.skillXp?.[target.skillId]); return `Level <span class="data">${current}</span> / <span class="data">${escapeHtml(planQtyText(target.level))}</span>`; } if (target?.type === 'xp') return `<span class="data">${escapeHtml(planQtyText(live.skillXp?.[target.skillId]))}</span> / <span class="data">${escapeHtml(planQtyText(target.xp))}</span> XP`; return ''; };
  renderPlan = () => {
      const result = state.resolvedQueue; const live = liveState(); const status = state.executorStatus || {}; const planResult = planPanel.querySelector('#fr-plan-result'); const firstBlocked = result.targets.findIndex((entry) => !entry.ok); const anchor = isExecutionLocked(status.phase) && Number.isFinite(Number(state.queueStartedAt)) ? Number(state.queueStartedAt) : Date.now();
      const targetDone = (target, entry) => { if (!entry?.ok) return false; if (target.type === 'item') return planNum(live.inventory?.[target.itemId]) >= planNum(target.qty); if (target.type === 'level') return levelForXp(model.xpTable, live.skillXp?.[target.skillId]) >= target.level; if (target.type === 'xp') return planNum(live.skillXp?.[target.skillId]) >= target.xp; return (entry.steps || []).length === 0 || (entry.steps || []).every((step) => status.stepStatuses?.[step.id] === 'done'); };
      const renderStepRow = (step, stepNumber) => {
        const presentation = stepPresentation(step, result.steps, live, status);
        const per = result.perStep?.find((e) => e.id === step.id); const perMs = per ? Math.max(0, Number(per.endMs) - Number(per.startMs)) : 0;
        let stateText = presentation.label;
        if (presentation.state === 'later') { const laterDeps = (step.deps || []).map((id) => result.steps.find((s) => s.id === id)).filter((d) => d && status.stepStatuses?.[d.id] !== 'done'); const binding = laterDeps.reduce((a, b) => (planNum(result.perStep?.find((e) => e.id === b.id)?.endMs) > planNum(result.perStep?.find((e) => e.id === a.id)?.endMs) ? b : a), laterDeps[0]); stateText = binding ? `waiting for ${binding.label || binding.id}` : 'waiting for earlier work'; }
        const timeText = presentation.state === 'running' && Number(status.stepRemainingMs) > 0 ? `~${formatDuration(status.stepRemainingMs)} left` : presentation.state === 'manual-later' ? `~${formatFinishTime(result.readyAt?.[step.id] || 0, anchor)}` : perMs > 0 ? `~${formatDuration(perMs)}` : '';
        const isManual = step.kind === 'manual';
        const showState = !isManual && ['running', 'blocked', 'later'].includes(presentation.state);
        const marker = presentation.state === 'done' ? ICONS.check : String(stepNumber);
        const progressState = stepProgress(step, status); const pct = progressState ? Math.round((progressState.value / progressState.max) * 100) : 0;
        const progressMarkup = progressState ? `<progress class="step-progress" max="${escapeHtml(progressState.max)}" value="${escapeHtml(progressState.value)}" aria-label="${escapeHtml(step.label || step.id)}: ${escapeHtml(progressState.value)} of ${escapeHtml(progressState.max)} runs"></progress><span class="step-progress-text data">${escapeHtml(planQtyText(progressState.value))} / ${escapeHtml(planQtyText(progressState.max))} · ${pct}%</span>` : '';
        const manualText = presentation.state === 'manual-later' ? 'Needs you later.' : 'Needs you. Do it in-game to continue.';
        const instruction = isManual && presentation.state !== 'done' ? `<p class="instruction-card">${manualText}</p>` : '';
        const detailHtml = [stepYieldHtml(step), stepInputsHtml(step)].filter(Boolean).join(' · ');
        return `<li class="plan-step" data-step-id="${escapeHtml(step.id)}" data-state="${presentation.state}"><span class="step-marker">${marker}</span><div class="step-content"><strong>${escapeHtml(step.label || actionName(actionFor(step.skillId, step.actionId)) || step.id)}</strong>${detailHtml ? `<span class="step-detail">${detailHtml}</span>` : ''}${showState ? `<span class="step-state" data-state="${presentation.state}">${escapeHtml(stateText)}</span>` : ''}${instruction}${progressMarkup}</div>${timeText ? `<span class="step-timing data">${escapeHtml(timeText)}</span>` : ''}</li>`;
      };
      const runningId = status.runningStepId;
      const targetCards = state.queueGoals.map((goal, index) => {
        const entry = result.targets[index]; const waiting = !entry && firstBlocked >= 0 && index > firstBlocked; const blocked = entry?.blocked; const label = targetLabel(goal.target); const done = targetDone(goal.target, entry);
        const stateName = done ? 'done' : blocked ? 'blocked' : waiting ? 'waiting' : entry?.ok ? 'planned' : 'queued';
        const stateLabel = done ? 'Done' : blocked ? 'Blocked' : waiting ? 'Waiting' : entry?.ok ? 'Planned' : 'Queued';
        const chain = blocked ? blockerChain(blocked, live) : [];
        const explanation = blocked ? `<p class="target-explanation">${blocked.fact ? `Blocked by ${escapeHtml(factLabel(blocked.fact))}` : 'Unable to resolve this target.'}${chain.length ? `<br>Prerequisite chain: ${escapeHtml(chain.map(factLabel).join(' → '))}` : ''}</p>` : waiting ? '<p class="target-explanation">Waiting for the blocked target above.</p>' : '';
        const proximity = entry?.ok ? goalProximityHtml(goal.target, live) : ''; const proximityRow = proximity ? `<p class="queue-plan-proximity">${proximity}</p>` : '';
        const steps = entry?.steps || []; const cardActive = steps.some((s) => s.id === runningId);
        const cardMs = steps.reduce((sum, s) => { const p = result.perStep?.find((e) => e.id === s.id); return sum + (p ? Math.max(0, Number(p.endMs) - Number(p.startMs)) : 0); }, 0);
        const cardMeta = steps.length ? `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}${cardMs > 0 ? ` · ~${formatDuration(cardMs)}` : ''}` : '';
        const lockHint = isExecutionLocked(status.phase) ? ' aria-describedby="fr-plan-edit-lock-hint" disabled' : '';
        const controls = `<span class="queue-plan-actions"><button class="icon-button" type="button" data-queue-move="top" data-queue-goal="${escapeHtml(goal.id)}"${index === 0 ? ' disabled' : ''}${lockHint} aria-label="Move ${escapeHtml(label)} to top" title="Move to top">${ICONS.top}</button><button class="icon-button" type="button" data-queue-move="up" data-queue-goal="${escapeHtml(goal.id)}"${index === 0 ? ' disabled' : ''}${lockHint} aria-label="Move ${escapeHtml(label)} up" title="Move up">${ICONS.up}</button><button class="icon-button" type="button" data-queue-move="down" data-queue-goal="${escapeHtml(goal.id)}"${index === state.queueGoals.length - 1 ? ' disabled' : ''}${lockHint} aria-label="Move ${escapeHtml(label)} down" title="Move down">${ICONS.down}</button><button class="icon-button danger" type="button" data-queue-remove="${escapeHtml(goal.id)}"${lockHint} aria-label="Remove ${escapeHtml(label)}" title="Remove">${ICONS.remove}</button></span>`;
        const stepRows = steps.map((step, i) => renderStepRow(step, i + 1)).join(''); const stepsList = stepRows ? `<ol class="queue-steps">${stepRows}</ol>` : '';
        return `<li class="queue-plan" data-target-id="${escapeHtml(goal.id)}" data-state="${stateName}"${cardActive ? ' data-active="true"' : ''}><div class="queue-plan-top"><span class="queue-plan-index data">${String(index + 1).padStart(2, '0')}</span><h3 class="queue-plan-title">${escapeHtml(label)}</h3><span class="badge" data-state="${stateName}">${stateLabel}</span>${cardMeta ? `<span class="queue-plan-meta">${escapeHtml(cardMeta)}</span>` : ''}${controls}</div>${proximityRow}${explanation}${stepsList}</li>`;
      }).join('');
      const manualSteps = result.steps.filter((step) => step.kind === 'manual'); const pendingManual = manualSteps.filter((step) => status.stepStatuses?.[step.id] !== 'done').sort((a, b) => planNum(result.readyAt?.[a.id]) - planNum(result.readyAt?.[b.id])); const goldCost = result.steps.reduce((sum, step) => sum + planNum(model._index.providersById?.get(step.providerId)?.consumesGold), 0); const nextManual = pendingManual[0];
      const overview = `<dl class="plan-overview" id="fr-queue-total"><div><dt>Estimate</dt><dd class="data">≈${escapeHtml(formatDuration(result.optimisticMs || 0))}</dd></div>${goldCost > 0 ? `<div><dt>Cost</dt><dd class="data">${escapeHtml(planQtyText(goldCost))}g</dd></div>` : ''}<div><dt>Manual stops</dt><dd class="data">${pendingManual.length}</dd></div></dl>`;
      const presence = nextManual ? `<p class="plan-overview-presence">Runs ~${escapeHtml(formatDuration(result.schedulerMs || 0))} before it needs you.<br>Next: ${escapeHtml(nextManual.label || nextManual.id)} at ~${escapeHtml(formatFinishTime(result.readyAt?.[nextManual.id] || 0, anchor))}.</p>` : '<p class="plan-overview-presence">Runs fully unattended.</p>';
      const manualRows = manualSteps.map((step) => { const presentation = stepPresentation(step, result.steps, live, status); const ready = result.readyAt?.[step.id] || 0; return `<li class="manual-list-row" data-state="${presentation.state}"><span>${escapeHtml(step.label || step.id)}</span><span class="data">${presentation.state === 'manual-now' ? 'ready' : presentation.state === 'done' ? 'done' : `~${escapeHtml(formatFinishTime(ready, anchor))}`}</span></li>`; }).join('');
      const warning = result.infeasibility ? `<p class="banner warning" role="status">${ICONS.warning}<span>Simulation warning: ${escapeHtml(result.steps.find((step) => step.id === result.infeasibility.stepId)?.label || 'step')}.</span></p>` : '';
      const lockNote = isExecutionLocked(status.phase) ? '<p class="plan-edit-lock" role="note">Stop the plan to edit targets.</p>' : '';
      planResult.innerHTML = state.queueGoals.length ? `${lockNote}${warning}<ol class="plan-queue-list">${targetCards}</ol>${overview}${presence}${manualSteps.length ? `<section class="plan-manual-list"><h3>Manual stops (${pendingManual.length})</h3><ul>${manualRows}</ul></section>` : ''}<p id="fr-plan-edit-lock-hint" class="visually-hidden">Stop the plan to edit targets.</p>` : '<div class="empty">What do you want to achieve?<br>Add an item, skill, or action target. The companion will show every prerequisite before anything runs.</div>';
      const summary = planPanel.querySelector('#fr-plan-toolbar-summary'); if (summary) { const stepsN = result.steps.length; summary.textContent = stepsN ? `${state.queueGoals.length} ${state.queueGoals.length === 1 ? 'target' : 'targets'} · ${stepsN} ${stepsN === 1 ? 'step' : 'steps'} · ${pendingManual.length} manual · ~${formatDuration(result.optimisticMs || 0)}${goldCost > 0 ? ` · ${planQtyText(goldCost)}g` : ''}` : ''; summary.hidden = !stepsN; }
      if (state.queueGoals.length === 0) setComposerOpen(true, { focus: false }); else if (!state.composerOpen) setComposerOpen(false, { focus: false });
      renderExecutor();
    };
  const targetActionLabel = (target) => actionName(actionFor(target.skillId, target.actionId) || (target.skillId === 'agility' ? (model.agilityCourses || []).find((course) => course.id === target.actionId) : target.skillId === 'cartography' ? (model.maps || []).find((map) => map.id === target.actionId) : null));
  const targetLabel = (target) => { if (!target) return 'Target'; if (target.type === 'item' || target.type === 'item-gain') return `${target.type === 'item-gain' ? 'Gain' : 'Reach'} ${target.qty ?? target.gain} ${labelFor(items, target.itemId)}`; if (target.type === 'use-stock') return `Make ${labelFor(items, target.itemId)} from stock`; if (target.type === 'level') return `${skillNames[target.skillId] || target.skillId} level ${target.level}`; if (target.type === 'xp') return `${skillNames[target.skillId] || target.skillId} XP ${target.xp}`; if (target.type === 'action') return `${targetActionLabel(target)} · ${target.runs ? `${target.runs} runs` : `${target.minutes} minutes`}`; return 'Target'; };

  const executor = createDirectExecutor(api, { liveBlocker: (stateSnapshot, step) => liveBlocker(model, stateSnapshot, step), factSatisfied: (stateSnapshot, fact) => factSatisfied(model, stateSnapshot, fact), formatBlocker: (blocker) => factLabel(blocker), onUpdate(status) { state.executorStatus = status; renderPlan?.(); } });
  const runQueue = () => { if (isExecutionLocked(state.executorStatus?.phase)) return; afterPlan(() => { if (state.resolvedQueue.steps.length) { state.queueStartedAt = Date.now(); renderPlan(); executor.run(state.resolvedQueue.steps); } }); };
  const resumeQueue = () => { if (state.executorStatus?.phase !== 'waiting') return; afterPlan(() => { if (state.resolvedQueue.steps.length) { state.queueStartedAt ??= Date.now(); executor.run(state.resolvedQueue.steps); } }); };
  const stopQueue = () => { state.queueStartedAt = null; executor.stop(); };
  shell.queueControls.querySelector('#fr-run').addEventListener('click', runQueue); shell.queueControls.querySelector('#fr-resume').addEventListener('click', resumeQueue); shell.queueControls.querySelector('#fr-stop').addEventListener('click', stopQueue);
  clearButton.addEventListener('click', () => { if (isExecutionLocked(state.executorStatus?.phase)) return; const existing = planPanel.querySelector('#fr-clear-confirmation'); if (existing) return; const confirmation = documentRef.createElement('div'); confirmation.id = 'fr-clear-confirmation'; confirmation.innerHTML = '<strong>Clear all targets?</strong><button class="button compact" id="fr-clear-cancel" type="button">Cancel</button><button class="button compact danger" id="fr-clear-confirm" type="button">Clear</button>'; planPanel.querySelector('#fr-plan-toolbar').append(confirmation); confirmation.querySelector('#fr-clear-cancel')?.addEventListener('click', () => { confirmation.remove?.(); clearButton.focus?.(); }); confirmation.querySelector('#fr-clear-confirm')?.addEventListener('click', () => { state.queueGoals = []; state.resolvedQueue = { steps: [], targets: [] }; state.queueStartedAt = null; persistQueue(); confirmation.remove?.(); announcePlan('All targets cleared.'); renderPlan(); }); });
  shell.compactStrip.querySelector('#fr-compact-start').addEventListener('click', runQueue); shell.compactStrip.querySelector('#fr-compact-resume').addEventListener('click', resumeQueue); shell.compactStrip.querySelector('#fr-compact-stop').addEventListener('click', stopQueue);
  planPanel.addEventListener('click', (event) => { if (isExecutionLocked(state.executorStatus?.phase)) return; const move = event.target.closest?.('[data-queue-move]'); if (move) { const dir = move.dataset.queueMove; const from = state.queueGoals.findIndex((goal) => goal.id === move.dataset.queueGoal); if (from < 0) return; const to = dir === 'top' ? 0 : dir === 'up' ? from - 1 : from + 1; if (to < 0 || to >= state.queueGoals.length) return; const [moved] = state.queueGoals.splice(from, 1); state.queueGoals.splice(to, 0, moved); persistQueue(); announcePlan(`Moved ${targetLabel(moved.target)} to priority ${to + 1}.`); afterPlan(() => { renderPlan(); planPanel.querySelector(`[data-queue-move="${dir}"][data-queue-goal="${moved.id}"]`)?.focus?.(); }); return; } const remove = event.target.closest?.('[data-queue-remove]'); if (!remove) return; const index = state.queueGoals.findIndex((goal) => goal.id === remove.dataset.queueRemove); if (index < 0) return; const label = targetLabel(state.queueGoals[index].target); state.queueGoals.splice(index, 1); persistQueue(); refreshQueue(); renderPlan(); announcePlan(`Removed ${label}.`); const next = state.queueGoals[index] || state.queueGoals[index - 1]; planPanel.querySelector(next ? `[data-queue-remove="${next.id}"]` : '#fr-plan-compose-toggle')?.focus?.(); });

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
  return { model, indexedModel: model, datasets, indexes, state, executor, renderItemList, renderItemDetail, renderSkillTable, renderPlan, refreshQueue, planSettled: () => lastPlan };
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
    shell.showError(timeout ? 'Companion connection timed out' : 'Companion data could not load', message);
    return { shell, app: null, api: null, error };
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') queueMicrotask(() => { void bootOverlay(); });
