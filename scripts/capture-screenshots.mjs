#!/usr/bin/env node
// Deterministically regenerate docs/screenshots/*.webp against the live game.
// No manual stepping: a committed fixture save + staged queue drive the UI, and
// the clock is frozen so "ready for you at ~HH:MM" text is byte-stable.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stateDir } from './backup-saves.mjs';
import { ensureCompanionRunning, openGame, quitCompanion, dumpStorage } from './lib/live-game.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const shotsDir = join(repoRoot, 'docs', 'screenshots');
const fixturePath = join(shotsDir, 'fixture-save.json');

// Frozen wall clock so manual-step ready-at times render identically each run.
const CLOCK_MS = Date.UTC(2026, 0, 5, 14, 0, 0);

// Staged queue showcasing the rebuild: a deep cross-skill item plan (whose
// shared base materials are provisioned cumulatively), a skill-level target, and
// a Mithril Dagger target whose plan contains manual purchase steps. Ids are
// resolved against the committed fixture save + live model.json.
const STAGED_QUEUE = {
  goals: [
    { id: 'plan-1', target: { type: 'item', itemId: 'mithril_dagger', qty: 1 } },
    { id: 'plan-2', target: { type: 'level', skillId: 'woodcutting', level: 70 } },
  ],
  nextPlanId: 3,
};

async function toWebp(context, pngBuffer) {
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    const dataUrl = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.9);
    }, pngBuffer.toString('base64'));
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } finally {
    await page.close();
  }
}

async function assertNoPlanOverlap(page) {
  const overlap = await page.evaluate(() => {
    const root = document.querySelector('#fractured-realms-companion')?.shadowRoot; const workspace = root?.querySelector('#fr-plan-result'); const executor = root?.querySelector('.executor');
    if (!workspace || !executor) return true; return workspace.getBoundingClientRect().bottom > executor.getBoundingClientRect().top + 1;
  });
  if (overlap) throw new Error('Plan workspace intersects executor dock');
}
async function shoot(page, context, name, panel) {
  const png = await panel.screenshot({ animations: 'disabled' });
  const webp = await toWebp(context, png);
  writeFileSync(join(shotsDir, `${name}.webp`), webp);
  console.log(`wrote ${name}.webp (${webp.length} bytes)`);
}

async function main() {
  if (process.argv.includes('--export-save')) return exportSave();

  let fixture;
  try { fixture = JSON.parse(readFileSync(fixturePath, 'utf8')); }
  catch (error) { console.error(`fixture save missing/invalid at ${fixturePath}: ${error instanceof Error ? error.message : error}`); process.exit(1); }

  const running = await ensureCompanionRunning({ refresh: false }).catch((error) => {
    console.error(`companion not running (refresh the install first): ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });

  const profileDir = join(stateDir(), 'screenshot-profile');
  const { context, page } = await openGame({ profileDir, save: fixture, queue: STAGED_QUEUE, clockMs: CLOCK_MS });
  const panel = page.locator('#fr-panel');

  try {
    // 1. Item wiki — first item with >=2 sources and >=1 use.
    await page.click('#fr-tab-items');
    await page.locator('#fr-item-list .item-row').first().waitFor({ timeout: 10_000 });
    // Pick the first list row whose detail has real sources and uses.
    const rows = page.locator('#fr-item-list .item-row');
    const count = await rows.count();
    for (let i = 0; i < Math.min(count, 40); i += 1) {
      await rows.nth(i).click();
      const text = await page.locator('#fr-item-detail').innerText();
      if (!/No source is recorded/i.test(text) && !/No action or building upgrade consumes/i.test(text)) break;
    }
    await shoot(page, context, 'item-wiki', panel);

    // 2. Skill actions — Archaeology.
    await page.click('#fr-tab-skills');
    await page.selectOption('#fr-skill-select', 'archaeology').catch(() => {});
    await page.locator('#fr-skill-table table').waitFor({ timeout: 10_000 });
    await shoot(page, context, 'skill-actions', panel);

    // 3. Action planner — staged queue running.
    await page.click('#fr-tab-plan');
    await page.locator('#fr-plan-result .plan-step').first().waitFor({ timeout: 10_000 });
    await page.click('#fr-run');
    await page.waitForFunction(() => /running/i.test(document.querySelector('#fractured-realms-companion')?.shadowRoot?.querySelector('#fr-executor-phase')?.textContent || ''), { timeout: 15_000 });
    await page.locator('#fr-executor-progress').waitFor({ timeout: 10_000 });
    await page.evaluate(() => { const root = document.querySelector('#fractured-realms-companion')?.shadowRoot; for (const selector of ['#fr-panel-plan', '.plan-view', '#fr-plan-result']) { const element = root?.querySelector(selector); if (element) { element.scrollTop = 0; element.scrollLeft = 0; } } });
    await assertNoPlanOverlap(page);
    await shoot(page, context, 'action-planner', panel);

    // 4. Manual steps — scroll timeline to the first instruction card.
    const cardSelector = '#fr-plan-result .plan-step:has(.instruction-card)';
    await page.locator(cardSelector).first().waitFor({ timeout: 10_000 });
    let scrolled = false;
    for (let attempt = 0; attempt < 4 && !scrolled; attempt += 1) {
      try { await page.locator(cardSelector).first().scrollIntoViewIfNeeded(); scrolled = true; } catch (error) { if (attempt === 3) throw error; await page.waitForTimeout(100); }
    }
    await assertNoPlanOverlap(page);
    await shoot(page, context, 'manual-steps', panel);

    // Stop the executor before teardown.
    await page.click('#fr-stop').catch(() => {});
  } finally {
    try { await context.close(); } catch { /* best effort */ }
    if (running?.launched) await quitCompanion();
  }
}

// Re-curation helper: open the screenshot profile headed, let the operator play,
// then persist the current slot-1 payload (scrubbed of deviceId) to the fixture.
async function exportSave() {
  const running = await ensureCompanionRunning({ refresh: false });
  const profileDir = join(stateDir(), 'screenshot-profile');
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: { width: 900, height: 960 }, deviceScaleFactor: 2 });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('http://127.0.0.1:48766/');
  console.log('Browser open. Play/curate the slot-1 save, then close the browser to export.');
  await context.waitForEvent('close').catch(() => {});
  // Context closed by operator; read persisted storage from a fresh short-lived context.
  const probe = await chromium.launchPersistentContext(profileDir, { viewport: { width: 900, height: 960 } });
  const probePage = probe.pages()[0] ?? (await probe.newPage());
  await probePage.goto('http://127.0.0.1:48766/', { waitUntil: 'domcontentloaded' });
  const storage = await dumpStorage(probePage);
  const envelope = JSON.parse(storage.fr_save_slot_1 || '{}');
  const payload = envelope.payload ?? {};
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(fixturePath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Exported scrubbed payload to ${fixturePath}`);
  await probe.close();
  if (running.launched) await quitCompanion();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
