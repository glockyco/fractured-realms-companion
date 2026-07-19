import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evalLiteral, sliceLiteral } from '../../src/extract/scan.ts';
import { extractDatasets } from '../../src/extract/datasets.ts';

const skills = ['woodcutting','mining','fishing','foraging','trapping','archaeology','smithing','crafting','cooking','brewing','glyphweaving'];
function bundle(): string {
  const items = Array.from({ length: 400 }, (_, i) => `${i === 0 ? 'witherwood_log' : `item_${i}`}:{label:"${i === 0 ? 'Witherwood Log' : `Item ${i}`}",type:"material"}`).join(',');
  const actionLists = skills.map((skill, i) => `${skill}:[{id:"${skill === 'woodcutting' ? 'chop_witherwood' : skill === 'archaeology' ? 'dig_ancient_cairn' : `act_${i}`}",levelReq:${skill === 'archaeology' ? 38 : 1},xp:2,interval:100,outputs:{ancient_spore:1}}]`).join(',');
  const skillList = Array.from({ length: 15 }, (_, i) => `{id:"skill_${i}",name:"Skill ${i}"}`).join(',');
  const buildings = `[{id:"townHall",name:"Town Hall",upgrades:[]}]`;
  const digsites = `[{id:"millhaven_ruins",name:"Millhaven Ruins",levelReq:1}]`;
  const strings = `{"name.ancient_spore":"Ancient Spore","itemdesc.ancient_spore":"A spore."}`;
  return `/* fake { } */ const ITEMS={${items}}; const ACTIONS={${actionLists}}; const GATES={chop_witherwood:{mapId:"millhaven_village",skillLevel:20}}; const SKILLS=[{id:"hitpoints",name:"Hitpoints"},${skillList}]; const BUILDINGS=${buildings}; const DIGS=${digsites}; const STRINGS=${strings}; function xp(){ const t=3; const ignored=\`template { \${{x:1}} }\`; Math.floor(t/3.5); return Array.from({length:100},(_,i)=>i<2?0:i*10); }`;
}

test('scanner skips comments, strings, templates, and nested interpolation', () => {
  const source = `const x={before:"{ ]", nested:{v:\`x \\${{brace:'ok'}}\` /* ] */}, target:{ok:true}};`;
  const at = source.indexOf('target:');
  assert.match(sliceLiteral(source, at), /^\{before:/);
  assert.match(sliceLiteral(source, at), /target:\{ok:true\}\}$/);
});

test('evalLiteral normalizes VM objects', () => {
  const value = evalLiteral('{a:{b:1}, list:[true, `x`]}', 'fixture');
  assert.deepEqual(value, { a: { b: 1 }, list: [true, 'x'] });
});

test('extracts all validated datasets and item art flags', () => {
  const result = extractDatasets(bundle(), ['dist/art/icons/items/witherwood_log.png']);
  assert.equal(result.items.witherwood_log.label, 'Witherwood Log');
  assert.equal(result.items.witherwood_log.art, true);
  assert.equal(result.items.item_1.art, false);
  assert.equal(result.actions.archaeology[0].id, 'dig_ancient_cairn');
  assert.equal((result.actions.woodcutting[0] as Record<string, unknown>).gateLevelReq, 20);
  assert.equal((result.actions.woodcutting[0] as Record<string, unknown>).mapReq, 'millhaven_village');
  assert.equal((result.actions.archaeology[0] as Record<string, unknown>).outputs && ((result.actions.archaeology[0] as Record<string, unknown>).outputs as Record<string, unknown>).ancient_spore, 1);
  assert.equal(result.xp[38], 380);
});

test('rejects missing or duplicate anchors and invalid cardinalities', () => {
  assert.throws(() => extractDatasets(bundle().replace('witherwood_log:{label:', 'other_log:{label:'), []), /items dataset/);
  assert.throws(() => extractDatasets(bundle().replace('const DIGS=', 'const DIGS=[{id:"millhaven_ruins",name:"Duplicate",levelReq:1},'), []), /digsites dataset/);
  assert.throws(() => extractDatasets(bundle().replace('name:"Hitpoints"', 'name:"HP"'), []), /skills dataset/);
});

test('real bundle extraction is opt-in', { skip: !process.env.FRACTURED_REAL_BUNDLE }, () => {
  const result = extractDatasets(readFileSync(process.env.FRACTURED_REAL_BUNDLE!, 'utf8'), []);
  assert.equal(result.items.ancient_spore.label, 'Ancient Spore');
  assert.equal(((result.actions.archaeology.find((entry) => (entry as Record<string, unknown>).id === 'dig_ancient_cairn') as Record<string, unknown>).outputs as Record<string, unknown>).ancient_spore, 1);
  assert.equal(Number.isInteger(result.xp[38]), true);
  const divine = result.actions.mining.find((entry) => (entry as Record<string, unknown>).id === 'mine_divine') as Record<string, unknown>;
  assert.equal(divine.gateLevelReq, 99);
  const huntersStew = result.actions.cooking.find((entry) => (entry as Record<string, unknown>).id === 'meal_hunters_stew') as Record<string, unknown>;
  assert.equal(huntersStew.recipeScroll, 'recipe_hunters_stew');
});
