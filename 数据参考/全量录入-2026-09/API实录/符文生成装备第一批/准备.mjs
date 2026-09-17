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
const fields={move_speed:'mFlatMovementSpeedMod'};
const attrs={2010:{},2150:{},2152:{},2422:{move_speed:25}};
const scopeNotes={
  2010:'饼干的自疗及永久最大生命保留；明确无携带即生效的直接属性。治疗倍率来源冲突及消耗或出售后的永久属性另行核对。',
  2150:'提供技能点可影响技能等级，保留；明确无携带直接属性，不把技能点记成英雄等级。',
  2152:'25适应之力持续60秒与1V1有关；明确无携带直接属性，暂不把适应选择猜成同时增加攻击力和法术强度。',
  2422:'客户端直接移动速度25；额外10及升级保留属于另外的效果，不重复写成35直接属性。'
};
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
  assert.equal(source.inStore,false);
  assert.equal(source.maps['11'],true);
  const bindings=Object.entries(object.mItemDataClient.mTooltipData.mLocKeys).map(([field,key])=>({field,key,pointer:`/entries/${key.toLowerCase()}`,text:strings[key.toLowerCase()]??null}));
  return {itemId:id,equipmentKey:`item_${id}`,name:source.name.trim(),imageKey:`item_${id}`,
    description:`来源：官方16.17.1装备${id}及客户端16.17。原始说明：${plain(source.description)} 符文生成装备；本批保存主体和明确直接属性，生成关系、消耗及技能效果另行录入。`,
    attributeValues,proofs,source:{pointer:`/Items~1${id}`,object,official:source,bindings},
    scope:scopeNotes[id]};
});
assert.equal(objects.reduce((n,x)=>n+Object.keys(x.attributeValues).length,0),1);
fs.writeFileSync(path.join(dir,'候选与来源.json'),JSON.stringify({generatedAt:new Date().toISOString(),version:{client:'16.17',official:'16.17.1'},sources,objects},null,2)+'\n');
console.log(JSON.stringify({subjects:objects.length,attributeValues:1,sourceFiles:sources.length,passed:true}));
