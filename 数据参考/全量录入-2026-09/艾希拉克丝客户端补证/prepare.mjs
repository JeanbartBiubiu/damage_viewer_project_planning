import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const out = String.raw`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09\艾希拉克丝客户端补证`;
const localDir = String.raw`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09\英雄\成长补充原始资料\16.17`;
const ddragonDir = String.raw`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09\英雄\原始资料\en_US\champion`;
const specs = {
  Ashe: { url:'https://raw.communitydragon.org/16.17/game/data/characters/ashe/ashe.bin.json', local:'ashe.bin.json', expected:['AsheQ','Volley','AsheSpiritOfTheHawk','EnchantedCrystalArrow'], slots:['Q','W','E','R'], passive:'AshePassive' },
  Lux: { url:'https://raw.communitydragon.org/16.17/game/data/characters/lux/lux.bin.json', local:'lux.bin.json', expected:['LuxLightBinding','LuxPrismaticWave','LuxLightStrikeKugel','LuxR'], slots:['Q','W','E','R'], passive:'LuxIllumination' }
};
function sha256(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function allPaths(v, p=[], out=[]){
  if(!v || typeof v!=='object') return out;
  if(Array.isArray(v)){v.forEach((x,i)=>allPaths(x,p.concat(i),out)); return out;}
  out.push({path:p, value:v});
  for(const [k,x] of Object.entries(v)) allPaths(x,p.concat(k),out);
  return out;
}
function keyText(p){return p.join('/');}
function findObjects(root){
  const arr=[];
  for(const e of allPaths(root)){
    const k=e.path.at(-1);
    if(typeof k==='string' && e.value && typeof e.value==='object' && !Array.isArray(e.value) && e.value.mSpell) arr.push({path:e.path,value:e.value});
  }
  return arr;
}
function fieldExtracts(obj){
  const hits=[];
  for(const [k,v] of Object.entries(obj||{})) if(/DataValues|SpellCalculations|cooldown|Cooldown|cost|Cost|mana|Mana|resource|Resource/i.test(k)) hits.push({path:[k],value:v});
  for(const e of allPaths(obj)){
    const leaf=String(e.path.at(-1));
    if(/DataValues|SpellCalculations|cooldown|Cooldown|cost|Cost|mana|Mana|resource|Resource/i.test(leaf)) hits.push({path:e.path,value:e.value});
  }
  return hits.slice(0,160);
}
function choose(objects, tokens, fallbackRegex){
  const scored=objects.map(o=>{const s=keyText(o.path); const leaf=String(o.path.at(-1)); const segments=s.split('/'); let score=0; for(const t of tokens) {if(leaf===t || segments.includes(t)) score+=20; else if(s.toLowerCase().includes(t.toLowerCase())) score+=2;} if(fallbackRegex?.test(s)) score+=1; return {...o,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||keyText(a.path).length-keyText(b.path).length);
  return scored[0]||null;
}
function sourceMap(name, raw){
  const d=JSON.parse(fs.readFileSync(path.join(ddragonDir,`${name}.json`),'utf8')).data[name];
  const objects=findObjects(raw);
  const ids=d.spells.map(s=>s.id);
  const slots={P:{id:d.passive?.id??null,name:d.passive.name},Q:{id:ids[0],name:d.spells[0].name},W:{id:ids[1],name:d.spells[1].name},E:{id:ids[2],name:d.spells[2].name},R:{id:ids[3],name:d.spells[3].name}};
  const picks={};
  for(const [slot,info] of Object.entries(slots)){
    let c;
    if(slot==='P') c=choose(objects,[name+'Passive','PassiveAbility'],/Passive/);
    else c=choose(objects,[info.id],new RegExp(info.id,'i'));
    const primary=c?{path:keyText(c.path),score:c.score,keys:Object.keys(c.value),mSpellKeys:Object.keys(c.value.mSpell??{}),fieldExtracts:fieldExtracts(c.value.mSpell??{})}:null;
    const alternates=objects.filter(o=>keyText(o.path).toLowerCase().includes((info.id||'').toLowerCase())).slice(0,20).map(o=>keyText(o.path));
    picks[slot]={ddragon:{id:info.id,name:info.name,cooldown:d.spells[slot==='P'?0:['Q','W','E','R'].indexOf(slot)]?.cooldown??null,cost:d.spells[slot==='P'?0:['Q','W','E','R'].indexOf(slot)]?.cost??null,range:d.spells[slot==='P'?0:['Q','W','E','R'].indexOf(slot)]?.range??null},primary,alternatePaths:alternates};
  }
  return {champion:name,sourceType:'CommunityDragon 16.17 客户端提取文件（社区提取，不称 Riot 官方 API）',ddragonVersion:'16.17.1',slots:picks,notes:['客户端字段仅作原值候选，不能据此宣称服务端机制已完整录入。','等级数组保留原始层级；不把 level0 自动解释为 rank1。','无语义 effect[] 与 25000 范围值不转成业务数值或效果。','DataValues、SpellCalculations及资源/冷却字段按原路径原值摘录，语义待后续核对。']};
}
const meta=[];
for(const [name,s] of Object.entries(specs)){
  const local=path.join(localDir,s.local); let buf, method;
  if(fs.existsSync(local)){
    const b=fs.readFileSync(local); let parsed=null; try{parsed=JSON.parse(b);}catch{}
    const paths=findObjects(parsed).map(x=>keyText(x.path));
    const complete=s.expected.every(id=>paths.some(p=>p.toLowerCase().includes(id.toLowerCase())));
    if(complete){buf=b;method='local_existing_complete';}
  }
  if(!buf){const res=await fetch(s.url); if(!res.ok) throw new Error(`${name} fetch ${res.status}`); buf=Buffer.from(await res.arrayBuffer()); method='fetched_now';}
  const raw=JSON.parse(buf.toString('utf8'));
  fs.writeFileSync(path.join(out,`${name.toLowerCase()}.bin.json`),buf);
  const m={champion:name,sourceUrl:s.url,retrievalMethod:method,observedAt:new Date().toISOString(),byteSize:buf.length,sha256:sha256(buf),jsonParsed:true};
  meta.push(m);
  fs.writeFileSync(path.join(out,`${name.toLowerCase()}-来源与哈希.json`),JSON.stringify(m,null,2)+'\n');
  fs.writeFileSync(path.join(out,`${name.toLowerCase()}-客户端技能原字段候选.json`),JSON.stringify(sourceMap(name,raw),null,2)+'\n');
}
fs.writeFileSync(path.join(out,'来源与哈希汇总.json'),JSON.stringify(meta,null,2)+'\n');
fs.writeFileSync(path.join(out,'DDragon主动技能交叉映射.json'),JSON.stringify(Object.fromEntries(Object.keys(specs).map(n=>[n,sourceMap(n,JSON.parse(fs.readFileSync(path.join(out,`${n.toLowerCase()}.bin.json`),'utf8')))])),null,2)+'\n');
console.log(JSON.stringify(meta,null,2));
