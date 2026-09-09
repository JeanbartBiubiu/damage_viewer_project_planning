import fs from 'node:fs';
import crypto from 'node:crypto';
const ev=JSON.parse(fs.readFileSync(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(o??{},k)).map(k=>[k,o[k]]));
const out={generatedAt:new Date().toISOString(),sourceEvidenceSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('./根绑定与数值证据.json',import.meta.url))).digest('hex'),heroes:[]};
for(const h of ev.heroes){
  const hero={id:h.id,chineseName:h.chineseName,resourceType:h.officialResourceType,rootPath:h.rootPath,client:h.client,official:h.official,skills:[]};
  for(const s of h.spells){
    const m=s.object?.mSpell??{};
    const rawDataValues=m.DataValues??m.mDataValues??[];
    const calc=m.mSpellCalculations??{};
    hero.skills.push({
      slot:s.slot,skillKey:s.skillKey,binding:s.binding,
      official:pick(s.official,['id','name','description','tooltip','maxrank','cooldown','cost','resource','effect','effectBurn']),
      client:pick(m,['mClientData','cooldownTime','mana','manaValues','spellCastTime','mCastTime','mChannelDuration','mDataValues','DataValues','mSpellCalculations']),
      dataValues:rawDataValues,
      calculationNames:Object.keys(calc),
      calculations:calc
    });
  }
  out.heroes.push(hero);
}
fs.writeFileSync(new URL('./原始技能值展开.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
for(const h of out.heroes){
 console.log('\n## '+h.id+' '+h.chineseName+' resource='+h.resourceType);
 for(const s of h.skills){
  console.log('\n### '+s.skillKey+' '+s.official.name);
  console.log('official desc:',String(s.official.description??'').replace(/<[^>]+>/g,' '));
  console.log('official tooltip:',String(s.official.tooltip??'').replace(/<[^>]+>/g,' '));
  console.log('client timing/mana:',JSON.stringify(pick(s.client,['cooldownTime','mana','manaValues','spellCastTime','mCastTime','mChannelDuration'])));
  console.log('dataValues:',JSON.stringify(s.dataValues));
  console.log('calculations:',JSON.stringify(s.calculations));
 }
}
