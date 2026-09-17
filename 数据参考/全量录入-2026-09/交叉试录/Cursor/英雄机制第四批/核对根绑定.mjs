import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const idx=JSON.parse(await readFile(path.join(base,'技能来源索引.json'),'utf8'));
const ids=['Ahri','Darius','Diana','Veigar'];
const skillKey=id=>slot=>id.toLowerCase()+'_'+slot.toLowerCase();

function summarizePart(p){
  // 原摘要遗漏子树会改变公式。保留完整计算树，不作挑字段的有损展开。
  return p;
}

const out={generatedAt:new Date().toISOString(),note:'沿角色根 mCharacterPassiveSpell / spells 精确路径核对；不以名称相似评分选对象。完整原文及SHA位于规划树公共来源。官方16.17.1与客户端16.17分别记录。',heroes:[]};
const compact={generatedAt:new Date().toISOString(),heroes:[]};

for(const id of ids){
  const h=idx.heroes.find(x=>x.championId===id);
  if(!h)throw Error('索引缺少 '+id);
  const raw=gunzipSync(await readFile(path.join(base,h.client.path)));
  const offRaw=await readFile(path.resolve(base,h.official.path));
  const clientSha=createHash('sha256').update(raw).digest('hex');
  const officialSha=createHash('sha256').update(offRaw).digest('hex');
  if(clientSha!==h.client.sha256||officialSha!==h.official.sha256)throw Error('来源摘要不符 '+id);
  const c=JSON.parse(raw), d=JSON.parse(offRaw).data[id], root=c[h.rootPath];
  const compactHero={id,chineseName:h.chineseName,rootPath:h.rootPath,client:h.client,official:h.official,spells:[]};
  const spells=h.skills.map((s,i)=>{
    const expected=i===0?root.mCharacterPassiveSpell:root.spells[i-1];
    if(expected!==s.clientPath)throw Error('根绑定不符 '+id+'/'+s.slot);
    const obj=c[expected],sp=obj.mSpell??{};
    const official=i===0?d.passive:d.spells[i-1];
    const dataValues=(sp.DataValues??sp.mDataValues??[]).map(x=>({name:x.mName??x.name,values:x.mValues??x.values}));
    const calcs={};
    for(const [k,v] of Object.entries(sp.mSpellCalculations??{}))calcs[k]=summarizePart(v);
    compactHero.spells.push({
      slot:s.slot,
      skillKey:skillKey(id)(s.slot),
      binding:expected,
      name:official.name,
      maxrank:official.maxrank??1,
      officialCooldown:official.cooldown??null,
      officialCost:official.cost??null,
      officialDescription:official.description??null,
      officialTooltip:official.tooltip??null,
      cooldownTime:sp.cooldownTime??null,
      mana:sp.mana??null,
      manaValues:sp.manaValues??null,
      spellCastTime:sp.spellCastTime??null,
      mCastTime:sp.mCastTime??null,
      mUseAutoattackCastTimeData:sp.mUseAutoattackCastTimeData??null,
      dataValues,
      calculations:calcs
    });
    return {slot:s.slot,skillKey:skillKey(id)(s.slot),binding:expected,official,object:obj};
  });
  out.heroes.push({id,client:h.client,official:h.official,rootPath:h.rootPath,baseCriticalMultiplier:root.critDamageMultiplier,spells});
  compact.heroes.push(compactHero);
}

await mkdir(path.join(here,'来源冻结'),{recursive:true});
await writeFile(path.join(here,'根绑定与数值证据.json'),JSON.stringify(out,null,2)+'\n');
await writeFile(path.join(here,'来源冻结','来源与哈希汇总.json'),JSON.stringify({
  generatedAt:out.generatedAt,
  note:out.note,
  heroes:compact.heroes.map(h=>({id:h.id,chineseName:h.chineseName,rootPath:h.rootPath,client:h.client,official:h.official,bindings:h.spells.map(s=>({slot:s.slot,skillKey:s.skillKey,binding:s.binding,name:s.name}))}))
},null,2)+'\n');
await writeFile(path.join(here,'来源冻结','主技能数值展开.json'),JSON.stringify(compact,null,2)+'\n');
console.log(JSON.stringify({heroes:out.heroes.map(h=>h.id),rootBoundSkills:out.heroes.flatMap(h=>h.spells).length}));
