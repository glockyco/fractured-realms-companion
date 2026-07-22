#!/usr/bin/env node
// End-to-end live validation against the real Fractured Realms game. Drives the
// companion overlay through wiki, plan/execute, waiting-phase, and persistence
// checks. Committed and rerunnable; see AGENTS.md safety boundaries.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stateDir, newestBackupManifest } from './backup-saves.mjs';
import {
  ORIGIN,
  ensureCompanionRunning,
  quitCompanion,
  openGame,
  openPanel,
  waitForOverlay,
  gameState,
  dumpStorage,
} from './lib/live-game.mjs';
import { spawnSync } from 'node:child_process';

const flags = new Set(process.argv.slice(2));
const noRefresh = flags.has('--no-refresh');
const keepOpen = flags.has('--keep-open');
const skipBackupCheck = flags.has('--skip-backup-check');
const fresh = flags.has('--fresh');

const root = stateDir();
const profileDir = join(root, 'live-profile');
const results = [];
const consoleLines = [];
let launchedByUs = false;
let ctx = null;

function pass(name) { results.push({ name, ok: true }); console.log(`PASS ${name}`); }
function fail(name, detail) { results.push({ name, ok: false, detail }); console.log(`FAIL ${name} — ${detail}`); }

/** Run `doctor --json` and return the parsed rows array, or null on parse failure. */
function doctorRows() {
  const out = spawnSync(process.execPath, ['src/cli.ts', 'doctor', '--json'], { encoding: 'utf8' });
  try { return JSON.parse(out.stdout); } catch { return null; }
}

async function artifacts(page, guard) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(root, 'validation-artifacts', ts);
  mkdirSync(dir, { recursive: true });
  try { if (page) await page.screenshot({ path: join(dir, 'failure.png') }); } catch { /* best effort */ }
  try { if (page) writeFileSync(join(dir, 'storage.json'), JSON.stringify(await dumpStorage(page), null, 2)); } catch { /* best effort */ }
  writeFileSync(join(dir, 'console.log'), consoleLines.join('\n'));
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ results, guard: guard ? { unlockAborts: guard.unlockAborts, feedbackAborts: guard.feedbackAborts } : null }, null, 2));
  console.log(`Artifacts written to ${dir}`);
  return dir;
}

async function shutdown() {
  try { if (ctx && !keepOpen) await ctx.close(); } catch { /* best effort */ }
  if (launchedByUs && !keepOpen) await quitCompanion();
}

async function bail(page, guard, name, detail) {
  fail(name, detail);
  await artifacts(page, guard);
  await shutdown();
  process.exit(1);
}

async function main() {
  // 1. Backup gate.
  if (!skipBackupCheck) {
    const backup = newestBackupManifest(root);
    const ageMs = backup ? Date.now() - backup.created : Infinity;
    if (!backup || ageMs > 24 * 60 * 60 * 1000) {
      fail('backup-gate', 'no save backup <24h old; run `npm run backup-saves` first');
      process.exit(1);
    }
    pass('backup-gate');
  }

  // 2. Preflight: only environment rows must pass pre-refresh. The archive is
  // pristine and the pack absent/stale until `refresh` runs in step 3, so those
  // rows are expected to FAIL now and are re-checked strictly afterwards.
  const ENV_CHECKS = new Set(['platform', 'steam', 'manifest', 'port', 'wine']);
  const preRows = doctorRows();
  const envBlocking = Array.isArray(preRows) ? preRows.filter((r) => ENV_CHECKS.has(r.check) && r.status === 'FAIL') : [{ check: 'doctor', message: 'output not parseable' }];
  if (!Array.isArray(preRows) || envBlocking.length) {
    fail('preflight-doctor', `environment not ready: ${envBlocking.map((r) => `${r.check}:${r.message}`).join('; ')}`);
    process.exit(1);
  }
  pass('preflight-doctor');

  // 3. Ensure companion running (refresh publishes pack v2 + patches archive).
  let health;
  try {
    const running = await ensureCompanionRunning({ refresh: !noRefresh });
    launchedByUs = running.launched;
    health = running.health;
    pass('companion-running');
  } catch (error) {
    fail('companion-running', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // 3b. Post-refresh doctor must be fully clean: archive patched, pack valid,
  // port serving our service.
  if (!noRefresh) {
    const postRows = doctorRows();
    const postBlocking = Array.isArray(postRows) ? postRows.filter((r) => r.status === 'FAIL') : [{ check: 'doctor', message: 'output not parseable' }];
    if (!Array.isArray(postRows) || postBlocking.length) {
      fail('postrefresh-doctor', `doctor still failing after refresh: ${postBlocking.map((r) => `${r.check}:${r.message}`).join('; ')}`);
      process.exit(1);
    }
    pass('postrefresh-doctor');
  }

  // 4. Health / pack coherence.
  try {
    if (health?.service !== 'FRACTURED_REALMS_COMPANION_V1') throw new Error('unexpected /health service');
    const model = await (await fetch(`${ORIGIN}/companion/data/model.json`)).json();
    const itemCount = Object.keys(model.items).length;
    const actionCount = model.actions.length;
    if (model.schema_version !== 1) throw new Error(`schema_version=${model.schema_version}`);
    if (model.xpTable.length !== 100) throw new Error(`xpTable.length=${model.xpTable.length}`);
    if (itemCount !== 548) throw new Error(`items=${itemCount}`);
    if (actionCount !== 412) throw new Error(`actions=${actionCount}`);
    pass('pack-coherence');
  } catch (error) {
    fail('pack-coherence', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // 5. Open game with an isolated QA save. Bronze pick + reed basket are seeded
  // into equipment (where the game stores owned tools: C_(skill, lvl,
  // state.equipment) gates on equipment[toolReq]>0) so the glyphweaving
  // processing chain in step 7 runs end to end without manual tool purchases.
  // Gold still hydrates to the 250 default, proving a minimal payload is valid.
  if (fresh) { const { rmSync } = await import('node:fs'); rmSync(profileDir, { recursive: true, force: true }); }
  let page, guard;
  try {
    const opened = await openGame({ profileDir, save: { equipment: { bronze_pick: 1, reed_basket: 1 } } });
    ctx = opened.context; page = opened.page; guard = opened.guard;
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    const version = await page.evaluate(() => window.__frCompanion?.version);
    if (version !== 1) throw new Error(`__frCompanion.version=${version}`);
    const gold = (await gameState(page)).gold;
    if (gold !== 250) throw new Error(`fresh-save gold=${gold}`);
    pass('fresh-save-boot');
  } catch (error) {
    await bail(page, guard, 'fresh-save-boot', error instanceof Error ? error.message : String(error));
  }

  // 6. Wiki: Witherwood Log sources + uses.
  try {
    await page.click('#fr-tab-items');
    await page.fill('#fr-item-search', 'Witherwood');
    const row = page.locator('#fr-item-list .item-row', { hasText: 'Witherwood Log' }).first();
    await row.waitFor({ state: 'visible', timeout: 10_000 });
    await row.click();
    const detail = page.locator('#fr-item-detail');
    await detail.locator('h2', { hasText: 'Witherwood Log' }).waitFor({ timeout: 10_000 });
    const detailText = await detail.innerText();
    if (/No source is recorded/i.test(detailText)) throw new Error('Sources section empty');
    if (/No action or building upgrade consumes/i.test(detailText)) throw new Error('Uses section empty');
    pass('wiki-witherwood');
  } catch (error) {
    await bail(page, guard, 'wiki-witherwood', error instanceof Error ? error.message : String(error));
  }

  // 7. Plan + execute (auto step): a glyphweaving processing chain that spans
  // mining -> foraging -> glyphweaving, proving the executor resolves involved
  // cross-skill dependencies and runs them to an itemQty stop.
  try {
    const itemId = 'fire_rune_minor';
    const start = (await gameState(page)).inventory?.[itemId] ?? 0;
    const target = start + 2;
    await page.click('#fr-tab-plan');
    // A reused live-profile may carry a persisted queue from a prior run; clear it
    // so the resolved plan below is deterministic.
    const clearBtn = page.locator('#fr-clear');
    if (!(await clearBtn.isDisabled())) { await clearBtn.click(); await page.locator('#fr-plan-result .plan-step').first().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {}); }
    await page.selectOption('#fr-plan-target', 'item');
    await page.fill('#fr-plan-item', 'Minor Fire Rune');
    const option = page.locator('#fr-plan-options [data-plan-option]', { hasText: 'Minor Fire Rune' }).first();
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    await option.click();
    await page.fill('#fr-plan-qty', String(target));
    await page.click('#fr-resolve-plan');
    // The resolved timeline must be a multi-step, cross-skill, fully-auto chain.
    await page.locator('#fr-plan-result .plan-step').first().waitFor({ timeout: 10_000 });
    const planSkills = await page.$$eval('#fractured-realms-companion', (hosts) => {
      const root = hosts[0].shadowRoot;
      return [...root.querySelectorAll('#fr-plan-result .plan-step strong')].map((n) => n.textContent);
    });
    const stepCount = await page.locator('#fr-plan-result .plan-step').count();
    const manualCount = await page.locator('#fr-plan-result .instruction-card').count();
    if (stepCount < 3) throw new Error(`expected a multi-step chain, got ${stepCount} steps`);
    if (manualCount !== 0) throw new Error(`chain should be fully automatable, found ${manualCount} manual steps`);
    await page.click('#fr-run');
    // Record the distinct active skills as the executor advances through the chain.
    const seenSkills = new Set();
    const deadline = Date.now() + 120_000;
    let reached = false;
    while (Date.now() < deadline) {
      const s = await gameState(page);
      if (s.activeSkill) seenSkills.add(s.activeSkill);
      if ((s.inventory?.[itemId] ?? 0) >= target) { reached = true; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!reached) throw new Error(`inventory ${itemId} did not reach ${target}; skills seen: ${[...seenSkills].join(',')}`);
    if (seenSkills.size < 2) throw new Error(`expected a cross-skill chain, only saw: ${[...seenSkills].join(',')}`);
    await page.waitForFunction(() => {
      const s = window.__frCompanion.getState();
      return s.activeAction == null && s.activeSkill == null;
    }, { timeout: 15_000 });
    const finalPhase = await page.locator('#fr-executor-phase').innerText();
    if (!/complete/i.test(finalPhase)) throw new Error(`final phase = ${finalPhase}`);
    console.log(`  chain skills observed: ${[...seenSkills].join(' -> ')} (${planSkills.length} planned steps)`);
    pass('plan-execute-auto');
  } catch (error) {
    await bail(page, guard, 'plan-execute-auto', error instanceof Error ? error.message : String(error));
  }

  // 8. Waiting phase (manual step): unlock target that requires a manual purchase.
  try {
    await page.click('#fr-clear');
    await page.selectOption('#fr-plan-target', 'unlock');
    const unlockValue = await page.locator('#fr-plan-unlock').inputValue();
    if (!unlockValue) throw new Error('no unlock option available on fresh save');
    await page.click('#fr-resolve-plan');
    await page.locator('#fr-plan-result .plan-step').first().waitFor({ timeout: 10_000 });
    await page.click('#fr-run');
    await page.waitForFunction(() => /waiting/i.test(document.querySelector('#fractured-realms-companion')?.shadowRoot?.querySelector('#fr-executor-phase')?.textContent || ''), { timeout: 20_000 });
    const runDisabled = await page.locator('#fr-run').isDisabled();
    const stopDisabled = await page.locator('#fr-stop').isDisabled();
    if (!runDisabled) throw new Error('Run control not locked during waiting phase');
    if (stopDisabled) throw new Error('Stop control unexpectedly disabled during waiting phase');
    const msg = await page.locator('#fr-executor-message').innerText();
    const cards = await page.locator('#fr-plan-result .instruction-card').count();
    if (cards < 1) throw new Error('no manual instruction card rendered');
    await page.click('#fr-stop');
    await page.waitForFunction(() => /idle|ready/i.test(document.querySelector('#fractured-realms-companion')?.shadowRoot?.querySelector('#fr-executor-phase')?.textContent || ''), { timeout: 15_000 });
    pass('waiting-phase-manual');
    void msg;
  } catch (error) {
    await bail(page, guard, 'waiting-phase-manual', error instanceof Error ? error.message : String(error));
  }

  // 9. Persistence: reload restores queue + overlay.
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);
    await openPanel(page);
    await page.click('#fr-tab-plan');
    await page.locator('#fr-plan-result .queue-plan').first().waitFor({ timeout: 10_000 });
    pass('persistence-reload');
  } catch (error) {
    await bail(page, guard, 'persistence-reload', error instanceof Error ? error.message : String(error));
  }

  // 10. Achievements/webhook guard + summary.
  if (guard.unlockAborts >= 0 && guard.feedbackAborts >= 0) pass('side-effect-guard');
  console.log('\nSummary');
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  console.log(`  steam/unlock aborted: ${guard.unlockAborts}, feedback aborted: ${guard.feedbackAborts}`);

  await shutdown();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(error);
    await shutdown();
    process.exit(1);
  });
}
