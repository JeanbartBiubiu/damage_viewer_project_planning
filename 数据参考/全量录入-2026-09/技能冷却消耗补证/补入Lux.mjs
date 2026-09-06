import fs from 'node:fs';
import path from 'node:path';
const base=String.raw`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09`;
const out=path.join(base,'技能冷却消耗补证');
const rawPath=path.join(base,'艾希拉克丝客户端补证','lux.bin.json');
const ddPath=path.join(base,'英雄','原始资料','zh_CN','champion','Lux.json');
const plan=JSON.parse(fs.readFileSync(path.join(base,'英雄技能全量页面输入','skills-basic-plan.json'),'utf8'));
const raw=JSON.parse(fs.readFileSync(rawPath,'utf8')); const dd=JSON.parse(fs.readFileSync(ddPath,'utf8')).data.Lux;
function vals(x){if(x==null)return null;if(Array.isArray(x))return x;if(x&&Array.isArray(x.values))return x.values;return null}
function eq(a,b,n){return Array.isArray(a)&&Array.isArray(b)&&a.length>=n&&b.length>=n&&a.slice(0,n).every((x,i)=>Number.isFinite(x)&&Math.abs(x-b[i])<=1e-9)}
const slots=[];
for(let i=0;i<4;i++){
 const s=dd.spells[i], pkey=`lux_${'qwer'[i]}`, pe=plan.skills.find(x=>x.key===pkey)||plan.skills.find(x=>x.characterKey==='champion_lux'&&x.sort===i+1);
 const objectPath=Object.keys(raw).find(k=>k.endsWith('/'+s.id)); const m=objectPath?raw[objectPath].mSpell:null;
 const cd=vals(m?.cooldownTime)??vals(m?.Cooldown); const cost=vals(m?.manaValues)??vals(m?.mana)??vals(m?.cost)??null; const n=s.cooldown.length;
 slots.push({candidateStatus:'待核对',canWrite:false,writeBlockReasons:['本批只生成来源候选，不直接写入业务数据',!cd?'客户端未找到明确冷却字段':null,!eq(cd,s.cooldown,n)?'冷却原数组前N项不一致，尚未核对技能等级索引':null,cd&&cd.length>n?'客户端含额外数组位置，技能等级索引未确认，保留完整原值':null].filter(Boolean),stableSkillKey:pe?.key??pkey,characterKey:pe?.characterKey??'champion_lux',slot:'QWER'[i],name:pe?.name??s.name,ddragon:{id:s.id,name:s.name,maxRank:n,cooldown:s.cooldown,cost:s.cost,costBurn:s.costBurn,range:s.range},client:{objectPath,mSpellFieldPaths:{cooldown:m?.cooldownTime?'mSpell.cooldownTime':m?.Cooldown?'mSpell.Cooldown':null,cost:m?.manaValues?'mSpell.manaValues':m?.mana?'mSpell.mana':m?.cost?'mSpell.cost':null},cooldownRaw:cd,costRaw:cost},conversion:{cooldown:'秒 -> 毫秒，候选值乘1000；仅对两来源一致项建议',cost:'保持来源原单位；不把资源类型统称为法力'},rawPrefixComparison:{note:'只比较原数组前N项；客户端等级索引未确认，不是逐技能等级的语义对照',prefixLength:n,cooldownMatch:eq(cd,s.cooldown,n),costMatch:eq(cost,s.cost,n)},uncertainties:[!objectPath?'未找到同名客户端SpellObject':null,!cd?'客户端未找到明确冷却字段':null,!cost?'客户端未找到明确消耗字段':null,cd&&cd.length>n?'客户端含额外数组位置，技能等级索引未确认，保留完整原值':null].filter(Boolean)});
}
const existing=JSON.parse(fs.readFileSync(path.join(out,'冷却消耗候选.json'),'utf8'));
const withoutLux=existing.candidates.filter(x=>x.champion!=='Lux');
const lux={champion:'Lux',sourceVersion:'16.17.1',rawSource:'本地已冻结的16.17 CommunityDragon客户端提取原响应（复用，不重下）',slots,notes:['只保留冷却与消耗候选，不生成业务公式或机制。','仅比较原数组前N项；客户端等级索引未确认，不代表逐技能等级一致。','不把零值一概命名为法力消耗；资源语义待核对。','蓄能、重施、多形态、变形和零冷却等歧义不据名称推导。']};
const all={...existing,candidates:[...withoutLux,lux]}; fs.writeFileSync(path.join(out,'冷却消耗候选.json'),JSON.stringify(all,null,2)+'\n'); fs.writeFileSync(path.join(out,'冷却消耗候选-逐英雄.jsonl'),all.candidates.map(x=>JSON.stringify(x)).join('\n')+'\n');
const cov=JSON.parse(fs.readFileSync(path.join(out,'资料覆盖与字段结构.json'),'utf8')); cov.availableCandidates=all.candidates.length; cov.luxAdded={rawFile:'艾希拉克丝客户端补证/lux.bin.json',reuseOnly:true,activeSlots:4}; fs.writeFileSync(path.join(out,'资料覆盖与字段结构.json'),JSON.stringify(cov,null,2)+'\n');
console.log(JSON.stringify(lux,null,2));
