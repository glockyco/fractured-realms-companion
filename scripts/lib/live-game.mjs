// Shared live-game driver used by live-validate.mjs and capture-screenshots.mjs.
// Owns Playwright browser resolution, companion lifecycle over the host HTTP
// surface, and overlay-aware page bring-up against the real game.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOST = '127.0.0.1';
const PORT = 48766;
export const ORIGIN = `http://${HOST}:${PORT}`;
const HEALTH_URL = `${ORIGIN}/health`;
const QUIT_URL = `${ORIGIN}/api/quit`;
const SERVICE = 'FRACTURED_REALMS_COMPANION_V1';
// Overlay host element id — mirrors HOST_ID near the top of overlay/overlay.js.
export const HOST_ID = 'fractured-realms-companion';
export const QUEUE_STORAGE_KEY = 'fractured-realms-companion.queue.v1';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(repoRoot, 'src', 'cli.ts');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve Playwright's Chromium, or exit with the deterministic install hint. */
export async function resolveChromium() {
  const { chromium } = await import('playwright');
  const executablePath = chromium.executablePath();
  const { existsSync } = await import('node:fs');
  if (!executablePath || !existsSync(executablePath)) {
    console.error('Chromium for Playwright is missing. Run: npx playwright install chromium');
    process.exit(1);
  }
  return chromium;
}

/** GET /health; returns parsed JSON when this is our service, else null. */
export async function companionHealthy() {
  try {
    const response = await fetch(HEALTH_URL, { headers: { Host: `${HOST}:${PORT}` } });
    if (!response.ok) return null;
    const body = await response.json();
    return body && body.service === SERVICE ? body : null;
  } catch {
    return null;
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

/** Ensure a healthy companion, optionally refreshing+launching the install. */
export async function ensureCompanionRunning({ refresh = false } = {}) {
  const existing = await companionHealthy();
  if (existing) return { launched: false, health: existing };

  if (refresh) {
    const refreshed = runCli(['refresh']);
    if (refreshed.status !== 0) throw new Error(`refresh failed:\n${refreshed.stderr || refreshed.stdout}`);
  }
  const launched = runCli(['launch', '--no-open']);
  if (launched.status !== 0) throw new Error(`launch failed:\n${launched.stderr || launched.stdout}`);

  const health = await companionHealthy();
  if (!health) throw new Error('companion did not report healthy after launch');
  return { launched: true, health };
}

/** POST the tokenless quit contract and wait for the port to close. */
export async function quitCompanion() {
  try {
    await fetch(QUIT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"confirm":"fractured-realms"}',
    });
  } catch { /* the host tears down mid-response; ignore transport errors */ }
  for (let waited = 0; waited < 30_000; waited += 500) {
    if (!(await companionHealthy())) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Launch a persistent Chromium context against the running game, seed save and
 * queue storage, and wait for the overlay to boot. Aborts real Steam/Discord
 * side effects so automation can never unlock achievements or post webhooks.
 */
export async function openGame({ profileDir, save, queue, clockMs } = {}) {
  const chromium = await resolveChromium();
  const context = await chromium.launchPersistentContext(profileDir, {
    // Tall enough that the panel reaches its full 42rem height (its cap is
    // calc(100dvh - 5rem)); a short viewport clips the timeline and tables.
    viewport: { width: 900, height: 960 },
    deviceScaleFactor: 2,
  });

  let unlockAborts = 0;
  let feedbackAborts = 0;
  await context.route('**/api/steam/unlock', (route) => { unlockAborts += 1; route.abort(); });
  await context.route('**/api/feedback', (route) => { feedbackAborts += 1; route.abort(); });
  const guard = { get unlockAborts() { return unlockAborts; }, get feedbackAborts() { return feedbackAborts; } };

  const now = typeof clockMs === 'number' ? clockMs : Date.now();
  const seed = { activeSlot: '1', uiScale: '1', textScale: '1', queueKey: QUEUE_STORAGE_KEY };
  if (save !== undefined) {
    seed.slot = JSON.stringify({ version: 2, slot: 1, name: 'Companion QA', updatedAt: now, deviceId: 'qa-fixture', playtime: 0, payload: save });
  }
  if (queue !== undefined) seed.queue = JSON.stringify(queue);

  await context.addInitScript((s) => {
    try {
      localStorage.setItem('fr_active_slot', s.activeSlot);
      localStorage.setItem('fr_ui_scale', s.uiScale);
      localStorage.setItem('fr_text_scale', s.textScale);
      if (s.slot) localStorage.setItem('fr_save_slot_1', s.slot);
      if (s.queue) localStorage.setItem(s.queueKey, s.queue);
    } catch { /* storage may be unavailable pre-navigation */ }
  }, seed);

  const page = context.pages()[0] ?? (await context.newPage());
  if (typeof clockMs === 'number') await page.clock.install({ time: clockMs });
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await waitForOverlay(page);
  await openPanel(page);
  return { context, page, guard };
}

/** Open the overlay panel (it starts hidden until the launcher is clicked). */
export async function openPanel(page) {
  await page.evaluate((hostId) => {
    const host = document.querySelector(`#${hostId}`);
    const launcher = host?.shadowRoot?.querySelector('.launcher');
    if (launcher && launcher.getAttribute('aria-expanded') !== 'true') launcher.click();
  }, HOST_ID);
  await page.locator('#fr-panel').waitFor({ state: 'visible', timeout: 15_000 });
}

/** Wait for the game API and the overlay host; recover from a title/continue menu. */
export async function waitForOverlay(page) {
  await page.waitForFunction(() => window.__frCompanion?.version === 1, { timeout: 30_000 }).catch(async () => {
    // Contingency: a seeded slot may land on a title/continue screen. Click the
    // first visible continue/load/play control, then re-wait for the API.
    const button = page.locator('button:visible', { hasText: /continue|load|play/i }).first();
    if (await button.count()) await button.click().catch(() => {});
    await page.waitForFunction(() => window.__frCompanion?.version === 1, { timeout: 30_000 });
  });
  await page.waitForSelector(`#${HOST_ID}`, { state: 'attached', timeout: 30_000 });
}

/** Read the game's live state snapshot. */
export function gameState(page) {
  return page.evaluate(() => window.__frCompanion.getState());
}

/** Dump renderer localStorage for failure artifacts and save export. */
export function dumpStorage(page) {
  return page.evaluate(() => ({ ...localStorage }));
}
