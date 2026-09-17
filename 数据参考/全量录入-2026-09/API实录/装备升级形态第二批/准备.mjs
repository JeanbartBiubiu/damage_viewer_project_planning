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
const fields={move_speed:'mFlatMovementSpeedMod',omnivamp_percent:'PercentOmnivampMod',slow_resist_percent:'mPercentSlowResistMod',
  ability_haste:'mAbilityHasteMod',bonus_attack_speed_percent:'mPercentAttackSpeedMod',life_steal_percent:'mPercentLifeStealMod',
  magic_resistance:'mFlatSpellBlockMod',tenacity_percent:'mPercentTenacityItemMod',armor:'mFlatArmorMod',magic_pen_flat:'mFlatMagicPenetrationMod',magic_pen_percent:'mPercentMagicPenetrationMod'};
const attrs={
  3168:{move_speed:45,omnivamp_percent:0.04},
  3170:{move_speed:65,slow_resist_percent:0.25},
  3171:{move_speed:45,ability_haste:20},
  3172:{move_speed:45,bonus_attack_speed_percent:0.45,life_steal_percent:0.05},
  3173:{move_speed:45,magic_resistance:25,tenacity_percent:0.3},
  3174:{move_speed:45,armor:35},
  3175:{move_speed:45,magic_pen_flat:20,magic_pen_percent:0.08},
  3176:{move_speed:55},
};
const parents={3168:3008,3170:3009,3171:3158,3172:3006,3173:3111,3174:3047,3175:3020,3176:3013};
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
  assert.ok(source.from.includes(String(parents[id])),`${id}父装备来源`);
  const bindings=Object.entries(object.mItemDataClient.mTooltipData.mLocKeys).map(([field,key])=>({field,key,pointer:`/entries/${key.toLowerCase()}`,text:strings[key.toLowerCase()]??null}));
  return {itemId:id,equipmentKey:`item_${id}`,name:source.name.trim(),imageKey:`item_${id}`,
    description:`来源：官方16.17.1装备${id}及客户端16.17。原始说明：${plain(source.description)} 升级或使用后形态；本批保存明确直接属性，相关技能效果及变换接线另行录入。`,
    attributeValues,proofs,source:{pointer:`/Items~1${id}`,object,official:source,bindings},
    parentItemId:parents[id],scope:'已有资料清单中的特殊升级或使用后形态，不纳入181件普通装备历史批次；未建立额外升级表或虚构变换规则。'};
});
assert.equal(objects.reduce((n,x)=>n+Object.keys(x.attributeValues).length,0),18);
fs.writeFileSync(path.join(dir,'候选与来源.json'),JSON.stringify({generatedAt:new Date().toISOString(),version:{client:'16.17',official:'16.17.1'},sources,objects},null,2)+'\n');
console.log(JSON.stringify({subjects:objects.length,attributeValues:18,sourceFiles:sources.length,passed:true}));
