const keys=['lucian','sivir','tristana','twitch'].flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s));
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
const base='http://127.0.0.1:8080/api/admin/games/lol';
const headers={Authorization:'Bearer local-entry',Accept:'application/json'};
const out={at:new Date().toISOString(),skills:[]};
for(const k of keys){
  const sr=await fetch(base+'/skills/'+k,{headers});
  const skill=await sr.json();
  const counts={},keysPresent={};
  for(const [kind,idField] of kinds){
    const r=await fetch(base+'/skills/'+k+'/'+kind,{headers});
    const data=await r.json();
    if(!Array.isArray(data))throw Error(k+' '+kind+' '+r.status);
    counts[kind]=data.length;
    keysPresent[kind]=data.map(v=>v[idField]);
  }
  out.skills.push({skillKey:k,ok:sr.ok,status:sr.status,name:skill.name,maxLevel:skill.maxLevel,counts,keysPresent});
}
const {writeFile}=await import('node:fs/promises');
await writeFile(new URL('./来源冻结/接口现值.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.skills.map(s=>({skillKey:s.skillKey,name:s.name,maxLevel:s.maxLevel,counts:s.counts}))));
