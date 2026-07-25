import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFile, listFiles } from '../../src/lib/asar.ts';
import { evalLiteral, sliceEnclosing } from '../../src/extract/scan.ts';
import { extractRegistries, anchor, AnchorHygieneError } from '../../src/extract/registries.ts';
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
  // The bundle has exactly one skills array, and titles are generated from it.
  const skills = [
    '{id:"woodcutting",name:"Woodcutting",category:"gathering"}',
    '{id:"mining",name:"Mining",category:"gathering"}',
    '{id:"fishing",name:"Fishing",category:"gathering"}',
    '{id:"prayer",name:"Prayer",category:"combat"}',
    '{id:"bounty",name:"Bounty",category:"combat"}',
    '{id:"cooking",name:"Cooking",category:"artisan"}',
    '{id:"smithing",name:"Smithing",category:"artisan"}',
    '{id:"crafting",name:"Crafting",category:"artisan"}',
    '{id:"agility",name:"Agility",category:"support"}',
    '{id:"cartography",name:"Cartography",category:"support"}',
    '{id:"attack",name:"Attack",category:"combat"}',
    '{id:"strength",name:"Strength",category:"combat"}',
    ...Array.from({ length: 3 }, (_, i) => `{id:"skill_${i}",name:"Skill ${i}",category:"support"}`),
  ].join(',');
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
  const weapons = ['fists:{type:"melee",attack:0,strength:0,speed:2400}', ...Array.from({ length: 12 }, (_, i) => `wpn_${i}:{type:"melee",attack:${i + 1},strength:${i},speed:2600}`)].join(',');
  const armourReq = ['bronze_helm:{skill:"defence",level:1}', ...Array.from({ length: 6 }, (_, i) => `helm_${i + 1}:{skill:"defence",level:${(i + 1) * 5}}`)].join(',');
  const weaponReq = ['bronze_dagger:{skill:"attack",level:1}', ...Array.from({ length: 6 }, (_, i) => `wpn_${i}:{skill:"attack",level:${(i + 1) * 5}}`)].join(',');
  const foodHeal = 'cooked_shrimp:5,cooked_beef:5,cooked_trout:10,cooked_bass:5,cooked_pheasant:10,cooked_rabbit:5';
  const enemyAttacks = Array.from({ length: 40 }, (_, i) => `${i === 0 ? 'giant_rat' : `enemy_${i}`}:[{name:"Gnaw",weight:60,mult:1,msg:"gnaws",icon:"🦷"}]`).join(',');
  const potionEntries = [
    'weak_str_potion:{slot:"damage",mult:.02,durMs:Li,cdMs:Di,family:"strength"}',
    'weak_restore_potion:{slot:null,instant:"prayer",amount:15,cdMs:Di,family:"restore"}',
    ...Array.from({ length: 8 }, (_, i) => `potion_${i}:{slot:"damage",mult:.0${i + 1},durMs:Li,cdMs:Di,family:"strength"}`),
  ].join(',');
  const potions = `const Li=12e4,Di=24e4,POTIONS={${potionEntries}};`;
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
    `const WEAPONS={${weapons}};`,
    `const ARMOUR_REQ={${armourReq}};`,
    `const WEAPON_REQ={${weaponReq}};`,
    `const FOOD={${foodHeal}};`,
    'const SECRET_W=new Set(["dragonfang_greatblade","sanguine_edge"]);const SECRET_A=new Set(["goblin_crown","sunken_crown"]);',
    `const ENEMY_ATTACKS={${enemyAttacks}};`,
    potions,
    'const DIGS=[{id:"millhaven_ruins",name:"Ruins",levelReq:1}];',
    'const OFFLINE={1:10,2:30,3:100};',
    'const K8=new Set(["vial","bow_string"]);const Nz=["wild_berries","venison","woodland_seed","bog_mushroom","plains_seed","ember_spore","ancient_spore"],eM=2,kU=new Set(["vial","bow_string",...Nz]);',
    'const STRINGS={"name.ancient_spore":"Ancient Spore","itemdesc.ancient_spore":"A spore."};',
    'function xpGenerator(){const a=new Array(100).fill(0);for(let i=2;i<100;i++)a[i]=i*10+300*Math.pow(2,i/7);return a;}',
    'const MASTERY={woodcutting:"Grandmaster Woodcutter",mining:"Grandmaster Miner"};',
    // `bounty` intentionally omits `title` so the Transcendent name fallback stays covered.
    'const cb={woodcutting:{title:"Master of the Grove",cross:[[2,"+2% Crafting Speed"]],native:[[5,"+1% double log"]]},mining:{title:"Lord of the Deep",cross:[],native:[[9,"+2% ore"]]},prayer:{title:"Saint",cross:[],native:[]},bounty:{cross:[],native:[]}};',
    'const YA={woodcutting:"gathering",mining:"gathering",prayer:"artisan",bounty:"artisan"};',
    'const K1={gathering:129e5,artisan:585e4,cooking:43e5};',
    'const qf=[60,77,93,110,120,130,140,160,175,192];',
    'const XA=["I","II","III","IV","V","VI","VII","VIII","IX","X"];',
    'const RANK_BONUS=["Gold prestige badge on skill"];const Mm=10,F1=.01,ZA=.005;',
    'const n5={woodcutting:"Master of the Grove",mining:"Lord of the Deep",prayer:"Saint"};',
    'const s5=[{id:"seal_bearer",name:"Sealbearer",source:"Collect all seals",category:"Collection",icon:"trophy"},{id:"season_11_grandchamp",name:"Season 11 Grand Champion",source:"Earn it",category:"Easter Eggs",icon:"cup",color:"#e8c84a"}];',
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
  const titleById = new Map(result.titles.map((title) => [title.id as string, title]));
  assert.equal(result.titles.length, 22);
  assert.deepEqual(titleById.get('max_woodcutting'), { id: 'max_woodcutting', name: 'Grandmaster Woodcutter', source: 'Reach level 99 in Woodcutting', category: 'Mastery', icon: '\u{1F3C6}', skillId: 'woodcutting' });
  assert.equal(titleById.get('max_fishing')?.name, 'Grandmaster Fishing');
  assert.deepEqual(titleById.get('prestige_woodcutting_x'), { id: 'prestige_woodcutting_x', name: 'Master of the Grove', source: 'Reach Prestige Rank X in Woodcutting', category: 'Prestige', icon: '\u2726', skillId: 'woodcutting' });
  assert.equal(titleById.get('prestige_bounty_x')?.name, 'Bounty Transcendent');
  assert.equal(titleById.has('prestige_fishing_x'), false);
  assert.equal(titleById.get('seal_bearer')?.category, 'Collection');
  assert.equal(titleById.get('season_11_grandchamp')?.color, '#e8c84a');
  assert.equal(result.prestige.maxRank, 10);
  assert.equal(result.prestige.xpBonusPerRank, 0.01);
  assert.equal(result.prestige.speedBonusPerRank, 0.005);
  assert.equal(result.prestige.rankLabels.length, 10);
  assert.equal(result.prestige.skills.woodcutting.category, 'gathering');
  assert.equal(result.prestige.skills.woodcutting.maxXp, 12900001);
  assert.deepEqual(result.prestige.skills.woodcutting.thresholds, [615752, 1405967, 2360382, 3489260, 4720764, 6054893, 7491647, 9133652, 10929595, 12900001]);
  assert.deepEqual(result.prestige.skills.woodcutting.native, [[5, '+1% double log']]);
  assert.deepEqual(result.prestige.skills.woodcutting.cross, [[2, '+2% Crafting Speed']]);
  assert.equal(result.prestige.skills.prayer.category, 'artisan');
  assert.equal(result.xp.length, 100);
  assert.equal(result.xp[2] > result.xp[1], true);
  assert.deepEqual(result.shopItems.slice(0, 2), ['vial', 'bow_string']);
  assert.equal(result.shopItems.includes('wild_berries'), true);
  assert.equal(result.shopPriceMultiplier, 2);
  assert.equal(Object.keys(result.equipment).length, 100);
  assert.equal(result.equipment.bronze_helm.def, 5);
  assert.equal(Object.keys(result.weapons).length >= 10, true);
  assert.equal(result.weapons.fists.type, 'melee');
  assert.equal(result.equipRequirements.bronze_helm.level, 1);
  assert.equal(result.equipRequirements.bronze_dagger.skill, 'attack');
  assert.equal(result.foodHeal.cooked_trout, 10);
  assert.equal(result.secretItems.includes('goblin_crown'), true);
  assert.equal(Object.keys(result.enemyAttacks).length, 40);
  assert.equal(result.enemyAttacks.giant_rat[0] && (result.enemyAttacks.giant_rat[0] as Record<string, unknown>).name, 'Gnaw');
  assert.equal(result.potions.weak_str_potion.durMs, 120000);
  assert.equal(result.potions.weak_restore_potion.slot, null);
});

test('fails closed for missing, duplicate, and malformed registry anchors', () => {
  assert.throws(() => extractRegistries(fixture().replace('witherwood_log:{label:', 'other_log:{label:'), []), /items dataset/);
  const duplicate = fixture() + '\nconst duplicate={witherwood_log:{label:"x",type:"material"}};';
  assert.throws(() => extractRegistries(duplicate, []), /items dataset: anchor is ambiguous/);
  assert.throws(() => extractRegistries(fixture().replace('id:"act_mining"', 'id:undefined'), []), /actions dataset/);
});

test('degrades one optional registry and keeps the rest', () => {
  const raw = extractRegistries(fixture().replace('weak_str_potion:{slot:"damage"', 'weak_str_potion:{slot:"dmg"'), []);
  assert.deepEqual(raw.unavailable.map((gap) => gap.dataset), ['potions']);
  assert.match(raw.unavailable[0].reason, /potions dataset/);
  assert.equal(Object.keys(raw.potions).length, 0);
  assert.equal(Object.keys(raw.items).length, 400);
  assert.equal(raw.prestige?.maxRank, 10);
  assert.equal(raw.titles.length, 22);
});

test('degrades one tool ladder without costing the others', () => {
  const raw = extractRegistries(fixture().replace('[{id:"bronze_axe"', '[{id:"copper_axe"'), []);
  assert.deepEqual(raw.unavailable.map((gap) => gap.dataset), ['tools.woodcutting']);
  assert.equal(raw.tools.woodcutting.length, 0);
  assert.equal(raw.tools.mining.length, 1);
});

test('a critical registry still aborts extraction', () => {
  assert.throws(() => extractRegistries(fixture().replace('witherwood_log:{label:', 'other_log:{label:'), []), /items dataset: anchor not found/);
  assert.throws(() => extractRegistries(fixture().replace('const SKILLS=[{id:"hitpoints"', 'const SKILLS=[{id:"health"'), []), /skills dataset/);
});

test('an anchor carrying a minified identifier is refused outright', () => {
  // The guard is what stops a future edit from reintroducing a mangler-dependent
  // anchor, and it must never be absorbed as a degraded registry.
  const source = 'const x={chop_witherwood:{mapId:"m"}};const y=300*Math.pow(2,3);const z=new Set(["vial","bow_string",1]);';
  for (const bad of ['Po=', 'cb=', 'n5=', 's5=', 'Mm=', 'eM = 2', 'qf=[60,77', 'XA=["I","II"']) {
    assert.throws(() => anchor(source, bad, 'probe'), (error: unknown) => error instanceof AnchorHygieneError && /minified identifier/.test(error.message), bad);
  }
  for (const good of ['={chop_witherwood:{mapId:', '300*Math.pow(2,', 'new Set(["vial","bow_string",']) {
    assert.doesNotThrow(() => anchor(source, good, 'probe'), good);
  }
});

// Content grows with every game update, so exact counts would fail on legitimate
// additions and train the maintainer to ignore this test. Real extraction breakage
// is caught build-independently instead: nothing may silently vanish, no anchor may
// degrade, and the compiled model must be internally consistent.
test('real bundle registries extract completely and consistently', { skip: !process.env.FR_BUNDLE_ASAR }, () => {
  const archive = process.env.FR_BUNDLE_ASAR!;
  const files = listFiles(archive);
  const bundle = files.find((file) => /^dist\/assets\/index-.*\.js$/.test(file));
  assert.ok(bundle);
  const result = extractRegistries(extractFile(archive, bundle).toString('utf8'), files);

  assert.deepEqual(result.unavailable, [], 'every registry anchor must still resolve');
  assert.ok(result.prestige, 'prestige must extract');

  const actionTotal = Object.values(result.actions).reduce((sum, list) => sum + list.length, 0);
  const enemyTotal = result.zones.reduce((sum, zone) => sum + ((zone as Record<string, unknown>).enemies as unknown[]).length, 0);
  const FLOORS: Record<string, [number, number]> = {
    skills: [result.skills.length, 15],
    items: [Object.keys(result.items).length, 400],
    actionGates: [Object.keys(result.actionGates).length, 50],
    actions: [actionTotal, 300],
    zones: [result.zones.length, 5],
    enemies: [enemyTotal, 20],
    seals: [result.seals.length, 10],
    buildings: [result.buildings.length, 5],
    titles: [result.titles.length, 10],
    prestigeSkills: [Object.keys(result.prestige!.skills).length, 5],
    agilityCourses: [result.agilityCourses.length, 1],
    mapsRegular: [result.mapsRegular.length, 1],
    mapsDeep: [result.mapsDeep.length, 1],
    machines: [result.machines.length, 1],
    boons: [result.boons.length, 1],
    restorations: [result.restorations.length, 1],
    recipeMeals: [result.recipeMeals.length, 1],
    digsites: [result.digsites.length, 1],
  };
  for (const [name, [observed, floor]] of Object.entries(FLOORS)) {
    assert.ok(observed >= floor, `${name} census collapsed: ${observed} < ${floor}`);
  }
  for (const skill of ACTION_SKILLS) assert.ok(result.actions[skill].length >= 1, `no actions extracted for ${skill}`);
  for (const skill of Object.keys(result.tools)) assert.ok(result.tools[skill].length >= 1, `no tools extracted for ${skill}`);
  assert.equal(result.prestige!.maxRank, 10);

  const model = compileModel(result, 'test-build');
  assert.deepEqual(model.extraction.integrity, [], 'compiled model must be internally consistent');
  assert.equal(model.actions.length, actionTotal);

  // Printed, not asserted: drift stays visible without failing on new content.
  console.log('registry census:', JSON.stringify(Object.fromEntries(Object.entries(FLOORS).map(([name, [observed]]) => [name, observed]))));
  console.log('tools census:', JSON.stringify(Object.fromEntries(Object.entries(result.tools).map(([skill, list]) => [skill, list.length]))));
  console.log('actions by skill:', JSON.stringify(Object.fromEntries(ACTION_SKILLS.map((skill) => [skill, result.actions[skill].length]))));

  if (sqliteAvailable()) {
    const dir = mkdtempSync(join(tmpdir(), 'fr-model-'));
    try {
      const dbPath = join(dir, 'model.db');
      assert.equal(writeModelDb(model, dbPath), true);
      const db = openDatabase(dbPath);
      assert.ok(db);
      const rows = db!.all('SELECT COUNT(*) AS n FROM items') as Array<{ n: number }>;
      assert.equal(Number(rows[0]!.n), Object.keys(result.items).length);
      db!.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
