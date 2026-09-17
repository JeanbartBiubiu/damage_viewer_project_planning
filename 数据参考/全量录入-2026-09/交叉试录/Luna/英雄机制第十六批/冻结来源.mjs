// 从规划工作树已冻结的客户端16.17与官方16.17.1资料生成本批来源证据。
// 只读取本地来源，不访问网络，不写业务接口。
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const sourceIndexPath=path.join(base,'技能来源索引.json');
const index=JSON.parse(await readFile(sourceIndexPath,'utf8'));
const ids=['Malzahar','Anivia','Lissandra','Karthus'];
const slots=['P','Q','W','E','R'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const keyFor=(id,slot)=>id.toLowerCase()+'_'+slot.toLowerCase();
const note='沿角色根 mCharacterPassiveSpell / spells 精确路径核对；完整原始计算树保留在本批证据。资料来自规划工作树固定客户端16.17与官方16.17.1，不以名称相似对象替代根绑定。';
const evidence={generatedAt:new Date().toISOString(),sourceIndex:sourceIndexPath,note,heroes:[]};
const compact={generatedAt:evidence.generatedAt,note,heroes:[]};

for(const id of ids){
  const meta=index.heroes.find(hero=>hero.championId===id);
  if(!meta)throw Error('来源索引缺少 '+id);
  const clientCompressed=await readFile(path.join(base,meta.client.path));
  const clientRaw=gunzipSync(clientCompressed);
  const officialRaw=await readFile(path.resolve(base,meta.official.path));
  const clientHash=sha256(clientRaw), compressedHash=sha256(clientCompressed), officialHash=sha256(officialRaw);
  if(clientHash!==meta.client.sha256||compressedHash!==meta.client.compressedSha256||officialHash!==meta.official.sha256){
    throw Error('来源摘要不符 '+id);
  }
  const client=JSON.parse(clientRaw);
  const officialRoot=JSON.parse(officialRaw).data?.[id];
  if(!officialRoot)throw Error('官方资料缺少 '+id);
  const root=client[meta.rootPath];
  if(!root)throw Error('角色根缺少 '+id+'/'+meta.rootPath);
  const spells=[];
  for(const info of meta.skills){
    const slot=info.slot;
    const expected=slot==='P'?root.mCharacterPassiveSpell:root.spells?.[['Q','W','E','R'].indexOf(slot)];
    if(expected!==info.clientPath)throw Error('根绑定不符 '+id+'/'+slot+' expected='+info.clientPath+' actual='+expected);
    const object=client[expected];
    if(!object?.mSpell)throw Error('绑定对象缺少mSpell '+id+'/'+slot);
    const official=slot==='P'?officialRoot.passive:officialRoot.spells?.[['Q','W','E','R'].indexOf(slot)];
    if(!official)throw Error('官方技能缺少 '+id+'/'+slot);
    spells.push({
      slot, skillKey:keyFor(id,slot), binding:expected, name:official.name,
      maxrank:official.maxrank??1, officialCooldown:official.cooldown??null,
      officialCost:official.cost??null, officialResource:official.resource??null,
      officialDescription:official.description??null, officialTooltip:official.tooltip??null,
      cooldownTime:object.mSpell.cooldownTime??null, mana:object.mSpell.mana??null,
      manaValues:object.mSpell.manaValues??null, spellCastTime:object.mSpell.spellCastTime??null,
      mCastTime:object.mSpell.mCastTime??null, mChannelDuration:object.mSpell.mChannelDuration??null,
      dataValues:object.mSpell.DataValues??object.mSpell.mDataValues??[],
      calculations:object.mSpell.mSpellCalculations??{}
    });
  }
  const clientRecord={...meta.client,sha256:clientHash,compressedSha256:compressedHash};
  const officialRecord={...meta.official,sha256:officialHash};
  evidence.heroes.push({
    id,chineseName:meta.chineseName,officialResourceType:officialRoot.partype,
    rootPath:meta.rootPath,client:clientRecord,official:officialRecord,rootObject:root,
    spells:spells.map(spell=>({
      slot:spell.slot,skillKey:spell.skillKey,binding:spell.binding,name:spell.name,
      maxrank:spell.maxrank,officialCooldown:spell.officialCooldown,officialCost:spell.officialCost,
      officialResource:spell.officialResource,officialDescription:spell.officialDescription,
      officialTooltip:spell.officialTooltip,object:client[spell.binding],
      official:spell.slot==='P'?officialRoot.passive:officialRoot.spells?.[['Q','W','E','R'].indexOf(spell.slot)]
    }))
  });
  compact.heroes.push({
    id,chineseName:meta.chineseName,rootPath:meta.rootPath,client:clientRecord,official:officialRecord,
    bindings:spells.map(spell=>({
      slot:spell.slot,skillKey:spell.skillKey,binding:spell.binding,name:spell.name,maxrank:spell.maxrank,
      officialCooldown:spell.officialCooldown,officialCost:spell.officialCost,officialResource:spell.officialResource,
      officialDescription:spell.officialDescription,officialTooltip:spell.officialTooltip,
      cooldownTime:spell.cooldownTime,mana:spell.mana,manaValues:spell.manaValues,
      spellCastTime:spell.spellCastTime,mCastTime:spell.mCastTime,mChannelDuration:spell.mChannelDuration,
      dataValues:spell.dataValues,calculations:spell.calculations
    }))
  });
}

await mkdir(path.join(here,'来源冻结'),{recursive:true});
await writeFile(path.join(here,'根绑定与数值证据.json'),JSON.stringify(evidence,null,2)+'\n');
await writeFile(path.join(here,'来源冻结','来源与哈希汇总.json'),JSON.stringify({
  generatedAt:evidence.generatedAt,sourceIndex:sourceIndexPath,note,
  heroes:compact.heroes.map(hero=>({
    id:hero.id,chineseName:hero.chineseName,rootPath:hero.rootPath,client:hero.client,official:hero.official,
    bindings:hero.bindings.map(spell=>({slot:spell.slot,skillKey:spell.skillKey,binding:spell.binding,name:spell.name,maxrank:spell.maxrank}))
  }))
},null,2)+'\n');
await writeFile(path.join(here,'来源冻结','主技能数值展开.json'),JSON.stringify(compact,null,2)+'\n');
console.log(JSON.stringify({heroes:ids,skillCount:evidence.heroes.flatMap(hero=>hero.spells).length,
  clientSha256:evidence.heroes.map(hero=>[hero.id,hero.client.sha256]),
  officialSha256:evidence.heroes.map(hero=>[hero.id,hero.official.sha256])}));
