import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const manifest=read('装备效果补证/来源与覆盖.json');
const sources=[];
function frozen(name){
  const record=manifest.原始资料.find(x=>x.文件.endsWith(name));
  assert.ok(record,name);
  const relativePath=`装备效果补证/${record.文件}`;
  const compressed=fs.readFileSync(path.join(root,relativePath));
  const raw=zlib.gunzipSync(compressed);
  assert.equal(sha(compressed),record.压缩SHA256);
  assert.equal(sha(raw),record.原始SHA256);
  sources.push({relativePath,sha256:sha(compressed),rawSha256:sha(raw)});
  return JSON.parse(raw);
}
const items=frozen('items-16.17.cdtb.bin.json.gz');
const strings=frozen('lol-16.17-zh_CN.stringtable.json.gz').entries;
const officialPath='装备符文/官方原始资料/item-16.17.1-zh_CN.json';
const official=read(officialPath);
assert.equal(official.version,'16.17.1');
sources.push({relativePath:officialPath,sha256:sha(fs.readFileSync(path.join(root,officialPath)))});
const fields={hp:'mFlatHPPoolMod',ability_power:'mFlatMagicDamageMod',armor:'mFlatArmorMod',
  heal_shield_power_percent:'mPercentHealingAmountMod',mana:'flatMPPoolMod',
  base_mana_regen_percent:'percentBaseMPRegenMod',ability_haste:'mAbilityHasteMod',attack_damage:'mFlatPhysicalDamageMod'};
const attrs={
  2421:{ability_power:40,armor:25},
  2530:{hp:200,heal_shield_power_percent:0.08,mana:1000,base_mana_regen_percent:1},
  3040:{ability_power:70,mana:1000,ability_haste:25},
  3042:{attack_damage:35,mana:1000,ability_haste:15},
  3121:{hp:550,mana:1000,ability_haste:15},
};
const parents={2421:2420,2530:2526,3040:3003,3042:3004,3121:3119};
const plain=text=>text.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const objects=Object.entries(attrs).map(([id,attributeValues])=>{
  const object=items[`Items/${id}`];
  assert.equal(object.itemID,Number(id));
  const source=official.data[id];
  assert.ok(source);
  const proofs=Object.entries(attributeValues).map(([attributeKey,value])=>{
    const field=fields[attributeKey];
    assert.equal(typeof object[field],'number',`${id}/${field}`);
    assert.ok(Math.abs(object[field]-value)<1e-7,`${id}/${field}`);
    return {attributeKey,value,sourceValue:object[field],pointer:`/Items~1${id}/${field}`};
  });
  if(id==='2530') assert.ok(!Object.hasOwn(object,'mAbilityHasteMod'),'不能由标签推定急速');
  const bindings=Object.entries(object.mItemDataClient.mTooltipData.mLocKeys).map(([field,key])=>({field,key,pointer:`/entries/${key.toLowerCase()}`,text:strings[key.toLowerCase()]??null}));
  return {itemId:id,equipmentKey:`item_${id}`,name:source.name.trim(),imageKey:`item_${id}`,
    description:`来源：官方16.17.1装备${id}及客户端16.17。原始说明：${plain(source.description)} 升级或使用后形态；本批保存明确直接属性，相关技能效果及变换接线另行录入。`,
    attributeValues,proofs,source:{pointer:`/Items~1${id}`,object,official:source,bindings},
    parentItemId:parents[id],scope:'已有资料清单中的特殊升级或使用后形态，不纳入181件普通装备历史批次；未建立额外升级表或虚构变换规则。'};
});
assert.equal(objects.reduce((n,x)=>n+Object.keys(x.attributeValues).length,0),15);
fs.writeFileSync(path.join(dir,'候选与来源.json'),JSON.stringify({generatedAt:new Date().toISOString(),version:{client:'16.17',official:'16.17.1'},sources,objects},null,2)+'\n');
console.log(JSON.stringify({subjects:objects.length,attributeValues:15,sourceFiles:sources.length,passed:true}));
