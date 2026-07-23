import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFile, listFiles } from '../../src/lib/asar.ts';
import { evalLiteral, sliceEnclosing } from '../../src/extract/scan.ts';
import { extractRegistries } from '../../src/extract/registries.ts';
import { compileModel } from '../../src/model/compile.ts';
import { writeModelDb } from '../../src/model/sqlite.ts';
import { openDatabase, sqliteAvailable } from '../../src/lib/sqlite.ts';

const ACTION_SKILLS = ['woodcutting', 'mining', 'fishing', 'foraging', 'trapping', 'archaeology', 'smithing', 'crafting', 'cooking', 'brewing', 'glyphweaving', 'prayer', 'bounty'];

function fixture(): string {
  const items = Array.from({ length: 400 }, (_, i) => `${i === 0 ? 'witherwood_log' : `item_${i}`}:{label:"${i === 0 ? 'Witherwood Log' : `Item ${i}`}#",type:"material",value:${i}}`).join(',');
  const actions = ACTION_SKILLS.map((skill, i) => {
    const id = skill === 'woodcutting' ? 'chop_witherwood' : `act_${skill}`;
    const bounty = skill === 'bounty' ? ',targetId:"cow",killCount:3,combatReq:2' : '';
    return `${skill}:[{id:"${id}",levelReq:${i + 1},xp:2,interval:100,outputs:{ancient_spore:1}${bounty}}]`;
  }).join(',');
  const gates = '{chop_witherwood:{mapId:"millhaven_village",skillLevel:2}}';
  const skills = Array.from({ length: 15 }, (_, i) => `{id:"skill_${i}",name:"Skill ${i}",category:"support"}`).join(',');
  const tools = [
    'woodcutting:[{id:"bronze_axe",name:"Bronze Axe",levelReq:1,xpBonus:0,speedBonus:0}]',
    'mining:[{id:"bronze_pick",name:"Bronze Pick",levelReq:1,xpBonus:0,speedBonus:0}]',
    'fishing:[{id:"basic_rod",name:"Basic Rod",levelReq:1,xpBonus:0,speedBonus:0}]',
    'trapping:[{id:"basic_trap",name:"Basic Trap",levelReq:1,xpBonus:0,speedBonus:0}]',
    'archaeology:[{id:"basic_trowel",name:"Basic Trowel",levelReq:1,xpBonus:0,speedBonus:0}]',
    'foraging:[{id:"reed_basket",name:"Reed Basket",levelReq:1,xpBonus:0,speedBonus:0}]',
    'smithing:[{id:"inscribed_hammer",name:"Inscribed Hammer",levelReq:1,xpBonus:0,speedBonus:0}]',
    'brewing:[{id:"inscribed_alembic",name:"Inscribed Alembic",levelReq:1,xpBonus:0,speedBonus:0}]',
    'glyphweaving:[{id:"inscribed_quill",name:"Inscribed Quill",levelReq:1,xpBonus:0,speedBonus:0}]',
  ].join(',');
  const courses = '[{id:"millhaven_rooftops",name:"Rooftops",levelReq:1,lapXp:5,obstacles:[{id:"jump",name:"Jump",xp:2,interval:10}]}]';
  const bags = '[{id:"travellers_pouch",size:60,name:"Pouch",cost:500,agilityReq:5}]';
  const machines = '[{id:"whetstone_engine",name:"Whetstone",buff:{type:"xp",value:.1},cost:{gold:100}}]';
  const boons = '[{id:"consecrate_totem",name:"Totem",input:"broken_totem",levelReq:1,xp:2,boon:{id:"favour",name:"Favour",bonuses:{woodcutting:.1}}}]';
  const restorations = '[{id:"restore_totem",name:"Totem",input:"broken_totem",inputQty:1,output:"ancient_totem",levelReq:1,xp:2,materials:{stone:1}}]';
  const meals = '[{id:"meal_hunters_stew",name:"Stew",recipeScroll:"recipe_stew",levelReq:1,xp:2,interval:100,inputs:{meat:1},output:"stew",healAmount:2}]';
  const seals = '[{id:"seal_woodcutting",skillId:"woodcutting",name:"Seal",buffs:[{type:"xp",skill:"woodcutting",value:.1}]}]';
  const zones = '[{id:"thornwood",name:"Thornwood Outskirts",levelReq:1,enemies:[{id:"cow",hp:3,drops:[{id:"bones",chance:1,qty:1}],tags:[Xy]}]}]';
  const achievements = '[{id:"secret_millionaire",name:"Millionaire",icon:"coin",category:"Secrets",secret:true,desc:"Have gold",check:()=>true}]';
  const equipment = Array.from({ length: 100 }, (_, i) => `${i === 0 ? 'bronze_helm' : `helm_${i}`}:{slot:"helm",def:${i === 0 ? 5 : i + 1}}`).join(',');
  const enemyAttacks = Array.from({ length: 40 }, (_, i) => `${i === 0 ? 'giant_rat' : `enemy_${i}`}:[{name:"Gnaw",weight:60,mult:1,msg:"gnaws",icon:"🦷"}]`).join(',');
  return [
    `const ITEMS={${items}};`,
    `const ACTIONS={${actions}};`,
    `const GATES=${gates};`,
    `const SKILLS=[{id:"hitpoints",name:"Hitpoints",category:"combat"},${skills}];`,
    `const TOOLS={${tools}};`,
    'const MAPS=[{id:"millhaven_village",name:"Millhaven Village Map",tier:"local",levelReq:1,xp:2,interval:100,actionsToChart:1}];',
    'const DEEP=[{id:"ds_veiled_shores",name:"Veiled Shores",tier:"deep",levelReq:1,xp:2,interval:100,actionsToChart:1}];',
    'const TIERS={local:{label:"Local Maps",supplies:{parchment:1,ink:1},color:"red"}};',
    `const COURSES=${courses};`,
    `const BAGS=${bags};`,
    `const MACHINES=${machines};`,
    `const BOONS=${boons};`,
    `const RESTORATIONS=${restorations};`,
    `const MEALS=${meals};`,
    `const SEALS=${seals};`,
    'const PATTERNS={pattern_earthen_script:{id:"pattern_earthen_script",name:"Earthen",desc:"desc",from:"totem"}};',
    'const REWARD={name:"The Shattered Crown",icon:"crown",itemId:"shattered_crown",goldQty:1000000,allXpBonus:.15};',
    'const BUILDINGS=[{id:"townHall",name:"Town Hall",upgrades:[]}];',
    'const BUILDING_XP={woodcuttersHut:{1:{woodcutting:.05}}};',
    'const Xy="undead"; const ZONES=' + zones + ';',
    `const ACHIEVEMENTS=${achievements};`,
    `const EQUIPMENT={${equipment}};`,
    `const ENEMY_ATTACKS={${enemyAttacks}};`,
    'const DIGS=[{id:"millhaven_ruins",name:"Ruins",levelReq:1}];',
    'const OFFLINE={1:10,2:30,3:100};',
    'const K8=new Set(["vial","bow_string"]);const Nz=["wild_berries","venison","woodland_seed","bog_mushroom","plains_seed","ember_spore","ancient_spore"],eM=2,kU=new Set(["vial","bow_string",...Nz]);',
    'const STRINGS={"name.ancient_spore":"Ancient Spore","itemdesc.ancient_spore":"A spore."};',
    'function xpGenerator(){const a=new Array(100).fill(0);for(let i=2;i<100;i++)a[i]=i*10+300*Math.pow(2,i/7);return a;}',
    'const TITLES={woodcutting:"Master of the Grove",mining:"Lord of the Deep",fishing:"Leviathan Tamer"};',
  ].join('\n');
}

test('scanner encloses nested literals and ignores brackets in strings', () => {
  const source = 'const root={nested:{text:"[not] {literal}",child:{value:1}},tail:2};';
  const child = source.indexOf('value:');
  assert.equal(sliceEnclosing(source, child, '{'), '{value:1}');
  assert.equal(sliceEnclosing(source, source.indexOf('tail:'), '{'), '{nested:{text:"[not] {literal}",child:{value:1}},tail:2}');
});

test('evalLiteral accepts identifier bindings and normalizes values', () => {
  assert.deepEqual(evalLiteral('{tags:[Xy], nested:{a:1}}', 'fixture', { Xy: 'undead' }), { tags: ['undead'], nested: { a: 1 } });
});

test('extracts every raw registry from a synthetic bundle', () => {
  const result = extractRegistries(fixture(), ['dist/art/icons/items/witherwood_log.png']);
  assert.equal(Object.keys(result.items).length, 400);
  assert.equal(result.items.witherwood_log.art, true);
  assert.equal(result.actions.bounty[0] && (result.actions.bounty[0] as Record<string, unknown>).targetId, 'cow');
  assert.equal(result.actionGates.chop_witherwood && (result.actionGates.chop_witherwood as Record<string, unknown>).skillLevel, 2);
  assert.equal(result.tools.smithing[0] && (result.tools.smithing[0] as Record<string, unknown>).id, 'inscribed_hammer');
  assert.equal((result.chartSupplyTiers.local as Record<string, unknown>).label, 'Local Maps');
  assert.equal((result.zones[0] as Record<string, unknown>).enemies && (((result.zones[0] as Record<string, unknown>).enemies as unknown[])[0] as Record<string, unknown>).tags && ((((result.zones[0] as Record<string, unknown>).enemies as unknown[])[0] as Record<string, unknown>).tags as unknown[])[0], 'undead');
  assert.equal(result.achievements[0].id, 'secret_millionaire');
  assert.equal(result.achievements[0].secret, true);
  assert.equal(result.prestigeTitles?.woodcutting, 'Master of the Grove');
  assert.equal(result.xp.length, 100);
  assert.equal(result.xp[2] > result.xp[1], true);
  assert.deepEqual(result.shopItems.slice(0, 2), ['vial', 'bow_string']);
  assert.equal(result.shopItems.includes('wild_berries'), true);
  assert.equal(result.shopPriceMultiplier, 2);
  assert.equal(Object.keys(result.equipment).length, 100);
  assert.equal(result.equipment.bronze_helm.def, 5);
  assert.equal(Object.keys(result.enemyAttacks).length, 40);
  assert.equal(result.enemyAttacks.giant_rat[0] && (result.enemyAttacks.giant_rat[0] as Record<string, unknown>).name, 'Gnaw');
});

test('fails closed for missing, duplicate, and malformed registry anchors', () => {
  assert.throws(() => extractRegistries(fixture().replace('witherwood_log:{label:', 'other_log:{label:'), []), /items dataset/);
  const duplicate = fixture() + '\nconst duplicate={witherwood_log:{label:"x",type:"material"}};';
  assert.throws(() => extractRegistries(duplicate, []), /items dataset: anchor is ambiguous/);
  assert.throws(() => extractRegistries(fixture().replace('id:"act_mining"', 'id:undefined'), []), /actions dataset/);
});

test('real v0.3 bundle registries', { skip: !process.env.FR_BUNDLE_ASAR }, () => {
  const archive = process.env.FR_BUNDLE_ASAR!;
  const files = listFiles(archive);
  const bundle = files.find((file) => /^dist\/assets\/index-.*\.js$/.test(file));
  assert.ok(bundle);
  const result = extractRegistries(extractFile(archive, bundle).toString('utf8'), files);
  const EXPECTED = { skills: 21, items: 548, actionGates: 120, actions: 412, zones: 12, enemies: 48, agilityCourses: 8, mapsRegular: 26, mapsDeep: 20, machines: 10, boons: 4, restorations: 4, recipeMeals: 4, seals: 21, buildings: 24, digsites: 4, tools: { woodcutting: 10, mining: 10, fishing: 7, trapping: 9, archaeology: 7, foraging: 9, smithing: 3, brewing: 3, glyphweaving: 3 }, actionsBySkill: { woodcutting: 11, mining: 13, fishing: 13, foraging: 18, trapping: 15, archaeology: 12, cooking: 35, smithing: 79, crafting: 105, brewing: 25, glyphweaving: 44, prayer: 6, bounty: 36 } };
  assert.equal(result.skills.length, EXPECTED.skills);
  assert.equal(Object.keys(result.items).length, EXPECTED.items);
  assert.equal(Object.keys(result.actionGates).length, EXPECTED.actionGates);
  assert.equal(Object.values(result.actions).reduce((sum, list) => sum + list.length, 0), EXPECTED.actions);
  assert.equal(result.zones.length, EXPECTED.zones);
  assert.equal(result.zones.reduce((sum, zone) => sum + ((zone as Record<string, unknown>).enemies as unknown[]).length, 0), EXPECTED.enemies);
  assert.equal(result.agilityCourses.length, EXPECTED.agilityCourses);
  assert.equal(result.mapsRegular.length, EXPECTED.mapsRegular);
  assert.equal(result.mapsDeep.length, EXPECTED.mapsDeep);
  assert.equal(result.machines.length, EXPECTED.machines);
  assert.equal(result.boons.length, EXPECTED.boons);
  assert.equal(result.restorations.length, EXPECTED.restorations);
  assert.equal(result.recipeMeals.length, EXPECTED.recipeMeals);
  assert.equal(result.seals.length, EXPECTED.seals);
  assert.equal(result.buildings.length, EXPECTED.buildings);
  assert.equal(result.digsites.length, EXPECTED.digsites);
  for (const [skill, count] of Object.entries(EXPECTED.tools)) assert.equal(result.tools[skill].length, count);
  for (const [skill, count] of Object.entries(EXPECTED.actionsBySkill)) assert.equal(result.actions[skill].length, count, `actions census for ${skill}`);

  const model = compileModel(result, 'test-build');
  assert.equal(model.actions.length, EXPECTED.actions);
  if (sqliteAvailable()) {
    const dir = mkdtempSync(join(tmpdir(), 'fr-model-'));
    try {
      const dbPath = join(dir, 'model.db');
      assert.equal(writeModelDb(model, dbPath), true);
      const db = openDatabase(dbPath);
      assert.ok(db);
      const rows = db!.all('SELECT COUNT(*) AS n FROM items') as Array<{ n: number }>;
      assert.equal(Number(rows[0]!.n), EXPECTED.items);
      db!.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
