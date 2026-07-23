import { unlinkSync } from 'node:fs';
import { openDatabase } from '../lib/sqlite.ts';
import type { GameModel } from './compile.ts';

// This database is an introspection projection. Nested values not represented
// by a child table are retained as JSON so no model information is lost.
function q(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
function scalar(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}
function json(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}
function objectEntries(value: unknown): Array<[string, unknown]> {
  return value && typeof value === 'object' ? Object.entries(value as Record<string, unknown>) : [];
}
function insert(db: ReturnType<typeof openDatabase>, table: string, columns: string[], values: unknown[]): void {
  if (!db) throw new Error('database unavailable');
  db.run(`INSERT INTO ${q(table)} (${columns.map(q).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, ...values);
}

function schema(db: NonNullable<ReturnType<typeof openDatabase>>): void {
  db.exec(`
    CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT, category TEXT, data_json TEXT NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, label TEXT, icon TEXT, type TEXT, subtype TEXT, desc TEXT, value REAL, art INTEGER, data_json TEXT NOT NULL);
    CREATE TABLE equipment (item_id TEXT PRIMARY KEY, slot TEXT, def REAL, data_json TEXT NOT NULL);
    CREATE TABLE enemy_attacks (enemy_id TEXT, name TEXT, weight REAL, mult REAL, msg TEXT, icon TEXT, data_json TEXT NOT NULL);
    CREATE TABLE shop (item_id TEXT PRIMARY KEY, price REAL);
    CREATE TABLE actions (id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, name TEXT, level_req INTEGER, xp REAL, interval INTEGER, tool_req TEXT, pattern_req TEXT, prayer_req INTEGER, recipe_scroll TEXT, category TEXT, spot TEXT, metal TEXT, hide TEXT, rune_type TEXT, tier TEXT, target_id TEXT, kill_count INTEGER, combat_req INTEGER, gate_map_id TEXT, gate_skill_level INTEGER, automation TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE action_inputs (action_id TEXT, item_id TEXT, qty REAL);
    CREATE TABLE action_outputs (action_id TEXT, item_id TEXT, qty REAL);
    CREATE TABLE action_rares (action_id TEXT, item_id TEXT, qty REAL, chance REAL);
    CREATE TABLE tools (skill_id TEXT, id TEXT, name TEXT, icon TEXT, cost REAL, level_req INTEGER, xp_bonus REAL, speed_bonus REAL, data_json TEXT NOT NULL, PRIMARY KEY(skill_id,id));
    CREATE TABLE maps (id TEXT PRIMARY KEY, name TEXT, tier TEXT, level_req INTEGER, xp REAL, interval INTEGER, actions_to_chart INTEGER, "group" TEXT, data_json TEXT NOT NULL);
    CREATE TABLE chart_supply_tiers (tier TEXT PRIMARY KEY, label TEXT, color TEXT, supplies_json TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE agility_courses (id TEXT PRIMARY KEY, name TEXT, art TEXT, level_req INTEGER, lap_xp REAL, desc TEXT, data_json TEXT NOT NULL);
    CREATE TABLE obstacles (course_id TEXT, obstacle_id TEXT, name TEXT, xp REAL, interval INTEGER, data_json TEXT NOT NULL);
    CREATE TABLE bags (id TEXT PRIMARY KEY, size INTEGER, name TEXT, name_key TEXT, cost REAL, agility_req INTEGER, desc_key TEXT, data_json TEXT NOT NULL);
    CREATE TABLE machines (id TEXT PRIMARY KEY, name TEXT, icon TEXT, tinkering_level_req INTEGER, buff_json TEXT NOT NULL, cost_json TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE machine_costs (machine_id TEXT, item_id TEXT, qty REAL);
    CREATE TABLE boons (id TEXT PRIMARY KEY, name TEXT, icon TEXT, input TEXT, level_req INTEGER, xp REAL, grant_pattern TEXT, boon_json TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE restorations (id TEXT PRIMARY KEY, name TEXT, input TEXT, input_qty REAL, output TEXT, level_req INTEGER, xp REAL, materials_json TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE recipe_meals (id TEXT PRIMARY KEY, name TEXT, icon TEXT, recipe_scroll TEXT, scroll_name TEXT, level_req INTEGER, xp REAL, interval INTEGER, output TEXT, heal_amount REAL, inputs_json TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE seals (id TEXT PRIMARY KEY, skill_id TEXT, name TEXT, data_json TEXT NOT NULL);
    CREATE TABLE seal_buffs (seal_id TEXT, type TEXT, skill_id TEXT, value REAL);
    CREATE TABLE patterns (id TEXT PRIMARY KEY, name TEXT, desc TEXT, from_id TEXT, data_json TEXT NOT NULL);
    CREATE TABLE grand_reward (id INTEGER PRIMARY KEY, name TEXT, icon TEXT, item_id TEXT, gold_qty REAL, all_xp_bonus REAL, data_json TEXT NOT NULL);
    CREATE TABLE buildings (id TEXT PRIMARY KEY, name TEXT, icon TEXT, skill TEXT, col INTEGER, row INTEGER, reveal_level INTEGER, desc TEXT, data_json TEXT NOT NULL);
    CREATE TABLE building_upgrades (building_id TEXT, level INTEGER, label TEXT, costs_json TEXT NOT NULL, unlocks_json TEXT, data_json TEXT NOT NULL, PRIMARY KEY(building_id,level));
    CREATE TABLE building_upgrade_costs (building_id TEXT, level INTEGER, item_id TEXT, qty REAL);
    CREATE TABLE outpost_xp (outpost_id TEXT, level INTEGER, skill_id TEXT, bonus REAL);
    CREATE TABLE zones (id TEXT PRIMARY KEY, name TEXT, icon TEXT, art TEXT, level_req INTEGER, desc TEXT, data_json TEXT NOT NULL);
    CREATE TABLE enemies (zone_id TEXT, id TEXT, name TEXT, icon TEXT, level INTEGER, hp REAL, attack_speed REAL, max_hit REAL, defence_level INTEGER, xp REAL, tags_json TEXT, attack_style TEXT, weakness TEXT, element TEXT, special_json TEXT, data_json TEXT NOT NULL, PRIMARY KEY(zone_id,id));
    CREATE TABLE enemy_drops (zone_id TEXT, enemy_id TEXT, item_id TEXT, chance REAL, qty REAL);
    CREATE TABLE digsites (id TEXT PRIMARY KEY, name TEXT, level_req INTEGER, data_json TEXT NOT NULL);
    CREATE TABLE achievements (id TEXT PRIMARY KEY, name TEXT, icon TEXT, category TEXT, secret INTEGER, desc TEXT, data_json TEXT NOT NULL);
    CREATE TABLE offline_gold (level TEXT PRIMARY KEY, gold_per_min REAL);
    CREATE TABLE prestige_titles (skill_id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE strings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE xp_table (level INTEGER PRIMARY KEY, xp REAL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
}

function writeRows(db: NonNullable<ReturnType<typeof openDatabase>>, model: GameModel): void {
  for (const [id, value] of Object.entries(model.items)) {
    const item = asRecord(value);
    insert(db, 'items', ['id', 'label', 'icon', 'type', 'subtype', 'desc', 'value', 'art', 'data_json'], [id, scalar(item.label), scalar(item.icon), scalar(item.type), scalar(item.subtype), scalar(item.desc), scalar(item.value), item.art ? 1 : 0, json(item)]);
  }
  for (const [itemId, price] of Object.entries(model.shop)) insert(db, 'shop', ['item_id', 'price'], [itemId, price]);
  for (const [itemId, value] of Object.entries(model.equipment)) {
    const row = asRecord(value);
    insert(db, 'equipment', ['item_id', 'slot', 'def', 'data_json'], [itemId, scalar(row.slot), scalar(row.def), json(row)]);
  }
  for (const [enemyId, moves] of Object.entries(model.enemyAttacks)) for (const move of moves) {
    const row = asRecord(move);
    insert(db, 'enemy_attacks', ['enemy_id', 'name', 'weight', 'mult', 'msg', 'icon', 'data_json'], [enemyId, scalar(row.name), scalar(row.weight), scalar(row.mult), scalar(row.msg), scalar(row.icon), json(row)]);
  }
  for (const skill of model.skills) {
    const row = asRecord(skill);
    insert(db, 'skills', ['id', 'name', 'category', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.category), json(row)]);
  }
  for (const action of model.actions) {
    const row = asRecord(action);
    const gate = asRecord(row.gate);
    insert(db, 'actions', ['id', 'skill_id', 'name', 'level_req', 'xp', 'interval', 'tool_req', 'pattern_req', 'prayer_req', 'recipe_scroll', 'category', 'spot', 'metal', 'hide', 'rune_type', 'tier', 'target_id', 'kill_count', 'combat_req', 'gate_map_id', 'gate_skill_level', 'automation', 'data_json'], [
      scalar(row.id), scalar(row.skillId), scalar(row.name), scalar(row.levelReq), scalar(row.xp), scalar(row.interval), scalar(row.toolReq), scalar(row.patternReq), scalar(row.prayerReq), scalar(row.recipeScroll), scalar(row.category), scalar(row.spot), scalar(row.metal), scalar(row.hide), scalar(row.runeType), scalar(row.tier), scalar(row.targetId), scalar(row.killCount), scalar(row.combatReq), row.gate === null ? null : scalar(gate.mapId), row.gate === null ? null : scalar(gate.skillLevel), scalar(row.automation), json(row),
    ]);
    for (const [itemId, qty] of objectEntries(row.inputs)) insert(db, 'action_inputs', ['action_id', 'item_id', 'qty'], [row.id, itemId, qty]);
    for (const [itemId, qty] of objectEntries(row.outputs)) insert(db, 'action_outputs', ['action_id', 'item_id', 'qty'], [row.id, itemId, qty]);
    if (Array.isArray(row.rareOutputs)) for (const rare of row.rareOutputs) {
      const r = asRecord(rare);
      insert(db, 'action_rares', ['action_id', 'item_id', 'qty', 'chance'], [row.id, scalar(r.item), scalar(r.qty), scalar(r.chance)]);
    }
  }
  for (const [skillId, tools] of Object.entries(model.tools)) for (const tool of tools) {
    const row = asRecord(tool);
    insert(db, 'tools', ['skill_id', 'id', 'name', 'icon', 'cost', 'level_req', 'xp_bonus', 'speed_bonus', 'data_json'], [skillId, scalar(row.id), scalar(row.name), scalar(row.icon), scalar(row.cost), scalar(row.levelReq), scalar(row.xpBonus), scalar(row.speedBonus), json(row)]);
  }
  for (const map of model.maps) {
    const row = asRecord(map);
    insert(db, 'maps', ['id', 'name', 'tier', 'level_req', 'xp', 'interval', 'actions_to_chart', 'group', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.tier), scalar(row.levelReq), scalar(row.xp), scalar(row.interval), scalar(row.actionsToChart), scalar(row.group), json(row)]);
  }
  for (const [tier, value] of Object.entries(model.chartSupplyTiers)) {
    const row = asRecord(value);
    insert(db, 'chart_supply_tiers', ['tier', 'label', 'color', 'supplies_json', 'data_json'], [tier, scalar(row.label), scalar(row.color), json(row.supplies), json(row)]);
  }
  for (const course of model.agilityCourses) {
    const row = asRecord(course);
    insert(db, 'agility_courses', ['id', 'name', 'art', 'level_req', 'lap_xp', 'desc', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.art), scalar(row.levelReq), scalar(row.lapXp), scalar(row.desc), json(row)]);
    if (Array.isArray(row.obstacles)) for (const obstacle of row.obstacles) {
      const o = asRecord(obstacle);
      insert(db, 'obstacles', ['course_id', 'obstacle_id', 'name', 'xp', 'interval', 'data_json'], [row.id, scalar(o.id), scalar(o.name), scalar(o.xp), scalar(o.interval), json(o)]);
    }
  }
  for (const bag of model.bags) { const row = asRecord(bag); insert(db, 'bags', ['id', 'size', 'name', 'name_key', 'cost', 'agility_req', 'desc_key', 'data_json'], [scalar(row.id), scalar(row.size), scalar(row.name), scalar(row.nameKey), scalar(row.cost), scalar(row.agilityReq), scalar(row.descKey), json(row)]); }
  for (const machine of model.machines) {
    const row = asRecord(machine); const cost = asRecord(row.cost);
    insert(db, 'machines', ['id', 'name', 'icon', 'tinkering_level_req', 'buff_json', 'cost_json', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.icon), scalar(row.tinkeringLevelReq), json(row.buff), json(cost), json(row)]);
    for (const [itemId, qty] of Object.entries(cost)) insert(db, 'machine_costs', ['machine_id', 'item_id', 'qty'], [row.id, itemId, qty]);
  }
  for (const boon of model.boons) { const row = asRecord(boon); const nested = asRecord(row.boon); insert(db, 'boons', ['id', 'name', 'icon', 'input', 'level_req', 'xp', 'grant_pattern', 'boon_json', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.icon), scalar(row.input), scalar(row.levelReq), scalar(row.xp), scalar(row.grantPattern), json(nested), json(row)]); }
  for (const restoration of model.restorations) { const row = asRecord(restoration); insert(db, 'restorations', ['id', 'name', 'input', 'input_qty', 'output', 'level_req', 'xp', 'materials_json', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.input), scalar(row.inputQty), scalar(row.output), scalar(row.levelReq), scalar(row.xp), json(row.materials), json(row)]); }
  for (const meal of model.recipeMeals) { const row = asRecord(meal); insert(db, 'recipe_meals', ['id', 'name', 'icon', 'recipe_scroll', 'scroll_name', 'level_req', 'xp', 'interval', 'output', 'heal_amount', 'inputs_json', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.icon), scalar(row.recipeScroll), scalar(row.scrollName), scalar(row.levelReq), scalar(row.xp), scalar(row.interval), scalar(row.output), scalar(row.healAmount), json(row.inputs), json(row)]); }
  for (const seal of model.seals) {
    const row = asRecord(seal); insert(db, 'seals', ['id', 'skill_id', 'name', 'data_json'], [scalar(row.id), scalar(row.skillId), scalar(row.name), json(row)]);
    if (Array.isArray(row.buffs)) for (const buff of row.buffs) { const b = asRecord(buff); insert(db, 'seal_buffs', ['seal_id', 'type', 'skill_id', 'value'], [row.id, scalar(b.type), scalar(b.skill ?? row.skillId), scalar(b.value)]); }
  }
  for (const [id, value] of Object.entries(model.patterns)) { const row = asRecord(value); insert(db, 'patterns', ['id', 'name', 'desc', 'from_id', 'data_json'], [id, scalar(row.name), scalar(row.desc), scalar(row.from), json(row)]); }
  const reward = model.grandReward;
  insert(db, 'grand_reward', ['id', 'name', 'icon', 'item_id', 'gold_qty', 'all_xp_bonus', 'data_json'], [1, scalar(reward.name), scalar(reward.icon), scalar(reward.itemId), scalar(reward.goldQty), scalar(reward.allXpBonus), json(reward)]);
  for (const building of model.buildings) {
    const row = asRecord(building); insert(db, 'buildings', ['id', 'name', 'icon', 'skill', 'col', 'row', 'reveal_level', 'desc', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.icon), scalar(row.skill), scalar(row.col), scalar(row.row), scalar(row.revealLevel), scalar(row.desc), json(row)]);
    if (Array.isArray(row.upgrades)) for (const upgrade of row.upgrades) { const u = asRecord(upgrade); insert(db, 'building_upgrades', ['building_id', 'level', 'label', 'costs_json', 'unlocks_json', 'data_json'], [row.id, scalar(u.level), scalar(u.label), json(u.cost), json(u.unlocks), json(u)]); for (const [itemId, qty] of objectEntries(u.cost)) if (itemId !== 'gold') insert(db, 'building_upgrade_costs', ['building_id', 'level', 'item_id', 'qty'], [row.id, u.level, itemId, qty]); }
  }
  for (const [buildingId, levels] of Object.entries(model.buildingXp)) for (const [level, skills] of Object.entries(levels)) for (const [skillId, bonus] of Object.entries(skills)) insert(db, 'outpost_xp', ['outpost_id', 'level', 'skill_id', 'bonus'], [buildingId, Number(level), skillId, bonus]);
  for (const zone of model.zones) {
    const row = asRecord(zone); insert(db, 'zones', ['id', 'name', 'icon', 'art', 'level_req', 'desc', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.icon), scalar(row.art), scalar(row.levelReq), scalar(row.desc), json(row)]);
    if (Array.isArray(row.enemies)) for (const enemy of row.enemies) {
      const e = asRecord(enemy); insert(db, 'enemies', ['zone_id', 'id', 'name', 'icon', 'level', 'hp', 'attack_speed', 'max_hit', 'defence_level', 'xp', 'tags_json', 'attack_style', 'weakness', 'element', 'special_json', 'data_json'], [row.id, scalar(e.id), scalar(e.name), scalar(e.icon), scalar(e.level), scalar(e.hp), scalar(e.attackSpeed), scalar(e.maxHit), scalar(e.defenceLevel), scalar(e.xp), json(e.tags), scalar(e.attackStyle), scalar(e.weakness), scalar(e.element), json(e.special), json(e)]);
      if (Array.isArray(e.drops)) for (const drop of e.drops) { const d = asRecord(drop); insert(db, 'enemy_drops', ['zone_id', 'enemy_id', 'item_id', 'chance', 'qty'], [row.id, e.id, scalar(d.id), scalar(d.chance), scalar(d.qty)]); }
    }
  }
  for (const digsite of model.digsites) { const row = asRecord(digsite); insert(db, 'digsites', ['id', 'name', 'level_req', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.levelReq), json(row)]); }
  for (const achievement of model.achievements) { const row = asRecord(achievement); insert(db, 'achievements', ['id', 'name', 'icon', 'category', 'secret', 'desc', 'data_json'], [scalar(row.id), scalar(row.name), scalar(row.icon), scalar(row.category), row.secret ? 1 : 0, scalar(row.desc), json(row)]); }
  for (const [level, amount] of Object.entries(model.offlineGold)) insert(db, 'offline_gold', ['level', 'gold_per_min'], [level, amount]);
  if (model.prestigeTitles) for (const [skillId, title] of Object.entries(model.prestigeTitles)) insert(db, 'prestige_titles', ['skill_id', 'title'], [skillId, title]);
  for (const [key, value] of Object.entries(model.stringsEn)) insert(db, 'strings', ['key', 'value'], [key, value]);
  model.xpTable.forEach((xp, level) => insert(db, 'xp_table', ['level', 'xp'], [level, xp]));

  insert(db, 'meta', ['key', 'json'], ['chartSupplyTiers', json(model.chartSupplyTiers)]);
  insert(db, 'meta', ['key', 'json'], ['patterns', json(model.patterns)]);
  insert(db, 'meta', ['key', 'json'], ['grandReward', json(model.grandReward)]);
  insert(db, 'meta', ['key', 'json'], ['offlineGold', json(model.offlineGold)]);
  insert(db, 'meta', ['key', 'json'], ['prestigeTitles', json(model.prestigeTitles)]);
}

/** Write a derived SQLite projection, returning false when SQLite is unavailable or the write fails. */
export function writeModelDb(model: GameModel, path: string): boolean {
  if (!path.startsWith(':')) {
    try { unlinkSync(path); } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code !== 'ENOENT') return false; }
  }
  const db = openDatabase(path);
  if (!db) return false;
  try {
    db.exec('BEGIN');
    schema(db);
    writeRows(db, model);
    db.exec('COMMIT');
    return true;
  } catch {
    try { db.exec('ROLLBACK'); } catch { /* best effort */ }
    return false;
  } finally {
    db.close();
  }
}
