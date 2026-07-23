import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawGameData } from '../../src/extract/registries.ts';
import { compileModel, serializeModel } from '../../src/model/compile.ts';
import { writeModelDb } from '../../src/model/sqlite.ts';
import { openDatabase, sqliteAvailable } from '../../src/lib/sqlite.ts';

function rawData(shuffled = false): RawGameData {
  const actions: Record<string, unknown[]> = {};
  const entries: Array<[string, unknown[]]> = [
    ['woodcutting', [{ id: 'chop', name: 'Chop', levelReq: 1, xp: 10, interval: 1000, inputs: { twig: 1 }, outputs: { log: 2 }, xpOld: 999, members: true, spot: { area: 'grove' } }]],
    ['bounty', [{ id: 'hunt', name: 'Hunt', levelReq: 1, xp: 20, interval: 2000, outputs: { gold: 5 }, targetId: 'rat', killCount: 2, combatReq: 1 }]],
  ];
  for (const [key, value] of entries) actions[key] = value;
  const xp = Array.from({ length: 100 }, (_, level) => level * 100);
  const items = shuffled
    ? { log: { label: 'Log', type: 'Resource', value: 2, art: false }, twig: { label: 'Twig', type: 'Resource', value: 1, art: false } }
    : { twig: { label: 'Twig', type: 'Resource', value: 1, art: false }, log: { label: 'Log', type: 'Resource', value: 2, art: false } };
  return {
    items,
    actions,
    actionGates: { chop: { mapId: 'millhaven', skillLevel: 2 } },
    skills: [{ id: 'woodcutting', name: 'Woodcutting', category: 'action' }, { id: 'bounty', name: 'Bounty', category: 'support' }],
    xp,
    tools: { woodcutting: [{ id: 'bronze_axe', levelReq: 1, xpBonus: 0, speedBonus: 0 }] },
    mapsRegular: [{ id: 'millhaven', name: 'Millhaven', tier: 'local', levelReq: 1, xp: 2, interval: 1000, actionsToChart: 1 }],
    mapsDeep: [{ id: 'deep', name: 'Deep', tier: 'deep', levelReq: 2, xp: 3, interval: 2000, actionsToChart: 2 }],
    chartSupplyTiers: { local: { label: 'Local', supplies: { parchment: 1, ink: 1 } } },
    agilityCourses: [{ id: 'course', name: 'Course', levelReq: 1, lapXp: 1, obstacles: [{ id: 'jump', name: 'Jump', xp: 1, interval: 100 }] }],
    bags: [{ id: 'bag', size: 24, name: 'Bag', cost: 1, agilityReq: 1 }],
    machines: [{ id: 'machine', name: 'Machine', buff: { type: 'xp', value: 0.1 }, cost: { gold: 10 } }],
    boons: [{ id: 'boon', name: 'Boon', input: 'relic', levelReq: 1, xp: 1, boon: { id: 'favour', name: 'Favour', bonuses: {} } }],
    restorations: [{ id: 'restore', name: 'Restore', input: 'broken', inputQty: 1, output: 'relic', levelReq: 1, xp: 1, materials: {} }],
    recipeMeals: [{ id: 'meal', name: 'Meal', recipeScroll: 'scroll', levelReq: 1, xp: 1, interval: 100, inputs: {}, output: 'food', healAmount: 1 }],
    seals: [{ id: 'seal', skillId: 'woodcutting', name: 'Seal', buffs: [{ type: 'xp', value: 0.1 }] }],
    patterns: { pattern: { id: 'pattern', name: 'Pattern', desc: 'desc', from: 'relic' } },
    grandReward: { name: 'Reward', icon: 'crown', itemId: 'crown', goldQty: 10, allXpBonus: 0.1 },
    buildings: [{ id: 'hut', name: 'Hut', upgrades: [] }],
    buildingXp: { hut: { '1': { woodcutting: 0.1 } } },
    zones: [{ id: 'zone', name: 'Zone', levelReq: 1, enemies: [{ id: 'rat', name: 'Rat', level: 1, hp: 1, drops: [{ id: 'twig', chance: 1, qty: 1 }] }] }],
    digsites: [{ id: 'dig', name: 'Dig', levelReq: 1 }],
    achievements: [{ id: 'achievement', name: 'Achievement', category: 'Goals' }],
    offlineGold: { '1': 10 },
    prestigeTitles: null,
    stringsEn: { 'name.log': 'Log' },
    shopItems: ['twig', 'log'],
    shopPriceMultiplier: 2,
    equipment: { bronze_helm: { slot: 'helm', def: 5 }, iron_helm: { slot: 'helm', def: 2 } },
    weapons: { bronze_sword: { type: 'melee', attack: 10, strength: 9, speed: 2600 } },
    equipRequirements: { bronze_helm: { skill: 'defence', level: 1 }, bronze_sword: { skill: 'attack', level: 1 } },
    foodHeal: { cooked_shrimp: 5, cooked_trout: 10 },
    secretItems: ['dragonfang_greatblade'],
    enemyAttacks: { rat: [{ name: 'Gnaw', weight: 60, mult: 1, msg: 'gnaws', icon: '🐀' }] },
    potions: { weak_str_potion: { slot: 'damage', mult: 0.02, durMs: 120000, cdMs: 240000, family: 'strength' } },
  };
}

test('compileModel flattens actions and creates deterministic model', () => {
  const model = compileModel(rawData(), 'build-test');
  assert.equal(model.schema_version, 1);
  assert.equal(model.build_id, 'build-test');
  assert.deepEqual(model.actions.map((action) => action.id), ['chop', 'hunt']);
  assert.deepEqual(model.actions[0].gate, { mapId: 'millhaven', skillLevel: 2 });
  assert.equal(model.actions[1].gate, null);
  assert.equal(model.actions[0].skillId, 'woodcutting');
  assert.equal(model.actions[0].automation, 'auto');
  assert.equal(model.actions[1].automation, 'manual');
  assert.equal('xpOld' in model.actions[0], false);
  assert.equal(model.maps[0].group, 'regular');
  assert.equal(model.maps[1].group, 'deep');
  assert.equal(serializeModel(model), serializeModel(compileModel(rawData(true), 'build-test')));
  assert.equal(serializeModel(model), serializeModel(model));
});

test('writeModelDb creates the derived projection', () => {
  const model = compileModel(rawData(), 'build-test');
  const directory = mkdtempSync(join(tmpdir(), 'fr-companion-model-'));
  const path = join(directory, 'model.db');
  try {
    const written = writeModelDb(model, path);
    if (!sqliteAvailable()) {
      assert.equal(written, false);
      return;
    }
    assert.equal(written, true);
    const db = openDatabase(path);
    assert.ok(db);
    assert.equal((db.all('SELECT COUNT(*) AS count FROM items')[0] as { count: number }).count, 2);
    assert.equal((db.all('SELECT item_id, price FROM shop WHERE item_id=?', 'log')[0] as { item_id: string; price: number }).price, 4);
    assert.equal((db.all('SELECT def FROM equipment WHERE item_id=?', 'bronze_helm')[0] as { def: number }).def, 5);
    assert.equal((db.all('SELECT kind, req_skill, req_level FROM equipment WHERE item_id=?', 'bronze_helm')[0] as { kind: string; req_skill: string; req_level: number }).req_skill, 'defence');
    assert.equal((db.all('SELECT kind, attack, req_skill, style FROM equipment WHERE item_id=?', 'bronze_sword')[0] as { kind: string; attack: number; req_skill: string; style: string }).kind, 'weapon');
    assert.equal((db.all('SELECT attack FROM equipment WHERE item_id=?', 'bronze_sword')[0] as { attack: number }).attack, 10);
    assert.equal((db.all('SELECT heal FROM food WHERE item_id=?', 'cooked_trout')[0] as { heal: number }).heal, 10);
    assert.equal((db.all('SELECT name FROM enemy_attacks WHERE enemy_id=?', 'rat')[0] as { name: string }).name, 'Gnaw');
    assert.equal((db.all('SELECT dur_ms FROM potions WHERE item_id=?', 'weak_str_potion')[0] as { dur_ms: number }).dur_ms, 120000);
    assert.equal((db.all('SELECT skill_id, automation FROM actions WHERE id=?', 'chop')[0] as { skill_id: string; automation: string }).skill_id, 'woodcutting');
    assert.equal((db.all('SELECT COUNT(*) AS count FROM action_inputs WHERE action_id=? AND item_id=?', 'chop', 'twig')[0] as { count: number }).count, 1);
    assert.equal((db.all('SELECT qty FROM action_outputs WHERE action_id=? AND item_id=?', 'chop', 'log')[0] as { qty: number }).qty, 2);
    assert.equal((db.all('SELECT COUNT(*) AS count FROM xp_table')[0] as { count: number }).count, 100);
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
