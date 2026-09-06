import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base=String.raw`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09`;
const out=path.join(base,'技能冷却消耗补证');
const rawDir=path.join(base,'英雄','成长补充原始资料','16.17');
const ddDir=path.join(base,'英雄','原始资料','zh_CN','champion');
const plan=JSON.parse(fs.readFileSync(path.join(base,'英雄技能全量页面输入','skills-basic-plan.json'),'utf8'));
const files=fs.readdirSync(rawDir).filter(x=>x.endsWith('.bin.json')&&!x.startsWith('content-'));
const nameByLower=new Map(fs.readdirSync(ddDir).filter(x=>x.endsWith('.json')).map(x=>[x.slice(0,-5).toLowerCase(),x.slice(0,-5)]));
function sha(b){return crypto.createHash('sha256').update(b).digest('hex')}
function vals(x){if(x==null)return null;if(Array.isArray(x))return x;if(x&&Array.isArray(x.values))return x.values;return null}
function eq(a,b,n){return Array.isArray(a)&&Array.isArray(b)&&a.length>=n&&b.length>=n&&a.slice(0,n).every((x,i)=>Number.isFinite(x)&&Math.abs(x-b[i])<=1e-9)}
const coverage=[]; const candidates=[];
for(const file of files){
 const lower=file.slice(0,-9), name=nameByLower.get(lower); if(!name) continue;
 const buf=fs.readFileSync(path.join(rawDir,file)); let raw; try{raw=JSON.parse(buf)}catch{coverage.push({champion:name,file,status:'unparseable'});continue}
 const ddPath=path.join(ddDir,name+'.json'); if(!fs.existsSync(ddPath)){coverage.push({champion:name,file,status:'missing_ddragon'});continue}
 const dd=JSON.parse(fs.readFileSync(ddPath,'utf8')).data[name];
 const active=dd.spells; const spells=[]; let complete=true;
 for(let i=0;i<4;i++){
  const s=active[i]; const key=lower==='ezreal'?'ez':lower; const pkey=`${key}_${'qwer'[i]}`;
  const pe=plan.skills.find(x=>x.key===pkey)||plan.skills.find(x=>x.characterKey===key&&x.sort===i+1);
  const exactKey=Object.keys(raw).find(k=>k.endsWith('/'+s.id));
  const obj=exactKey?raw[exactKey]:null; const m=obj?.mSpell;
  const cd=vals(m?.cooldownTime)??vals(m?.Cooldown); const cost=vals(m?.manaValues)??vals(m?.mana)??vals(m?.cost)??null;
  const maxRank=s.cooldown.length; const cdMatch=eq(cd,s.cooldown,maxRank); const costMatch=eq(cost,s.cost,maxRank);
  if(!exactKey||!cd||!cost) complete=false;
  const uncertainties=[!exactKey?'未找到与DDragon ID同名的客户端SpellObject':null,!cd?'客户端未找到明确冷却字段':null,!cost?'客户端未找到明确消耗字段':null,cd&&cd.length>maxRank?'客户端含额外数组位置，技能等级索引未确认，保留完整原值':null].filter(Boolean);
  const writeBlockReasons=['本批只生成来源候选，不直接写入业务数据'];
  if(!cd||!cost||!cdMatch||!costMatch) writeBlockReasons.push('至少一项字段缺失或原数组前N项不一致，尚未核对技能等级索引');
  if(cd?.slice(0,maxRank).every(x=>x===0)) writeBlockReasons.push('冷却为零，可能受蓄能/开启条件影响，语义未核对');
  if((pe?.key??pkey)==='ashe_q') writeBlockReasons.push('技能存在蓄能、叠层或开启条件，不能仅凭冷却数组写入');
  spells.push({stableSkillKey:pe?.key??pkey,characterKey:pe?.characterKey??key,slot:'QWER'[i],name:pe?.name??s.name,candidateStatus:'待核对',canWrite:false,writeBlockReasons,ddragon:{id:s.id,name:s.name,maxRank,cooldown:s.cooldown,cost:s.cost,costBurn:s.costBurn,range:s.range},client:{objectPath:exactKey??null,mSpellFieldPaths:{cooldown: m?.cooldownTime?'mSpell.cooldownTime':m?.Cooldown?'mSpell.Cooldown':null,cost:m?.manaValues?'mSpell.manaValues':m?.mana?'mSpell.mana':m?.cost?'mSpell.cost':null},cooldownRaw:cd,costRaw:cost},conversion:{cooldown:'秒 -> 毫秒，候选值乘1000；仅对两来源一致项建议',cost:'保持来源原单位；不将资源类型统称为法力'},rawPrefixComparison:{note:'只比较原数组前N项；客户端等级索引未确认，不是逐技能等级的语义对照',prefixLength:maxRank,cooldownMatch:cdMatch,costMatch},uncertainties});
 }
 coverage.push({champion:name,rawFile:file,rawBytes:buf.length,rawSha256:sha(buf),ddragonFile:name+'.json',activeSlots:4,allSlotsHaveObjectAndFields:complete});
 candidates.push({champion:name,sourceVersion:'16.17.1',rawSource:'本地16.17 CommunityDragon客户端提取原响应',slots:spells,notes:['只保留冷却与消耗候选，不生成业务公式或机制。','仅比较原数组前N项；客户端等级索引未确认，不代表逐技能等级一致。','不把零值一概命名为法力消耗；资源语义待核对。','蓄能、重施、多形态、变形和零冷却等歧义不据名称推导。']});
}
const excluded=plan.excluded;
const report={generatedAt:new Date().toISOString(),scope:'本地已有16.17客户端响应与DDragon16.17.1中文主动槽位对照；排除赛拉斯、厄斐琉斯',excluded,planSkillCount:plan.skillCount,clientCoverage:coverage,availableCandidates:candidates.length,sourceNote:'CommunityDragon为社区客户端提取，不称Riot官方API'};
fs.writeFileSync(path.join(out,'资料覆盖与字段结构.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(out,'冷却消耗候选.json'),JSON.stringify({generatedAt:report.generatedAt,excluded,candidates},null,2)+'\n');
fs.writeFileSync(path.join(out,'冷却消耗候选-逐英雄.jsonl'),candidates.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log(JSON.stringify({coverage,availableCandidates:candidates.length},null,2));
